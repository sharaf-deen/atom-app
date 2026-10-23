export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { resendRegistrationInvitation } from '@/lib/publicRegistrationInvitationRecovery'

function reply(body: object, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control','no-store')
  return response
}

export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_INVITATION_RESEND_ENABLED !== 'true') return reply({ok:false,code:'FEATURE_DISABLED'},404)
  const client = createSupabaseServerActionClient()
  const { data, error: authError } = await client.auth.getUser()
  if (authError || !data.user) return reply({ok:false,code:'NOT_AUTHENTICATED'},401)
  const admin = createSupabaseAdminClient()
  const { data: actor,error: roleError } = await admin.from('profiles').select('role').eq('user_id',data.user.id).maybeSingle()
  if (roleError) return reply({ok:false,code:'ROLE_LOOKUP_UNAVAILABLE'},503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ok:false,code:'FORBIDDEN'},403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || typeof body.claim_id !== 'string' || typeof body.reason !== 'string')
    return reply({ok:false,code:'INVALID_INPUT'},400)
  try {
    const result = await resendRegistrationInvitation(admin,body.request_id,body.claim_id,data.user.id,body.reason)
    return reply(result,result.ok ? 200 : 409)
  } catch { return reply({ok:false,code:'OPERATION_UNAVAILABLE'},503) }
}
