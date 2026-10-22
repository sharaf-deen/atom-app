import 'server-only'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : ''

type AuthIdentity = { id: string; email?: string | null; app_metadata?: Record<string, unknown> | null }

/** Read-only, bounded scan. Never infer provenance from email alone. */
export async function inspectInterruptedRegistrationAuth(admin: any, requestId: string) {
  if (!UUID.test(requestId)) return { ok: false, code: 'INVALID_REQUEST_ID' }
  const { data: request, error } = await admin.from('atom_public_registration_requests')
    .select('id,status,account_email,identity_verified_at,verified_account_email,provisioning_claim_id,auth_provisioning_started_at,provisioned_auth_user_id,member_user_id,family_id')
    .eq('id', requestId).maybeSingle()
  if (error) throw new Error('REQUEST_LOOKUP_FAILED')
  if (!request) return { ok: false, code: 'REQUEST_NOT_FOUND' }
  if (request.status !== 'provisioning' || !request.provisioning_claim_id || !request.auth_provisioning_started_at ||
      request.provisioned_auth_user_id || request.member_user_id || request.family_id || !request.identity_verified_at ||
      normalize(request.verified_account_email) !== normalize(request.account_email))
    return { ok: false, code: 'NOT_INTERRUPTED_OR_NOT_ELIGIBLE' }

  const matching: AuthIdentity[] = []
  let conflictingEmail = 0
  const perPage = 1000
  for (let page = 1; page <= 100; page++) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage })
    if (listError || !Array.isArray(data?.users)) throw new Error('AUTH_SCAN_FAILED')
    for (const user of data.users as AuthIdentity[]) {
      const metadata = user.app_metadata || {}
      const provenance = metadata.atom_registration_request_id === request.id &&
        metadata.atom_registration_claim_id === request.provisioning_claim_id
      if (provenance) matching.push(user)
      else if (normalize(user.email) === normalize(request.account_email)) conflictingEmail++
    }
    if (data.users.length < perPage) {
      if (matching.length !== 1 || conflictingEmail !== 0)
        return { ok: false, code: matching.length > 1 ? 'MULTIPLE_PROVENANCE_MATCHES' :
          conflictingEmail ? 'EMAIL_CONFLICT_REVIEW_REQUIRED' : 'NO_PROVENANCE_MATCH',
          matchingCount: matching.length, conflictingEmail }
      if (normalize(matching[0].email) !== normalize(request.account_email))
        return { ok: false, code: 'AUTH_EMAIL_MISMATCH' }
      return { ok: true, code: 'EXACT_PROVENANCE_MATCH', authUserId: matching[0].id,
        requestId: request.id, claimId: request.provisioning_claim_id }
    }
  }
  throw new Error('AUTH_SCAN_LIMIT_REACHED')
}

/** Explicitly authorized manual recovery; DB RPC independently rechecks Auth metadata. */
export async function reconcileInterruptedRegistrationAuth(admin: any, requestId: string, actorId: string, reason: string) {
  if (!UUID.test(actorId) || reason.trim().length < 10 || reason.trim().length > 1000)
    return { ok: false, code: 'INVALID_INPUT' }
  const audit = await inspectInterruptedRegistrationAuth(admin, requestId)
  if (!audit.ok || !audit.authUserId || !audit.claimId) return audit
  const { data, error } = await admin.rpc('atom_reconcile_registration_auth_v1', {
    p_request_id: requestId, p_claim_id: audit.claimId, p_auth_user_id: audit.authUserId,
    p_actor_id: actorId, p_reason: reason.trim(),
  })
  if (error) throw new Error('RECONCILIATION_RPC_FAILED')
  return { ok: data === 'RECONCILED' || data === 'ALREADY_RECORDED', code: String(data) }
}
