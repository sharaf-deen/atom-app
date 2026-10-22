import 'server-only'

/** Read-only, fail-closed identity audit before ANY Auth/Member/Family provisioning. */
type AdminClient = any
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emailOf = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : ''

export type IdentityAuditResult =
  | { safeForNewAuth: true; requestId: string; accountEmail: string; isMinor: boolean }
  | { safeForNewAuth: false; reason: string }

export async function auditRegistrationIdentity(admin: AdminClient, requestId: string): Promise<IdentityAuditResult> {
  if (!UUID.test(requestId)) return { safeForNewAuth: false, reason: 'INVALID_REQUEST_ID' }
  const { data: request, error } = await admin.from('atom_public_registration_requests')
    .select('id,status,expires_at,identity_verified_at,verified_account_email,account_email,guardian_email,guardian_full_name,guardian_relationship,is_minor,member_user_id,family_id,provisioning_claim_id')
    .eq('id', requestId).maybeSingle()
  if (error) throw new Error('REQUEST_LOOKUP_FAILED')
  if (!request) return { safeForNewAuth: false, reason: 'REQUEST_NOT_FOUND' }
  if (!['under_review', 'provisioning'].includes(request.status)) return { safeForNewAuth: false, reason: 'REQUEST_NOT_READY' }
  if (request.status === 'provisioning' && !request.provisioning_claim_id) return { safeForNewAuth: false, reason: 'CLAIM_MISSING' }
  const accountEmail = emailOf(request.account_email)
  if (!accountEmail || !request.identity_verified_at || emailOf(request.verified_account_email) !== accountEmail)
    return { safeForNewAuth: false, reason: 'EMAIL_NOT_VERIFIED' }
  if (!request.expires_at || Date.parse(request.expires_at) <= Date.now())
    return { safeForNewAuth: false, reason: 'REQUEST_EXPIRED' }
  if (request.member_user_id || request.family_id)
    return { safeForNewAuth: false, reason: 'REQUEST_ALREADY_LINKED' }
  if (request.is_minor && (emailOf(request.guardian_email) !== accountEmail || !request.guardian_full_name || !request.guardian_relationship))
    return { safeForNewAuth: false, reason: 'GUARDIAN_DATA_MISMATCH' }

  const { data: profiles, error: profileError } = await admin.from('profiles')
    .select('user_id').ilike('email', accountEmail).limit(2)
  if (profileError) throw new Error('PROFILE_LOOKUP_FAILED')
  if (profiles?.length) return { safeForNewAuth: false, reason: 'EXISTING_PROFILE_REQUIRES_AUTHENTICATED_LINKING' }
  const { data: guardians, error: guardianError } = await admin.from('family_guardians')
    .select('auth_user_id').ilike('email', accountEmail).limit(2)
  if (guardianError) throw new Error('GUARDIAN_LOOKUP_FAILED')
  if (guardians?.length) return { safeForNewAuth: false, reason: 'EXISTING_GUARDIAN_REQUIRES_AUTHENTICATED_LINKING' }

  // Auth users without profiles are real identities. Iterate ALL pages; fail closed
  // after a bounded scan instead of incorrectly returning not found.
  const perPage = 1000
  const maxPages = 100
  for (let page = 1; page <= maxPages; page++) {
    const { data, error: authError } = await admin.auth.admin.listUsers({ page, perPage })
    if (authError) throw new Error('AUTH_LOOKUP_FAILED')
    if (!Array.isArray(data?.users)) throw new Error('AUTH_LOOKUP_INCOMPLETE')
    if (data.users.some((user: { email?: string | null }) => emailOf(user.email) === accountEmail))
      return { safeForNewAuth: false, reason: 'EXISTING_AUTH_REQUIRES_AUTHENTICATED_LINKING' }
    if (data.users.length < perPage)
      return { safeForNewAuth: true, requestId, accountEmail, isMinor: Boolean(request.is_minor) }
  }
  throw new Error('AUTH_LOOKUP_PAGE_LIMIT_REACHED')
}
