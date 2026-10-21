import 'server-only'

/**
 * Internal-only preflight. No Auth, member, family or invitation is created here.
 * Never call this function from an unauthenticated/public request handler.
 * A future trusted verification flow must set identity_verified_at after verifying
 * the account owner; a checkbox or email supplied by the applicant is not proof.
 */
export type ProvisioningPreflightOutcome =
  | { ready: true; requestId: string; accountEmail: string; isMinor: boolean }
  | { ready: false; reason: string }

type AdminClient = any

function normalizedEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

export async function checkPublicRegistrationProvisioningReadiness(
  admin: AdminClient,
  requestId: string,
): Promise<ProvisioningPreflightOutcome> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return { ready: false, reason: 'INVALID_REQUEST_ID' }
  }

  const { data: request, error } = await admin
    .from('atom_public_registration_requests')
    .select('id,status,expires_at,identity_verified_at,account_email,guardian_email,guardian_full_name,guardian_relationship,is_minor,member_user_id,family_id')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw new Error('REGISTRATION_REQUEST_LOOKUP_FAILED')
  if (!request) return { ready: false, reason: 'REGISTRATION_REQUEST_NOT_FOUND' }
  if (request.status !== 'under_review') return { ready: false, reason: 'REGISTRATION_NOT_APPROVED_FOR_REVIEW' }
  if (!request.identity_verified_at) return { ready: false, reason: 'ACCOUNT_EMAIL_NOT_VERIFIED' }
  if (!request.expires_at || Date.parse(request.expires_at) <= Date.now()) return { ready: false, reason: 'REGISTRATION_REQUEST_EXPIRED' }
  if (request.member_user_id || request.family_id) return { ready: false, reason: 'REGISTRATION_ALREADY_LINKED' }

  const email = normalizedEmail(request.account_email)
  if (!email || !email.includes('@')) return { ready: false, reason: 'ACCOUNT_EMAIL_INVALID' }
  if (request.is_minor) {
    if (normalizedEmail(request.guardian_email) !== email || !request.guardian_full_name || !request.guardian_relationship) {
      return { ready: false, reason: 'GUARDIAN_ACCOUNT_INCOMPLETE' }
    }
  }

  // A pre-existing login must be handled in a separately authenticated
  // account-ownership linking flow, not by trusting a public email string.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('email', email)
    .limit(1)
  if (profileError) throw new Error('ACCOUNT_PROFILE_LOOKUP_FAILED')
  if (profile?.length) return { ready: false, reason: 'EXISTING_ACCOUNT_REQUIRES_VERIFIED_LINKING' }

  const { data: guardians, error: guardianError } = await admin
    .from('family_guardians')
    .select('auth_user_id')
    .ilike('email', email)
    .limit(1)
  if (guardianError) throw new Error('GUARDIAN_LOOKUP_FAILED')
  if (guardians?.length) return { ready: false, reason: 'EXISTING_GUARDIAN_REQUIRES_VERIFIED_LINKING' }

  // Auth identities can exist without profiles (notably parent accounts).
  // A caller must also perform a complete Auth identity lookup and duplicate
  // check before creating a login. This preflight is advisory, never sufficient
  // authorization to create accounts or commit legal consent.
  return { ready: true, requestId: request.id, accountEmail: email, isMinor: Boolean(request.is_minor) }
}
