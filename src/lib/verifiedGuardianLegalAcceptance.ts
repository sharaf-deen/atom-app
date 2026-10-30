import 'server-only'
import type { RegistrationLegalAcceptanceInput } from '@/lib/legalConsent'

/** Invoked by authenticated application server ONLY after registration context checks.
 * Database rechecks guardian + child bindings and serializes with staff review INSERTs.
 */
export async function recordVerifiedGuardianLegalAcceptance({
  admin, registrationRequestId, familyId, guardianAuthUserId, memberUserId, input, userAgent,
}: {
  admin: any
  registrationRequestId: string
  familyId: string
  guardianAuthUserId: string
  memberUserId: string
  input: RegistrationLegalAcceptanceInput
  userAgent?: string | null
}) {
  return admin.rpc('atom_record_verified_guardian_legal_acceptances_v1', {
    p_registration_request_id: registrationRequestId,
    p_family_id: familyId,
    p_guardian_auth_user_id: guardianAuthUserId,
    p_member_user_id: memberUserId,
    p_document_version_ids: input.accepted_document_version_ids ?? [],
    p_acceptor_name: input.acceptor_name ?? '',
    p_acceptor_capacity: input.acceptor_capacity ?? null,
    p_guardian_relationship: input.guardian_relationship ?? null,
    p_user_agent: userAgent ?? null,
    p_ip_address: null,
  })
}
