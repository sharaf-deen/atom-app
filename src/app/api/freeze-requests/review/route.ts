
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) { return NextResponse.json(body, { status }) }
function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', me.data.user.id).maybeSingle()
  if (profile?.role !== 'super_admin') return json(403, { ok: false, error: 'Only super admins can review freeze requests.' })

  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })
  let payload: any = null
  try { payload = await req.json() } catch { payload = null }
  const id = String(payload?.id || '')
  const action = String(payload?.action || '')
  const note = String(payload?.note || '').trim()
  if (!id || !['approve', 'deny'].includes(action)) return json(400, { ok: false, error: 'Invalid review action.' })
  if (action === 'deny' && !note) return json(400, { ok: false, error: 'A rejection note is required.' })

  const { data: requestRow, error: readErr } = await admin
    .from('freeze_requests')
    .select('id,subscription_id,requested_start_date,requested_end_date,status')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return json(500, { ok: false, error: readErr.message })
  if (!requestRow) return json(404, { ok: false, error: 'Freeze request not found.' })
  if (requestRow.status !== 'pending') return json(409, { ok: false, error: 'This freeze request has already been processed.' })

  if (action === 'approve') {
    if (!requestRow.subscription_id || !requestRow.requested_end_date) return json(400, { ok: false, error: 'This request is missing its subscription or end date.' })
    const expectedUntil = addDays(requestRow.requested_end_date, 1)
    const { data: applied, error: appliedErr } = await admin
      .from('subscription_freezes')
      .select('id')
      .eq('subscription_id', requestRow.subscription_id)
      .eq('freeze_from', requestRow.requested_start_date)
      .eq('freeze_until', expectedUntil)
      .is('cleared_at', null)
      .limit(1)
    if (appliedErr) return json(500, { ok: false, error: appliedErr.message })
    if ((applied ?? []).length === 0) return json(409, { ok: false, error: 'FREEZE_NOT_APPLIED' })
  }

  const { error: updateErr } = await admin
    .from('freeze_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'denied',
      processed_by: me.data.user.id,
      processed_at: new Date().toISOString(),
      admin_note: note || null,
    })
    .eq('id', id)
    .eq('status', 'pending')
  if (updateErr) return json(500, { ok: false, error: updateErr.message })
  return json(200, { ok: true, status: action === 'approve' ? 'approved' : 'denied' })
}
