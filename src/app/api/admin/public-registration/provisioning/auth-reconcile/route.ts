export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { inspectInterruptedRegistrationAuth, reconcileInterruptedRegistrationAuth } from '@/lib/publicRegistrationAuthReconciliation'

function reply(body: object, status: number) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Super Admin only. Preview by default; explicit reconcile=true is required for write. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_AUTH_RECONCILIATION_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const client = createSupabaseServerActionClient()
  const { data: session, error: sessionError } = await client.auth.getUser()
  if (sessionError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin')
    return reply({ ok: false, code: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' ||
      (body.reconcile !== undefined && typeof body.reconcile !== 'boolean'))
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  try {
    if (body.reconcile === true) {
      if (typeof body.reason !== 'string') return reply({ ok: false, code: 'REASON_REQUIRED' }, 400)
      const result = await reconcileInterruptedRegistrationAuth(admin, body.request_id, session.user.id, body.reason)
      return reply(result, result.ok ? 200 : 409)
    }
    const result = await inspectInterruptedRegistrationAuth(admin, body.request_id)
    return reply(result, result.ok ? 200 : 409)
  } catch {
    return reply({ ok: false, code: 'RECONCILIATION_UNAVAILABLE' }, 503)
  }
}
