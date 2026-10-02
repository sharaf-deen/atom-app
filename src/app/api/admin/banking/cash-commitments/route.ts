export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const CATEGORIES = [
  'rent','supplier','utilities','taxes','legal_accounting',
  'federation','marketing','maintenance','payroll_other','other'
] as const

function json(body: unknown, status = 200) {
  const r = NextResponse.json(body, { status })
  r.headers.set('Cache-Control', 'no-store')
  return r
}
function isUuid(v: unknown) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}
function validDate(v: unknown) {
  const s = String(v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function clean(v: unknown, max: number) {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
async function gate() {
  const me = await getSessionUser()
  if (!me) return { error: json({ ok:false,error:'NOT_AUTHENTICATED' },401) } as const
  if (me.role !== 'super_admin') return { error: json({ ok:false,error:'FORBIDDEN' },403) } as const
  return { me } as const
}

export async function POST(req: Request) {
  const access = await gate()
  if ('error' in access) return access.error
  let body: any
  try { body = await req.json() } catch { return json({ok:false,error:'INVALID_BODY'},400) }

  const action = String(body?.action ?? '').trim()
  const admin = createSupabaseAdminClient()

  if (action === 'create') {
    const label = clean(body?.label, 200)
    const category = String(body?.category_code ?? '').trim()
    const amount = Math.round(Number(body?.amount) * 100) / 100
    const dueDate = validDate(body?.due_date)
    const note = clean(body?.note, 1000)

    if (!label) return json({ok:false,error:'LABEL_REQUIRED'},400)
    if (!CATEGORIES.includes(category as any)) return json({ok:false,error:'INVALID_CATEGORY'},400)
    if (!Number.isFinite(amount) || amount <= 0) return json({ok:false,error:'INVALID_AMOUNT'},400)
    if (!dueDate) return json({ok:false,error:'INVALID_DUE_DATE'},400)

    const { data, error } = await admin.from('bank_cash_commitments').insert({
      label,
      category_code: category,
      amount,
      due_date: dueDate,
      note,
      created_by: access.me.id,
      updated_by: access.me.id,
    }).select('*').single()

    if (error) return json({ok:false,error:'COMMITMENT_CREATE_FAILED',details:error.message},500)
    return json({ok:true,commitment:data})
  }

  if (action === 'settle') {
    const id = String(body?.id ?? '').trim()
    if (!isUuid(id)) return json({ok:false,error:'INVALID_ID'},400)
    const now = new Date().toISOString()

    const { data, error } = await admin.from('bank_cash_commitments').update({
      status:'settled',
      settled_at:now,
      settled_by:access.me.id,
      updated_at:now,
      updated_by:access.me.id,
    }).eq('id',id).eq('status','open').select('*').single()

    if (error) return json({ok:false,error:'COMMITMENT_SETTLE_FAILED',details:error.message},500)
    return json({ok:true,commitment:data})
  }

  if (action === 'cancel') {
    const id = String(body?.id ?? '').trim()
    const reason = clean(body?.reason,500)
    if (!isUuid(id)) return json({ok:false,error:'INVALID_ID'},400)
    if (!reason || reason.length < 3) return json({ok:false,error:'CANCELLATION_REASON_REQUIRED'},400)
    const now = new Date().toISOString()

    const { data, error } = await admin.from('bank_cash_commitments').update({
      status:'cancelled',
      cancelled_at:now,
      cancelled_by:access.me.id,
      cancellation_reason:reason,
      updated_at:now,
      updated_by:access.me.id,
    }).eq('id',id).eq('status','open').select('*').single()

    if (error) return json({ok:false,error:'COMMITMENT_CANCEL_FAILED',details:error.message},500)
    return json({ok:true,commitment:data})
  }

  return json({ok:false,error:'UNKNOWN_ACTION'},400)
}
