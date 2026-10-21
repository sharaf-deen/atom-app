import 'server-only'
import { randomUUID } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Internal-only atomic claim. Do not expose from a public route.
 * This does NOT create Auth accounts, Members, Families or legal acceptances.
 * A failed/abandoned claim must be reconciled before a manual retry.
 */
export async function claimVerifiedRegistrationForProvisioning(
  admin: any,
  requestId: string,
): Promise<{ claimed: boolean; reason: string; claimId: string | null }> {
  if (!UUID.test(requestId)) {
    return { claimed: false, reason: 'INVALID_REQUEST_ID', claimId: null }
  }
  const claimId = randomUUID()
  const { data, error } = await admin.rpc('atom_claim_registration_provisioning_v1', {
    p_request_id: requestId,
    p_claim_id: claimId,
  })
  if (error) throw new Error(`REGISTRATION_CLAIM_FAILED: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.claimed) {
    return { claimed: false, reason: String(row?.reason || 'NOT_CLAIMED'), claimId: null }
  }
  return { claimed: true, reason: 'CLAIMED', claimId }
}
