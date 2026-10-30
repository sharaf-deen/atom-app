import 'server-only'

import { z } from 'zod'
import { loadActiveMemberProgramOptions } from '@/lib/memberPrograms'

type AdminClient = any

const registrationSchema = z.object({
  request_key: z.string().uuid(),
  first_name: z.string().trim().min(2).max(100),
  last_name: z.string().trim().min(2).max(100),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(30).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  program_key: z.string().trim().min(1).max(100),
  guardian_name: z.string().trim().max(200).optional(),
  guardian_email: z.string().trim().max(254).optional(),
  guardian_relationship: z.enum(['mother','father','legal_guardian']).optional(),
  accepted_document_version_ids: z.array(z.string().uuid()).max(10),
}).strict()

export type PendingRegistrationInput = z.input<typeof registrationSchema>

export type ValidatedPendingRegistration = {
  request_key: string
  account_email: string
  participant_first_name: string
  participant_last_name: string
  participant_date_of_birth: string
  selected_program_key: string
  participant_phone: string | null
  guardian_full_name: string | null
  guardian_email: string | null
  guardian_relationship: 'mother' | 'father' | 'legal_guardian' | null
  is_minor: boolean
  claimed_document_version_ids: string[]
}

export class RegistrationInputError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

function ageOnCairoDate(dob: string): number | null {
  const [y, m, d] = dob.split('-').map(Number)
  const birth = new Date(Date.UTC(y, m - 1, d))
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== m - 1 || birth.getUTCDate() !== d) return null
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const nowFields = Object.fromEntries(dateParts.map((part) => [part.type, part.value]))
  const cy = Number(nowFields.year)
  const cm = Number(nowFields.month)
  const cd = Number(nowFields.day)
  let age = cy - y
  if (cm < m || (cm === m && cd < d)) age--
  if (age < 0 || age > 120) return null
  return age
}

/**
 * Validates a prospective request only. This does NOT establish identity,
 * verify email ownership, authenticate a guardian or create legal consent evidence.
 * The public submission route must stay disabled until anti-abuse and identity
 * verification workflows have been separately implemented and reviewed.
 */
export async function validatePendingRegistrationRequest(
  admin: AdminClient,
  raw: unknown,
): Promise<ValidatedPendingRegistration> {
  const parsed = registrationSchema.safeParse(raw)
  if (!parsed.success) throw new RegistrationInputError('INVALID_REGISTRATION_INPUT')
  const input = parsed.data
  const age = ageOnCairoDate(input.date_of_birth)
  if (age === null) throw new RegistrationInputError('INVALID_DATE_OF_BIRTH')
  const isMinor = age < 18
  // Adult participants require their own email. For minors the verified parent/guardian
  // email is the account identity; a child email is not required or persisted.
  if (!isMinor && !z.string().email().safeParse(input.email).success) {
    throw new RegistrationInputError('ADULT_EMAIL_REQUIRED')
  }

  const [programs, legalResult] = await Promise.all([
    loadActiveMemberProgramOptions(admin),
    admin.from('legal_document_versions')
      .select('id')
      .eq('status', 'active')
      .eq('is_required', true),
  ])
  if (legalResult.error) throw new Error('LEGAL_DOCUMENT_LOOKUP_FAILED')
  const program = programs.find((candidate) => candidate.key === input.program_key)
  if (!program || (program.age_min !== null && age < program.age_min) ||
      (program.age_max !== null && age > program.age_max)) {
    throw new RegistrationInputError('PROGRAM_NOT_ELIGIBLE')
  }

  const requiredIds = (legalResult.data ?? []).map((doc: { id: string }) => String(doc.id))
  if (requiredIds.length === 0) throw new Error('LEGAL_DOCUMENT_CONFIGURATION_MISSING')
  const claimedIds = new Set(input.accepted_document_version_ids)
  if (claimedIds.size !== input.accepted_document_version_ids.length ||
      claimedIds.size !== requiredIds.length ||
      !requiredIds.every((id: string) => claimedIds.has(id))) {
    throw new RegistrationInputError('LEGAL_DOCUMENTS_NOT_ACCEPTED')
  }

  const email = input.email.toLowerCase()
  let guardianName: string | null = null
  let guardianEmail: string | null = null
  let guardianRelationship: 'mother' | 'father' | 'legal_guardian' | null = null
  if (isMinor) {
    if (!input.guardian_name || input.guardian_name.length < 2 ||
        !input.guardian_email || !z.string().email().safeParse(input.guardian_email).success ||
        !input.guardian_relationship) {
      throw new RegistrationInputError('GUARDIAN_DETAILS_REQUIRED')
    }
    guardianName = input.guardian_name
    guardianEmail = input.guardian_email.toLowerCase()
    guardianRelationship = input.guardian_relationship
  } else if (input.guardian_name || input.guardian_email || input.guardian_relationship) {
    throw new RegistrationInputError('GUARDIAN_DETAILS_NOT_ALLOWED')
  }

  return {
    request_key: input.request_key,
    account_email: guardianEmail ?? email,
    participant_first_name: input.first_name,
    participant_last_name: input.last_name,
    participant_date_of_birth: input.date_of_birth,
    selected_program_key: input.program_key,
    participant_phone: input.phone || null,
    guardian_full_name: guardianName,
    guardian_email: guardianEmail,
    guardian_relationship: guardianRelationship,
    is_minor: isMinor,
    claimed_document_version_ids: requiredIds,
  }
}

