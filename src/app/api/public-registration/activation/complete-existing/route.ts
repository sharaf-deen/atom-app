export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function reply(body: object, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

const FIELDS = 'id,status,is_minor,provisioned_auth_user_id,provisioning_claim_id,invitation_dispatched_at,account_activated_at'

/**
 * Account holder may finish a *previously approved/provisioned* registration
 * using their current password. This never changes the Auth password.
 * The isolated password check does not replace the request's cookie session.
 */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)

  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  const origin = req.headers.get('origin')
  if (!configured || !origin || origin !== new URL(configured).origin)
    return reply({ ok: false, code: 'ORIGIN_FORBIDDEN' }, 403)

  const input = await req.json().catch(() => null)
  if (!input || typeof input.password !== 'string' || input.password.length < 8 ||
      input.password.length > 128 || input.confirm !== true)
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)

  const sessionClient = createSupabaseServerActionClient()
  const { data: identity, error: identityError } = await sessionClient.auth.getUser()
  if (identityError || !identity.user || !identity.user.email)
    return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)

  const user = identity.user
  const requestId = user.app_metadata?.atom_registration_request_id
  const claimId = user.app_metadata?.atom_registration_claim_id
  if (typeof requestId !== 'string' || typeof claimId !== 'string')
    return reply({ ok: false, code: 'NOT_REGISTRATION_ACCOUNT' }, 409)

  try {
    const admin = createSupabaseAdminClient()
    const { data: row, error: lookupError } = await admin
      .from('atom_public_registration_requests').select(FIELDS).eq('id', requestId).maybeSingle()
    if (lookupError) return reply({ ok: false, code: 'LOOKUP_UNAVAILABLE' }, 503)
    if (!row || row.provisioned_auth_user_id !== user.id ||
        row.provisioning_claim_id !== claimId || !row.invitation_dispatched_at)
      return reply({ ok: false, code: 'ACCOUNT_BINDING_MISMATCH' }, 409)

    // Idempotent and read-only once the original activation has completed.
    if (row.status === 'completed' && row.account_activated_at)
      return reply({ ok: true, code: 'ALREADY_ACTIVATED',
        next: row.is_minor ? '/family' : '/profile' })
    if (row.status !== 'invitation_pending' || row.account_activated_at)
      return reply({ ok: false, code: 'REQUIRES_STAFF_REVIEW' }, 409)

    // Dedicated auth client: no cookie writes, persistence, refresh or sign-in
    // side effects on the browser's already authenticated Supabase session.
    // Supabase Auth owns credential validation and its server-side limits.
    const verifier = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    )
    const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: input.password,
    })
    if (verifyError || !verified.user || verified.user.id !== user.id)
      return reply({ ok: false, code: 'PASSWORD_VERIFICATION_FAILED' }, 401)

    // The existing SQL function locks the request and re-verifies identity,
    // claim, guardian/member bindings and invitation delivery atomically.
    const { data: completed, error: completeError } = await admin.rpc(
      'atom_finalize_registration_activation_v1', { p_auth_user_id: user.id },
    )
    if (completeError || completed !== true)
      return reply({ ok: false, code: 'ACTIVATION_REVIEW_REQUIRED' }, 409)

    return reply({ ok: true, code: 'ACTIVATED', next: row.is_minor ? '/family' : '/profile' })
  } catch {
    return reply({ ok: false, code: 'ACTIVATION_UNAVAILABLE' }, 503)
  }
}
