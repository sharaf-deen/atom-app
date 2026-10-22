import 'server-only'
import { auditRegistrationIdentity } from '@/lib/publicRegistrationIdentityAudit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A failed Auth create is NOT retried automatically: the API might have created
 * a user before the response was lost. Reconcile Auth and the request manually.
 * Invoke ONLY from a trusted, explicitly authorized server route.
 */
export async function provisionNewRegistrationAuth(admin: any, requestId: string, claimId: string) {
  if (!UUID.test(requestId) || !UUID.test(claimId))
    return { ok: false, code: 'INVALID_IDENTIFIERS' }
  const audit = await auditRegistrationIdentity(admin, requestId)
  if (!audit.safeForNewAuth) return { ok: false, code: audit.reason }
  const { data: beginData, error: beginError } = await admin.rpc('atom_begin_registration_auth_v1', {
    p_request_id: requestId, p_claim_id: claimId,
  })
  if (beginError) throw new Error('AUTH_BEGIN_CHECKPOINT_FAILED')
  const begin = Array.isArray(beginData) ? beginData[0] : beginData
  if (!begin?.started || begin.account_email !== audit.accountEmail ||
      Boolean(begin.is_minor) !== audit.isMinor)
    return { ok: false, code: 'AUTH_ALREADY_STARTED_OR_NOT_READY' }

  // Fail closed: the durable marker above means even an ambiguous API failure
  // requires a human to check Auth before any new attempt.
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: audit.accountEmail,
    email_confirm: true,
    app_metadata: { atom_registration_request_id: requestId, atom_registration_claim_id: claimId },
  })
  if (authError || !created?.user?.id)
    return { ok: false, code: 'AUTH_CREATE_REQUIRES_RECONCILIATION' }

  const { data: recorded, error: recordError } = await admin.rpc('atom_record_registration_auth_v1', {
    p_request_id: requestId, p_claim_id: claimId, p_auth_user_id: created.user.id,
  })
  if (recordError || recorded !== true)
    return { ok: false, code: 'AUTH_RECORD_REQUIRES_RECONCILIATION' }
  return { ok: true, code: 'AUTH_RECORDED', authUserId: created.user.id }
}
