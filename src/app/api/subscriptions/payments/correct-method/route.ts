export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'

const METHODS = new Set(['cash', 'instapay', 'card', 'bank_transfer'])

function json(status: number, body: Record<string, unknown>) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * Correct ONE payment's method without inventing a new financial receipt.
 * The backing RPC is responsible for atomic ledger, validation and audit writes.
 * No production deployment until the SQL draft is promoted into a reviewed
 * migration and verified in an isolated environment.
 */
export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) {
    return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
  if (profileError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED' })
  if (normalizeRole(profile?.role) !== 'super_admin') {
    return json(403, { ok: false, error: 'SUPER_ADMIN_REQUIRED' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('INVALID_BODY')
  } catch {
    return json(400, { ok: false, error: 'INVALID_BODY' })
  }

  const paymentId = String(body.payment_id ?? '').trim()
  const oldMethod = String(body.old_method ?? '').trim().toLowerCase()
  const newMethod = String(body.new_method ?? '').trim().toLowerCase()
  const reason = String(body.reason ?? '').trim()

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)
      || !METHODS.has(oldMethod) || !METHODS.has(newMethod) || oldMethod === newMethod
      || reason.length < 5 || reason.length > 500) {
    return json(400, { ok: false, error: 'INVALID_CORRECTION_REQUEST' })
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>
  try {
    admin = createSupabaseAdminClient()
  } catch {
    return json(500, { ok: false, error: 'ADMIN_CLIENT_UNAVAILABLE' })
  }

  const { data, error } = await admin.rpc('correct_subscription_payment_method_v1', {
    p_payment_id: paymentId,
    p_old_method: oldMethod,
    p_new_method: newMethod,
    p_reason: reason,
    p_actor: auth.user.id,
  })

  if (error) {
    // Deliberately avoid exposing raw database internals to HTTP clients.
    return json(error.code === 'PGRST202' ? 503 : 409, {
      ok: false,
      error: error.code === 'PGRST202'
        ? 'PAYMENT_CORRECTION_NOT_DEPLOYED'
        : 'PAYMENT_CORRECTION_REJECTED',
      // Detailed SQL exceptions remain in server logs, not in the API response.
    })
  }

  return json(200, {
    ok: true,
    result: data,
    requires_payment_validation: true,
    note: 'The original validation evidence remains in history. Validate the corrected method/day before matching the bank transfer.',
  })
}
