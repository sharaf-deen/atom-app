export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { validateRegistrationLegalAcceptance, recordMemberLegalAcceptances, type RegistrationLegalAcceptanceInput } from '@/lib/legalConsent'
import { getMemberLegalCompliance } from '@/lib/legalConsentEnforcement'
import { guardianAuthorityDecision } from '@/lib/guardianAuthorityDecision'
import { recordVerifiedGuardianLegalAcceptance } from '@/lib/verifiedGuardianLegalAcceptance'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const email = (x: unknown) => typeof x === 'string' ? x.trim().toLowerCase() : ''
function reply(payload: object, status = 200) {
  const response = NextResponse.json(payload, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Resolve one authenticated, completed registration without trusting a member ID from the browser. */
async function context() {
  const client = createSupabaseServerActionClient()
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError || !authData.user) return { code: 'NOT_AUTHENTICATED', status: 401 } as const
  const user = authData.user
  const requestId = user.app_metadata?.atom_registration_request_id
  const claimId = user.app_metadata?.atom_registration_claim_id
  if (typeof requestId !== 'string' || !UUID.test(requestId) || typeof claimId !== 'string' || !UUID.test(claimId))
    return { code: 'NOT_REGISTRATION_ACCOUNT', status: 403 } as const

  const admin = createSupabaseAdminClient()
  const { data: request, error: requestError } = await admin.from('atom_public_registration_requests')
    .select('id,status,is_minor,member_user_id,family_id,provisioned_auth_user_id,provisioning_claim_id,account_email,verified_account_email,identity_verified_at,account_activated_at')
    .eq('id', requestId).maybeSingle()
  if (requestError) return { code: 'REQUEST_LOOKUP_FAILED', status: 503 } as const
  if (!request || request.status !== 'completed' || !request.account_activated_at || !request.identity_verified_at
    || request.provisioned_auth_user_id !== user.id || request.provisioning_claim_id !== claimId
    || email(request.account_email) !== email(request.verified_account_email)
    || email(request.account_email) !== email(user.email) || !request.member_user_id)
    return { code: 'REGISTRATION_NOT_ELIGIBLE', status: 409 } as const

  const { data: member, error: memberError } = await admin.from('profiles')
    .select('user_id,role,date_of_birth,first_name,last_name').eq('user_id', request.member_user_id).maybeSingle()
  if (memberError) return { code: 'MEMBER_LOOKUP_FAILED', status: 503 } as const
  if (!member || member.role !== 'member' || !member.date_of_birth)
    return { code: 'MEMBER_NOT_READY', status: 409 } as const

  if (request.is_minor) {
    if (!request.family_id || request.member_user_id === user.id)
      return { code: 'FAMILY_RELATIONSHIP_INVALID', status: 409 } as const
    const [{ data: guardians, error: guardianError }, { data: familyMembers, error: linkError }] = await Promise.all([
      admin.from('family_guardians').select('family_id,auth_user_id,relationship,email,first_name,last_name')
        .eq('family_id', request.family_id).eq('auth_user_id', user.id),
      admin.from('family_members').select('family_id,member_id')
        .eq('family_id', request.family_id).eq('member_id', request.member_user_id),
    ])
    if (guardianError || linkError) return { code: 'FAMILY_LOOKUP_FAILED', status: 503 } as const
    if (guardians?.length !== 1 || familyMembers?.length !== 1 || email(guardians[0].email) !== email(user.email))
      return { code: 'GUARDIAN_AUTHORIZATION_REQUIRED', status: 403 } as const
    // Authenticated family link is not sufficient evidence of legal guardianship
    // when the relation was only declared at registration. Human review remains mandatory.
    // Only allow an explicitly verified parent/guardian role from the family record.
    if (!['mother', 'father', 'guardian', 'legal_guardian', 'parent'].includes(String(guardians[0].relationship)))
      return { code: 'GUARDIAN_RELATIONSHIP_REVIEW_REQUIRED', status: 409 } as const
    return { admin, user, request, member, minor: true as const, relationship: String(guardians[0].relationship), signerName: [guardians[0].first_name, guardians[0].last_name].filter(Boolean).join(' ').trim() }
  }
  if (request.family_id || request.member_user_id !== user.id)
    return { code: 'ADULT_BINDING_INVALID', status: 409 } as const
  return { admin, user, request, member, minor: false as const, relationship: null, signerName: [member.first_name, member.last_name].filter(Boolean).join(' ').trim() }
}

export async function GET() {
  if (process.env.ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED !== 'true') return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  try {
    const c = await context()
    if ('code' in c) return reply({ ok: false, code: c.code }, c.status)
    const compliance = await getMemberLegalCompliance(c.admin, c.member.user_id)
    // F07.2B guardian-authorized finalization: disabled by default, fail closed on lookup errors.
    const authority = c.minor && process.env.ATOM_GUARDIAN_LEGAL_UNLOCK_ENABLED === 'true'
      ? await guardianAuthorityDecision(c.admin, c.request.family_id!, c.user.id, c.member.user_id)
      : 'requires_review'
    const unlocked = c.minor && authority === 'verified'
    return reply({ ok: true, member_id: c.member.user_id, is_minor: c.minor, signer_name: c.signerName, guardian_relationship: c.minor ? c.relationship : null, guardian_review_required: c.minor && !unlocked, guardian_authority_status: c.minor ? authority : null, ...compliance })
  } catch { return reply({ ok: false, code: 'CHECK_UNAVAILABLE' }, 503) }
}

export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED !== 'true') return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const origin = req.headers.get('origin')
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!origin || !url || origin !== new URL(url).origin)
    return reply({ ok: false, code: 'ORIGIN_FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return reply({ ok: false, code: 'INVALID_BODY' }, 400)
  const acceptance: RegistrationLegalAcceptanceInput = body.legal_acceptance
  if (!acceptance || typeof acceptance !== 'object') return reply({ ok: false, code: 'ACCEPTANCE_REQUIRED' }, 400)
  try {
    const c = await context()
    if ('code' in c) return reply({ ok: false, code: c.code }, c.status)
    // F07.2B: a declared Family link never substitutes for the latest audited decision.
    if (c.minor) {
      if (process.env.ATOM_GUARDIAN_LEGAL_UNLOCK_ENABLED !== 'true')
        return reply({ ok: false, code: 'GUARDIAN_AUTHORITY_REVIEW_REQUIRED' }, 409)
      const authority = await guardianAuthorityDecision(c.admin, c.request.family_id!, c.user.id, c.member.user_id)
      if (authority !== 'verified') return reply({ ok: false, code: 'GUARDIAN_AUTHORITY_REVIEW_REQUIRED' }, 409)
    }
    const validation = await validateRegistrationLegalAcceptance(c.admin, String(c.member.date_of_birth).slice(0, 10), acceptance)
    if (!validation.ok) return reply({ ok: false, code: validation.error }, validation.status)
    if (!validation.normalized || validation.required.length === 0)
      return reply({ ok: false, code: 'NO_ACTIVE_REQUIRED_DOCUMENTS_REVIEW_REQUIRED' }, 409)
    if (!c.signerName || validation.normalized.acceptor_name.trim().replace(/\s+/g, ' ').toLowerCase() !== c.signerName.replace(/\s+/g, ' ').toLowerCase())
      return reply({ ok: false, code: 'SIGNER_IDENTITY_MISMATCH' }, 409)
    if (c.minor) {
      const capacity = c.relationship === 'guardian' || c.relationship === 'legal_guardian' ? 'legal_guardian' : 'parent'
      if (validation.normalized.acceptor_capacity !== capacity || validation.normalized.guardian_relationship !== c.relationship)
        return reply({ ok: false, code: 'GUARDIAN_CAPACITY_MISMATCH' }, 409)
      // Recheck immediately before the write. This is not an atomic DB lock; see README.
      if (await guardianAuthorityDecision(c.admin, c.request.family_id!, c.user.id, c.member.user_id) !== 'verified')
        return reply({ ok: false, code: 'GUARDIAN_AUTHORITY_REVIEW_REQUIRED' }, 409)
    } else if (validation.normalized.acceptor_capacity !== 'participant')
      return reply({ ok: false, code: 'PARTICIPANT_ACCEPTANCE_REQUIRED' }, 400)
    // F07.2C: the minor write and final authority decision share one database transaction.
    // Adults retain their original recorder without changed behavior.
    const { error, data } = c.minor
      ? await recordVerifiedGuardianLegalAcceptance({
          admin: c.admin,
          registrationRequestId: c.request.id,
          familyId: c.request.family_id!,
          guardianAuthUserId: c.user.id,
          memberUserId: c.member.user_id,
          input: validation.normalized,
          userAgent: req.headers.get('user-agent'),
        })
      : await recordMemberLegalAcceptances({
          admin: c.admin, memberUserId: c.member.user_id, actorUserId: c.user.id,
          source: 'profile_reaccept', input: validation.normalized,
          userAgent: req.headers.get('user-agent'), ipAddress: null,
        })
    if (error) return reply({ ok: false, code: 'LEGAL_RECORD_FAILED' }, 503)
    const compliance = await getMemberLegalCompliance(c.admin, c.member.user_id)
    return reply({ ok: compliance.complete, inserted: Number(data ?? 0), complete: compliance.complete,
      missing_count: compliance.missingDocuments.length }, compliance.complete ? 200 : 409)
  } catch { return reply({ ok: false, code: 'LEGAL_FINALIZATION_UNAVAILABLE' }, 503) }
}
