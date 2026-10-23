export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function reply(body: object, status = 200) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/**
 * Registration-only password setup. The server verifies a fresh Supabase session,
 * completes the Auth password mutation, then verifies all account bindings in SQL.
 * The endpoint is off until the complete registration lifecycle is tested.
 */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const origin = req.headers.get('origin')
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!origin || !configuredOrigin || origin !== new URL(configuredOrigin).origin)
    return reply({ ok: false, code: 'ORIGIN_FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (typeof body?.password !== 'string' || body.password.length < 8 || body.password.length > 128)
    return reply({ ok: false, code: 'INVALID_PASSWORD' }, 400)

  const client = createSupabaseServerActionClient()
  const { data: identity, error: authError } = await client.auth.getUser()
  if (authError || !identity.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const meta = identity.user.app_metadata || {}
  if (!meta.atom_registration_request_id || !meta.atom_registration_claim_id)
    return reply({ ok: false, code: 'NOT_REGISTRATION_ACCOUNT' }, 409)
  try {
    const admin = createSupabaseAdminClient()
    // Fail closed before changing credentials. The RPC revalidates under a lock after the mutation.
    const { data: request, error: lookupError } = await admin.from('atom_public_registration_requests')
      .select('id,status,provisioned_auth_user_id,provisioning_claim_id,invitation_dispatched_at,account_activated_at')
      .eq('id', meta.atom_registration_request_id).maybeSingle()
    if (lookupError) return reply({ ok: false, code: 'LOOKUP_UNAVAILABLE' }, 503)
    if (!request || request.status !== 'invitation_pending' || request.provisioned_auth_user_id !== identity.user.id
        || request.provisioning_claim_id !== meta.atom_registration_claim_id || !request.invitation_dispatched_at
        || request.account_activated_at)
      return reply({ ok: false, code: 'NOT_ELIGIBLE' }, 409)

    // Auth mutation is performed by the currently authenticated Supabase user,
    // never via service-role admin.updateUserById.
    const { error: passwordError } = await client.auth.updateUser({ password: body.password })
    if (passwordError) return reply({ ok: false, code: 'PASSWORD_UPDATE_FAILED' }, 422)

    const { data: completed, error: finalError } = await admin.rpc('atom_finalize_registration_activation_v1', {
      p_auth_user_id: identity.user.id,
    })
    if (finalError || completed !== true)
      return reply({ ok: false, code: 'PASSWORD_UPDATED_ACTIVATION_REVIEW_REQUIRED' }, 503)
    return reply({ ok: true, code: 'ACTIVATED' })
  } catch {
    return reply({ ok: false, code: 'ACTIVATION_UNAVAILABLE' }, 503)
  }
}
