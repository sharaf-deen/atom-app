export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { provisionNewRegistrationAuth } from '@/lib/publicRegistrationAuthProvisioning'

function reply(body: object, status: number) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Super Admin-only, explicit opt-in; does not send invitations or create Members/Families. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_AUTH_PROVISIONING_ENABLED !== 'true')
    return reply({ ok: false, error: 'FEATURE_DISABLED' }, 404)
  const supabase = createSupabaseServerActionClient()
  const { data: session, error: sessionError } = await supabase.auth.getUser()
  if (sessionError || !session.user) return reply({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, error: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin')
    return reply({ ok: false, error: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || typeof body.claim_id !== 'string')
    return reply({ ok: false, error: 'INVALID_INPUT' }, 400)
  try {
    const result = await provisionNewRegistrationAuth(admin, body.request_id, body.claim_id)
    return reply(result, result.ok ? 200 : 409)
  } catch {
    return reply({ ok: false, error: 'PROVISIONING_UNAVAILABLE_RECONCILE_BEFORE_RETRY' }, 503)
  }
}
