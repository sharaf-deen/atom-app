export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const SOURCE_KINDS = ['expense','staff_payroll_payment','membership_refund'] as const
type SourceKind = typeof SOURCE_KINDS[number]

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && SOURCE_KINDS.includes(value as SourceKind)
}
function money(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}
function cleanText(value: unknown, max: number) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}
async function gate() {
  const me = await getSessionUser()
  if (!me) return { error: json({ ok:false,error:'NOT_AUTHENTICATED' },401) } as const
  if (me.role !== 'super_admin') return { error: json({ ok:false,error:'FORBIDDEN' },403) } as const
  return { me } as const
}
async function loadSource(admin: any, kind: SourceKind, id: string) {
  if (kind === 'expense') {
    const { data, error } = await admin.from('expenses')
      .select('id,date,description,amount,payment_method,category_key')
      .eq('id', id).maybeSingle()
    return { data, error, amount: data ? Number(data.amount ?? 0) : 0, active: Boolean(data) }
  }
  if (kind === 'staff_payroll_payment') {
    const { data, error } = await admin.from('staff_payroll_salary_payments')
      .select('id,payment_date,staff_name_snapshot,amount,payment_method,reference,status')
      .eq('id', id).maybeSingle()
    return { data, error, amount: data ? Number(data.amount ?? 0) : 0, active: Boolean(data && data.status === 'active') }
  }
  const { data, error } = await admin.from('membership_refunds')
    .select('id,amount,refund_method,status,paid_at,refunded_at,reason')
    .eq('id', id).maybeSingle()
  return { data, error, amount: data ? Number(data.amount ?? 0) : 0, active: Boolean(data && data.status === 'paid') }
}

export async function POST(req: Request) {
  const access = await gate()
  if ('error' in access) return access.error
  let body: any
  try { body = await req.json() } catch { return json({ok:false,error:'INVALID_BODY'},400) }

  const action = String(body?.action ?? '').trim()
  const admin = createSupabaseAdminClient()

  if (action === 'match') {
    const bankTransactionId = String(body?.bank_transaction_id ?? '').trim()
    const sourceKind = String(body?.source_kind ?? '').trim()
    const sourceId = String(body?.source_id ?? '').trim()
    const amount = money(body?.matched_amount)
    const note = cleanText(body?.note, 500)

    if (!isUuid(bankTransactionId)) return json({ok:false,error:'INVALID_BANK_TRANSACTION_ID'},400)
    if (!isSourceKind(sourceKind)) return json({ok:false,error:'INVALID_SOURCE_KIND'},400)
    if (!isUuid(sourceId)) return json({ok:false,error:'INVALID_SOURCE_ID'},400)
    if (!Number.isFinite(amount) || amount <= 0) return json({ok:false,error:'INVALID_MATCH_AMOUNT'},400)

    const [txResult, pairResult, source] = await Promise.all([
      admin.from('bank_transactions').select('id,direction,amount').eq('id',bankTransactionId).maybeSingle(),
      admin.from('bank_outflow_matches').select('id')
        .eq('bank_transaction_id',bankTransactionId)
        .eq('source_kind',sourceKind)
        .eq('source_id',sourceId)
        .is('released_at',null).limit(1),
      loadSource(admin, sourceKind, sourceId),
    ])

    if (txResult.error) return json({ok:false,error:'BANK_TRANSACTION_LOOKUP_FAILED',details:txResult.error.message},500)
    if (!txResult.data) return json({ok:false,error:'BANK_TRANSACTION_NOT_FOUND'},404)
    if (txResult.data.direction !== 'debit') return json({ok:false,error:'ONLY_BANK_DEBITS_CAN_MATCH_OUTFLOWS'},400)
    if (pairResult.error) return json({ok:false,error:'PAIR_LOOKUP_FAILED',details:pairResult.error.message},500)
    if ((pairResult.data ?? []).length) return json({ok:false,error:'MATCH_ALREADY_EXISTS'},409)
    if (source.error) return json({ok:false,error:'SOURCE_LOOKUP_FAILED',details:source.error.message},500)
    if (!source.data) return json({ok:false,error:'SOURCE_NOT_FOUND'},404)
    if (!source.active) return json({ok:false,error:'SOURCE_NOT_ACTIVE_OR_PAID'},400)

    const [txMatches, sourceMatches] = await Promise.all([
      admin.from('bank_outflow_matches').select('matched_amount')
        .eq('bank_transaction_id',bankTransactionId).is('released_at',null),
      admin.from('bank_outflow_matches').select('matched_amount')
        .eq('source_kind',sourceKind).eq('source_id',sourceId).is('released_at',null),
    ])
    if (txMatches.error) return json({ok:false,error:'TRANSACTION_MATCH_TOTAL_FAILED',details:txMatches.error.message},500)
    if (sourceMatches.error) return json({ok:false,error:'SOURCE_MATCH_TOTAL_FAILED',details:sourceMatches.error.message},500)

    const txMatched = (txMatches.data ?? []).reduce((sum:number,row:any)=>sum+Number(row.matched_amount??0),0)
    const sourceMatched = (sourceMatches.data ?? []).reduce((sum:number,row:any)=>sum+Number(row.matched_amount??0),0)
    const bankAmount = Number(txResult.data.amount ?? 0)

    if (txMatched + amount > bankAmount + 0.009) {
      return json({ok:false,error:'MATCH_EXCEEDS_BANK_DEBIT',details:`Bank debit remaining: ${(bankAmount-txMatched).toFixed(2)} EGP.`},400)
    }
    if (sourceMatched + amount > source.amount + 0.009) {
      return json({ok:false,error:'MATCH_EXCEEDS_SOURCE',details:`Source remaining: ${(source.amount-sourceMatched).toFixed(2)} EGP.`},400)
    }

    const { data, error } = await admin.from('bank_outflow_matches').insert({
      bank_transaction_id:bankTransactionId,
      source_kind:sourceKind,
      source_id:sourceId,
      matched_amount:amount,
      note,
      matched_by:access.me.id,
    }).select('id,bank_transaction_id,source_kind,source_id,matched_amount,note,matched_at').single()

    if (error) return json({ok:false,error:'MATCH_SAVE_FAILED',details:error.message},500)
    return json({ok:true,match:data})
  }

  if (action === 'release') {
    const matchId = String(body?.match_id ?? '').trim()
    const reason = cleanText(body?.reason,500)
    if (!isUuid(matchId)) return json({ok:false,error:'INVALID_MATCH_ID'},400)
    if (!reason || reason.length < 3) return json({ok:false,error:'RELEASE_REASON_REQUIRED'},400)

    const { data,error } = await admin.from('bank_outflow_matches').update({
      released_at:new Date().toISOString(),
      released_by:access.me.id,
      release_reason:reason,
    }).eq('id',matchId).is('released_at',null)
      .select('id,bank_transaction_id,source_kind,source_id,matched_amount,released_at,release_reason').single()

    if (error) return json({ok:false,error:'MATCH_RELEASE_FAILED',details:error.message},500)
    return json({ok:true,match:data})
  }

  return json({ok:false,error:'UNKNOWN_ACTION'},400)
}
