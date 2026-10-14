export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { isISODateOnly } from '@/lib/cairoTime'

type FreezeAction = 'create' | 'update' | 'delete'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const response = (status: number, body: unknown) => NextResponse.json(body, { status })

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return response(401, { ok: false, error: 'Not authenticated' })
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
  if (profileError) return response(500, { ok: false, error: 'Unable to verify role' })
  if (profile?.role !== 'super_admin') return response(403, { ok: false, error: 'Super Admin required' })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid payload')
    body = parsed as Record<string, unknown>
  } catch { return response(400, { ok: false, error: 'Invalid request body' }) }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!uuidPattern.test(id)) return response(400, { ok: false, error: 'Invalid subscription ID' })
  const action: FreezeAction = body.clear === true ? 'delete'
    : body.action === 'create' || body.action === 'update' || body.action === 'delete' ? body.action
    : typeof body.freeze_id === 'string' && body.freeze_id ? 'update' : 'create'
  const freezeId = typeof body.freeze_id === 'string' ? body.freeze_id : null
  if (action !== 'create' && (!freezeId || !uuidPattern.test(freezeId))) {
    return response(400, { ok: false, error: 'Explicit freeze ID required' })
  }
  const from = typeof body.from === 'string' ? body.from : null
  const to = typeof body.to === 'string' ? body.to : null
  if (action !== 'delete' && (!isISODateOnly(from) || !isISODateOnly(to))) {
    return response(400, { ok: false, error: 'Invalid freeze date range' })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return response(500, { ok: false, error: 'Service client unavailable' })
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('manage_subscription_freeze_atomic', {
    p_subscription_id: id,
    p_action: action,
    p_freeze_id: freezeId,
    p_from: action === 'delete' ? null : from,
    p_to: action === 'delete' ? null : to,
    p_actor: auth.user.id,
  })
  if (error) {
    const status = error.code === '23505' ? 409 : error.code === 'P0002' ? 404
      : error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500
    return response(status, { ok: false, error: error.message })
  }
  return response(200, data)
}
