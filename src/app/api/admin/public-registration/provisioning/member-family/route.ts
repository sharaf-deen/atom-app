export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { provisionRegistrationMemberFamily } from '@/lib/publicRegistrationMemberFamilyProvisioning'

function reply(body: object, status: number) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Explicit Super Admin action only. NO invitation, sale, enrollment, or consent write. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED !== 'true')
    return reply({ ok: false, error: 'FEATURE_DISABLED' }, 404)
  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
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
    const result = await provisionRegistrationMemberFamily(
      admin, body.request_id, body.claim_id, session.user.id,
    )
    return reply(result, result.ok ? 200 : 409)
  } catch {
    return reply({ ok: false, error: 'MEMBER_FAMILY_PROVISIONING_UNAVAILABLE' }, 503)
  }
}
