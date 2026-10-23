export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function reply(body: object, status = 200) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Authenticated, best-effort checkpoint. Never claims password verification or legal consent. */
export async function POST() {
  if (process.env.ATOM_REGISTRATION_ACTIVATION_TRACKING_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const client = createSupabaseServerActionClient()
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  try {
    const admin = createSupabaseAdminClient()
    const { data: result, error: rpcError } = await admin.rpc('atom_report_registration_password_setup_v1', {
      p_auth_user_id: data.user.id,
    })
    if (rpcError) return reply({ ok: false, code: 'REPORT_UNAVAILABLE' }, 503)
    return reply({ ok: result === true, code: result === true ? 'RECORDED' : 'NOT_ELIGIBLE' }, result === true ? 200 : 409)
  } catch {
    return reply({ ok: false, code: 'REPORT_UNAVAILABLE' }, 503)
  }
}
