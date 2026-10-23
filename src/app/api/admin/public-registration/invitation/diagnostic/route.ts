export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function reply(body: object, status = 200) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** No email content, tokens, addresses, or PII returned. Read-only, Super Admin only. */
export async function POST(req: Request) {
  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles').select('role')
    .eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ ok: false, code: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || !UUID.test(body.request_id))
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  const { data: row, error } = await admin.from('atom_public_registration_requests')
    .select('status,provisioned_auth_user_id,invitation_dispatch_started_at,invitation_dispatched_at,invitation_email_id,password_setup_reported_at')
    .eq('id', body.request_id).maybeSingle()
  if (error) return reply({ ok: false, code: 'DIAGNOSTIC_UNAVAILABLE' }, 503)
  if (!row) return reply({ ok: false, code: 'NOT_FOUND' }, 404)
  const started = !!row.invitation_dispatch_started_at
  const recorded = !!row.invitation_dispatched_at && !!row.invitation_email_id
  const reported = !!row.password_setup_reported_at
  const state = reported ? 'PASSWORD_SETUP_REPORTED' : recorded ? 'DISPATCH_RECORDED' :
    started ? 'DISPATCH_UNCERTAIN_REVIEW_REQUIRED' : 'NOT_DISPATCHED'
  return reply({ ok: true, state, registration_status: row.status,
    auth_provisioned: !!row.provisioned_auth_user_id,
    dispatch_started: started, dispatch_recorded: recorded, password_setup_reported: reported,
    // Deliberately no resend action: delivery outcomes cannot safely be inferred from a missing receipt.
    automatic_resend_allowed: false,
  })
}
