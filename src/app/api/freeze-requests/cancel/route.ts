export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })

  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })

  let payload: any = null
  try { payload = await req.json() } catch { payload = null }
  const id = String(payload?.id || '')
  if (!id) return json(400, { ok: false, error: 'Missing freeze request ID.' })

  const { data: requestRow, error: readErr } = await admin
    .from('freeze_requests')
    .select('id,member_user_id,requested_by_auth_user_id,requested_start_date,requested_end_date,status')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return json(500, { ok: false, error: readErr.message })
  if (!requestRow) return json(404, { ok: false, error: 'Freeze request not found.' })
  if (requestRow.status !== 'pending') {
    return json(409, { ok: false, error: 'Only a pending freeze request can be cancelled.' })
  }
  if (requestRow.requested_by_auth_user_id !== me.data.user.id) {
    return json(403, { ok: false, error: 'Only the account that submitted this request can cancel it.' })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateErr } = await admin
    .from('freeze_requests')
    .update({
      status: 'canceled',
      canceled_by_auth_user_id: me.data.user.id,
      canceled_at: now,
      processed_at: now,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (updateErr) return json(500, { ok: false, error: updateErr.message })
  if (!updated) return json(409, { ok: false, error: 'This request is no longer pending.' })

  // Best-effort lifecycle notification. The request remains cancelled even if
  // the notification insert fails.
  await admin.from('notifications').insert({
    user_id: me.data.user.id,
    member_id: requestRow.member_user_id,
    created_by: null,
    kind: 'system',
    title: 'Freeze request cancelled',
    body: `Your freeze request for ${fmtDate(requestRow.requested_start_date)} → ${fmtDate(requestRow.requested_end_date)} was cancelled. No subscription change was made.`,
  })

  return json(200, { ok: true, status: 'canceled' })
}
