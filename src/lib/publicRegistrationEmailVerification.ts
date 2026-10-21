import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

type AdminClient = any
const TOKEN_BYTES = 32
const TOKEN_MINUTES = 30
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_FORMAT = /^[a-f0-9]{64}$/

function digest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Trusted backend helper ONLY. A public caller must never be able to request
 * issuance by arbitrary request ID. Future orchestration MUST add rate limits,
 * anti-abuse, secure request ownership and mail delivery before enabling routes.
 * Never log, persist or return the raw token to a client.
 */
export async function issueRegistrationEmailVerification(
  admin: AdminClient,
  requestId: string,
): Promise<{ token: string; email: string; expiresAt: string } | null> {
  if (!REQUEST_ID.test(requestId)) return null
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_MINUTES * 60_000).toISOString()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('atom_public_registration_requests')
    .update({
      verification_token_hash: digest(token),
      verification_expires_at: expiresAt,
      // Database-side snapshot is filled from the request's authoritative email
      // after initial loading; checked again under the conditional update below.
    })
    .eq('id', requestId)
    .eq('status', 'pending_verification')
    .is('identity_verified_at', null)
    .gt('expires_at', now)
    .select('id,account_email,guardian_email,is_minor')
    .maybeSingle()
  if (error) throw new Error('REGISTRATION_VERIFICATION_ISSUE_FAILED')
  if (!data) return null
  const email = String(data.account_email || '').trim().toLowerCase()
  if (!email || (data.is_minor && String(data.guardian_email || '').trim().toLowerCase() !== email)) {
    // Never deliver the token for an inconsistent request.
    await admin.from('atom_public_registration_requests')
      .update({ verification_token_hash: null, verification_expires_at: null, verification_email: null })
      .eq('id', requestId).eq('verification_token_hash', digest(token))
    return null
  }
  const { data: updated, error: snapshotError } = await admin
    .from('atom_public_registration_requests')
    .update({ verification_email: email })
    .eq('id', requestId)
    .eq('verification_token_hash', digest(token))
    .eq('account_email', email)
    .eq('status', 'pending_verification')
    .select('id')
    .maybeSingle()
  if (snapshotError) throw new Error('REGISTRATION_VERIFICATION_SNAPSHOT_FAILED')
  if (!updated) return null
  return { token, email, expiresAt }
}

/** Atomically consumes a one-time token; only the first redemption succeeds. */
export async function consumeRegistrationEmailVerification(
  admin: AdminClient,
  token: string,
): Promise<{ verified: true; requestId: string } | { verified: false }> {
  if (!TOKEN_FORMAT.test(token)) return { verified: false }
  const hash = digest(token)
  const { data: row, error: findError } = await admin
    .from('atom_public_registration_requests')
    .select('id,account_email,verification_email')
    .eq('verification_token_hash', hash)
    .maybeSingle()
  if (findError) throw new Error('REGISTRATION_VERIFICATION_LOOKUP_FAILED')
  if (!row || !row.verification_email || row.account_email !== row.verification_email) return { verified: false }
  const now = new Date().toISOString()
  const { data: updated, error } = await admin
    .from('atom_public_registration_requests')
    .update({
      identity_verified_at: now,
      verified_account_email: row.verification_email,
      verification_token_hash: null,
      verification_email: null,
      verification_expires_at: null,
      status: 'under_review',
    })
    .eq('id', row.id)
    .eq('verification_token_hash', hash)
    .eq('account_email', row.verification_email)
    .eq('status', 'pending_verification')
    .is('identity_verified_at', null)
    .gt('verification_expires_at', now)
    .gt('expires_at', now)
    .select('id')
    .maybeSingle()
  if (error) throw new Error('REGISTRATION_VERIFICATION_REDEEM_FAILED')
  return updated ? { verified: true, requestId: updated.id } : { verified: false }
}
