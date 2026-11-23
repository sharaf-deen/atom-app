export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (status: number, value: unknown) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } })

async function authenticate() {
  const session = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await session.auth.getUser()
  if (authError || !auth.user) return { status: 401, error: 'UNAUTHENTICATED' } as const
  const { data: profile, error: profileError } = await session.from('profiles')
    .select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
  if (profileError) return { status: 500, error: 'ROLE_LOOKUP_FAILED' } as const
  if (profile?.role !== 'super_admin') return { status: 403, error: 'SUPER_ADMIN_REQUIRED' } as const
  return { status: 200, actorId: auth.user.id } as const
}

export async function GET(req: Request) {
  const auth = await authenticate()
  if (!('actorId' in auth)) return reply(auth.status, { ok: false, error: auth.error })
  const id = new URL(req.url).searchParams.get('subscription_id')
  if (!id || !uuid.test(id)) return reply(400, { ok: false, error: 'INVALID_SUBSCRIPTION_ID' })
  let admin: ReturnType<typeof createSupabaseAdminClient>
  try { admin = createSupabaseAdminClient() }
  catch { return reply(500, { ok: false, error: 'SERVICE_UNAVAILABLE' }) }
  const [sub, history] = await Promise.all([
    admin.from('subscriptions').select('id,subscription_type,status,end_date,paid_end_date')
      .eq('id', id).maybeSingle(),
    admin.from('subscription_complimentary_extensions')
      .select('id,days,reason,internal_note,granted_at,granted_by,previous_end_date,resulting_end_date,reversed_at,reversed_by,reversal_reason')
      .eq('subscription_id',id).order('granted_at',{ ascending: false }),
  ])
  if (sub.error || history.error) return reply(500, { ok: false, error: 'COMPLIMENTARY_HISTORY_READ_FAILED' })
  if (!sub.data) return reply(404, { ok: false, error: 'SUBSCRIPTION_NOT_FOUND' })
  return reply(200, { ok: true, subscription: sub.data, history: history.data || [] })
}

export async function POST(req: Request) {
  const auth = await authenticate()
  if (!('actorId' in auth)) return reply(auth.status, { ok: false, error: auth.error })
  let payload: Record<string, unknown>
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
    payload = body as Record<string, unknown>
  } catch { return reply(400, { ok: false, error: 'INVALID_JSON' }) }

  const action = payload.action
  let admin: ReturnType<typeof createSupabaseAdminClient>
  try { admin = createSupabaseAdminClient() }
  catch { return reply(500, { ok: false, error: 'SERVICE_UNAVAILABLE' }) }
  let rpcName: string
  let args: Record<string, unknown>
  if (action === 'grant') {
    if (typeof payload.subscription_id !== 'string' || !uuid.test(payload.subscription_id)
        || typeof payload.days !== 'number' || !Number.isInteger(payload.days)
        || payload.days < 1 || payload.days > 365
        || typeof payload.reason !== 'string' || payload.reason.trim().length < 3
        || payload.reason.length > 200
        || typeof payload.request_key !== 'string' || !uuid.test(payload.request_key)
        || (payload.note != null && (typeof payload.note !== 'string' || payload.note.length > 2000))) {
      return reply(400, { ok: false, error: 'INVALID_GRANT_PAYLOAD' })
    }
    rpcName = 'atom_grant_complimentary_days_v1'
    args = { p_subscription_id: payload.subscription_id, p_days: payload.days,
      p_reason: payload.reason, p_note: payload.note || null,
      p_request_key: payload.request_key, p_actor: auth.actorId }
  } else if (action === 'reverse') {
    if (typeof payload.grant_id !== 'string' || !uuid.test(payload.grant_id)
        || typeof payload.reason !== 'string' || payload.reason.trim().length < 3
        || payload.reason.length > 2000) {
      return reply(400, { ok: false, error: 'INVALID_REVERSAL_PAYLOAD' })
    }
    rpcName = 'atom_reverse_complimentary_days_v1'
    args = { p_grant_id: payload.grant_id, p_reason: payload.reason, p_actor: auth.actorId }
  } else return reply(400, { ok: false, error: 'INVALID_ACTION' })
  const { data, error } = await admin.rpc(rpcName, args)
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404
      : error.code === '23505' || error.code === '23514' ? 409
      : error.code === '22023' ? 400 : 500
    return reply(status, { ok: false, error: error.message })
  }
  return reply(200, data)
}
