export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { auditRegistrationIdentity } from '@/lib/publicRegistrationIdentityAudit'

function reply(body: object, status: number) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Staff-only diagnostic, never creates Auth accounts or Family links. */
export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) return reply({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', auth.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, error: 'ROLE_LOOKUP_FAILED' }, 500)
  if (!new Set(['admin', 'super_admin', 'head_coach']).has(String(normalizeRole(actor?.role) || '')))
    return reply({ ok: false, error: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string')
    return reply({ ok: false, error: 'INVALID_REQUEST_ID' }, 400)
  try {
    const result = await auditRegistrationIdentity(admin, body.request_id)
    // Avoid exposing whether an arbitrary email is registered; diagnostic is staff-only.
    return reply({ ok: true, audit: result }, 200)
  } catch {
    return reply({ ok: false, error: 'IDENTITY_AUDIT_UNAVAILABLE' }, 503)
  }
}
