export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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
  if (!me) return { error: json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401) } as const
  if (me.role !== 'super_admin') return { error: json({ ok: false, error: 'FORBIDDEN' }, 403) } as const
  return { me } as const
}

export async function POST(req: Request) {
  const access = await gate()
  if ('error' in access) return access.error

  let body: any
  try { body = await req.json() } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const action = String(body?.action ?? '').trim()
  const admin = createSupabaseAdminClient()

  if (action === 'match') {
    const bankTransactionId = String(body?.bank_transaction_id ?? '').trim()
    const batchId = String(body?.batch_id ?? '').trim()
    const amount = money(body?.matched_amount)
    const note = cleanText(body?.note, 500)

    if (!isUuid(bankTransactionId)) return json({ ok: false, error: 'INVALID_BANK_TRANSACTION_ID' }, 400)
    if (!isUuid(batchId)) return json({ ok: false, error: 'INVALID_BATCH_ID' }, 400)
    if (!Number.isFinite(amount) || amount <= 0) return json({ ok: false, error: 'INVALID_MATCH_AMOUNT' }, 400)

    const [txResult, batchResult, legacyResult, pairResult] = await Promise.all([
      admin
        .from('bank_transactions')
        .select('id,direction,amount,transaction_date')
        .eq('id', bankTransactionId)
        .maybeSingle(),
      admin
        .from('payment_validation_batches')
        .select('id,payment_method,business_date,counted_amount,deleted_at,superseded_by_batch_id')
        .eq('id', batchId)
        .maybeSingle(),
      admin
        .from('reconciliation_bank_matches')
        .select('id')
        .eq('batch_id', batchId)
        .is('released_at', null)
        .limit(1),
      admin
        .from('bank_payment_matches')
        .select('id')
        .eq('bank_transaction_id', bankTransactionId)
        .eq('batch_id', batchId)
        .is('released_at', null)
        .limit(1),
    ])

    if (txResult.error) return json({ ok: false, error: 'BANK_TRANSACTION_LOOKUP_FAILED', details: txResult.error.message }, 500)
    if (!txResult.data) return json({ ok: false, error: 'BANK_TRANSACTION_NOT_FOUND' }, 404)
    if (txResult.data.direction !== 'credit') return json({ ok: false, error: 'ONLY_BANK_CREDITS_CAN_MATCH_PAYMENTS' }, 400)

    if (batchResult.error) return json({ ok: false, error: 'BATCH_LOOKUP_FAILED', details: batchResult.error.message }, 500)
    const batch = batchResult.data
    if (!batch || batch.deleted_at || batch.superseded_by_batch_id) {
      return json({ ok: false, error: 'PAYMENT_BATCH_NOT_ACTIVE' }, 400)
    }

    if (legacyResult.error) return json({ ok: false, error: 'LEGACY_MATCH_LOOKUP_FAILED', details: legacyResult.error.message }, 500)
    if ((legacyResult.data ?? []).length) {
      return json({ ok: false, error: 'BATCH_ALREADY_MATCHED_IN_LEGACY_RECONCILIATION' }, 409)
    }

    if (pairResult.error) return json({ ok: false, error: 'PAIR_LOOKUP_FAILED', details: pairResult.error.message }, 500)
    if ((pairResult.data ?? []).length) return json({ ok: false, error: 'MATCH_ALREADY_EXISTS' }, 409)

    const [txMatchesResult, batchMatchesResult] = await Promise.all([
      admin
        .from('bank_payment_matches')
        .select('matched_amount')
        .eq('bank_transaction_id', bankTransactionId)
        .is('released_at', null),
      admin
        .from('bank_payment_matches')
        .select('matched_amount')
        .eq('batch_id', batchId)
        .is('released_at', null),
    ])

    if (txMatchesResult.error) return json({ ok: false, error: 'TRANSACTION_MATCH_TOTAL_FAILED', details: txMatchesResult.error.message }, 500)
    if (batchMatchesResult.error) return json({ ok: false, error: 'BATCH_MATCH_TOTAL_FAILED', details: batchMatchesResult.error.message }, 500)

    const txMatched = (txMatchesResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.matched_amount ?? 0), 0)
    const batchMatched = (batchMatchesResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.matched_amount ?? 0), 0)
    const bankAmount = Number(txResult.data.amount ?? 0)
    const batchAmount = Number(batch.counted_amount ?? 0)

    if (txMatched + amount > bankAmount + 0.009) {
      return json({
        ok: false,
        error: 'MATCH_EXCEEDS_BANK_CREDIT',
        details: `Bank credit remaining: ${(bankAmount - txMatched).toFixed(2)} EGP.`,
      }, 400)
    }

    if (batchMatched + amount > batchAmount + 0.009) {
      return json({
        ok: false,
        error: 'MATCH_EXCEEDS_PAYMENT_BATCH',
        details: `Payment batch remaining: ${(batchAmount - batchMatched).toFixed(2)} EGP.`,
      }, 400)
    }

    const { data, error } = await admin
      .from('bank_payment_matches')
      .insert({
        bank_transaction_id: bankTransactionId,
        batch_id: batchId,
        matched_amount: amount,
        note,
        matched_by: access.me.id,
      })
      .select('id,bank_transaction_id,batch_id,matched_amount,note,matched_at,matched_by,released_at')
      .single()

    if (error) return json({ ok: false, error: 'MATCH_SAVE_FAILED', details: error.message }, 500)
    return json({ ok: true, match: data })
  }

  if (action === 'release') {
    const matchId = String(body?.match_id ?? '').trim()
    const reason = cleanText(body?.reason, 500)

    if (!isUuid(matchId)) return json({ ok: false, error: 'INVALID_MATCH_ID' }, 400)
    if (!reason || reason.length < 3) return json({ ok: false, error: 'RELEASE_REASON_REQUIRED' }, 400)

    const { data, error } = await admin
      .from('bank_payment_matches')
      .update({
        released_at: new Date().toISOString(),
        released_by: access.me.id,
        release_reason: reason,
      })
      .eq('id', matchId)
      .is('released_at', null)
      .select('id,bank_transaction_id,batch_id,matched_amount,released_at,release_reason')
      .single()

    if (error) return json({ ok: false, error: 'MATCH_RELEASE_FAILED', details: error.message }, 500)
    return json({ ok: true, match: data })
  }

  return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400)
}
