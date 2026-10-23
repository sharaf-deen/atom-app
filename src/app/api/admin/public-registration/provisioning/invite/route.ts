export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { dispatchProvisionedRegistrationInvitation } from '@/lib/publicRegistrationInvitation'

function reply(body: object, status: number) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Explicit, feature-gated Super Admin-only action; never runs during public registration. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_INVITATION_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ ok: false, code: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || typeof body.claim_id !== 'string')
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  try {
    const result = await dispatchProvisionedRegistrationInvitation(admin, body.request_id, body.claim_id, session.user.id)
    return reply(result, result.ok ? 200 : 409)
  } catch {
    return reply({ ok: false, code: 'INVITATION_UNAVAILABLE' }, 503)
  }
}
