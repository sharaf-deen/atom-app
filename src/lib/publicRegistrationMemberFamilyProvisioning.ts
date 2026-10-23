import 'server-only'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Trusted server-only operation. PostgreSQL validates provenance, role, claim and
 * completes Member+Family writes in a single transaction, or writes nothing. */
export async function provisionRegistrationMemberFamily(
  admin: any, requestId: string, claimId: string, actorId: string,
) {
  if (![requestId, claimId, actorId].every((v) => UUID.test(v)))
    return { ok: false, code: 'INVALID_IDENTIFIERS' }
  const { data, error } = await admin.rpc('atom_complete_registration_member_family_v1', {
    p_request_id: requestId, p_claim_id: claimId, p_actor_id: actorId,
  })
  if (error) throw new Error('MEMBER_FAMILY_ATOMIC_PROVISIONING_FAILED')
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('MEMBER_FAMILY_EMPTY_RPC_RESPONSE')
  return { ok: row.ok === true, code: String(row.code),
    memberId: row.ok ? row.member_id : undefined,
    familyId: row.ok ? row.created_family_id : undefined }
}
