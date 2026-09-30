import 'server-only'

export type RegistrationLegalAcceptanceInput = {
  accepted_document_version_ids?: string[]
  acceptor_name?: string
  acceptor_capacity?: 'participant' | 'parent' | 'legal_guardian'
  guardian_relationship?: string | null
}

type LegalDocumentRow = {
  id: string
  document_key: string
  title: string
  version_label: string
  published_url: string
  status: 'draft' | 'active' | 'retired'
  is_required: boolean
}

function ageOnDate(dateOfBirth: string, today: string) {
  const [y, m, d] = dateOfBirth.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - y
  if (tm < m || (tm === m && td < d)) age--
  return age
}

function cairoDateOnly() {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export async function validateRegistrationLegalAcceptance(
  admin: any,
  dateOfBirth: string | null,
  input: RegistrationLegalAcceptanceInput | null | undefined,
) {
  const { data, error } = await admin
    .from('legal_document_versions')
    .select('id,document_key,title,version_label,published_url,status,is_required')
    .eq('status', 'active')
    .eq('is_required', true)
    .order('document_key', { ascending: true })

  if (error) {
    return { ok: false as const, status: 500, error: `LEGAL_DOCUMENT_LOOKUP_FAILED: ${error.message}` }
  }

  const required = (data ?? []) as LegalDocumentRow[]
  if (required.length === 0) {
    return { ok: true as const, required, isMinor: false, normalized: null }
  }

  if (!dateOfBirth) {
    return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_DATE_OF_BIRTH_REQUIRED' }
  }

  if (!input || typeof input !== 'object') {
    return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_REQUIRED' }
  }

  const acceptedIds = new Set(
    (Array.isArray(input.accepted_document_version_ids) ? input.accepted_document_version_ids : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )

  const missing = required.filter((doc) => !acceptedIds.has(doc.id))
  if (missing.length > 0) {
    return {
      ok: false as const,
      status: 400,
      error: 'LEGAL_CONSENT_REQUIRED_DOCUMENTS_MISSING',
      details: `Missing acceptance: ${missing.map((doc) => `${doc.title} v${doc.version_label}`).join(', ')}`,
    }
  }

  const acceptorName = String(input.acceptor_name || '').trim()
  if (acceptorName.length < 2) {
    return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_ACCEPTOR_NAME_REQUIRED' }
  }

  const age = ageOnDate(dateOfBirth, cairoDateOnly())
  if (!Number.isFinite(age) || age < 0) {
    return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_INVALID_DATE_OF_BIRTH' }
  }

  const isMinor = age < 18
  const capacity = input.acceptor_capacity

  if (isMinor) {
    if (capacity !== 'parent' && capacity !== 'legal_guardian') {
      return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_GUARDIAN_REQUIRED' }
    }
    if (!String(input.guardian_relationship || '').trim()) {
      return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_GUARDIAN_RELATIONSHIP_REQUIRED' }
    }
  } else if (capacity !== 'participant') {
    return { ok: false as const, status: 400, error: 'LEGAL_CONSENT_PARTICIPANT_REQUIRED' }
  }

  return {
    ok: true as const,
    required,
    isMinor,
    normalized: {
      accepted_document_version_ids: [...acceptedIds],
      acceptor_name: acceptorName,
      acceptor_capacity: capacity,
      guardian_relationship: isMinor ? String(input.guardian_relationship || '').trim() : null,
    },
  }
}

export async function recordMemberLegalAcceptances({
  admin,
  memberUserId,
  actorUserId,
  source,
  input,
  userAgent,
  ipAddress,
}: {
  admin: any
  memberUserId: string
  actorUserId: string
  source:
    | 'member_registration'
    | 'visitor_conversion'
    | 'prospect_conversion'
    | 'family_intake'
    | 'profile_reaccept'
    | 'manual_backfill'
  input: RegistrationLegalAcceptanceInput
  userAgent?: string | null
  ipAddress?: string | null
}) {
  return admin.rpc('record_member_legal_acceptances_v1', {
    p_member_user_id: memberUserId,
    p_document_version_ids: input.accepted_document_version_ids ?? [],
    p_acceptor_name: String(input.acceptor_name || '').trim(),
    p_acceptor_capacity: input.acceptor_capacity ?? null,
    p_guardian_relationship: String(input.guardian_relationship || '').trim() || null,
    p_recorded_by_user_id: actorUserId,
    p_source: source,
    p_user_agent: userAgent || null,
    p_ip_address: ipAddress || null,
  })
}
