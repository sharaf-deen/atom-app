export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const kinds = new Set(['expense', 'staff_payroll_payment', 'membership_refund'])
function reply(status: number, body: Record<string, unknown>) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return reply(401, { ok: false, error: 'NOT_AUTHENTICATED' })
  if (me.role !== 'super_admin') return reply(403, { ok: false, error: 'SUPER_ADMIN_REQUIRED' })

  let value: unknown
  try { value = await req.json() } catch {
    return reply(400, { ok: false, error: 'INVALID_JSON' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return reply(400, { ok: false, error: 'INVALID_BODY' })
  }
  const body = value as Record<string, unknown>
  const note = typeof body.reason === 'string' ? body.reason.trim() : ''
  const pairs = body.pairs
  if (body.verified !== true || !Array.isArray(pairs) || pairs.length < 1 ||
      pairs.length > 50 || note.length < 10 || note.length > 480) {
    return reply(400, { ok: false, error: 'INVALID_BULK_CONFIRMATION' })
  }
  const txs = new Set<string>()
  const sources = new Set<string>()
  for (const raw of pairs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reply(400, { ok: false, error: 'INVALID_PAIR' })
    }
    const item = raw as Record<string, unknown>
    const tx = item.bank_transaction_id
    const source = item.source_id
    const kind = item.source_kind
    if (typeof tx !== 'string' || !UUID.test(tx) ||
        typeof source !== 'string' || !UUID.test(source) ||
        typeof kind !== 'string' || !kinds.has(kind) ||
        txs.has(tx) || sources.has(kind + ':' + source)) {
      return reply(400, { ok: false, error: 'DUPLICATE_OR_INVALID_PAIR' })
    }
    txs.add(tx)
    sources.add(kind + ':' + source)
  }
  const result = await createSupabaseAdminClient().rpc('bulk_match_bank_outflows_v1', {
    p_pairs: pairs,
    p_actor: me.id,
    p_note: note,
    p_verified: true,
  })
  if (result.error) {
    const safe = ['SUPER_ADMIN_REQUIRED', 'EVIDENCE_CONFIRMATION_REQUIRED',
      'INVALID_BULK_SELECTION', 'RECONCILIATION_REASON_REQUIRED', 'INVALID_PAIR',
      'DUPLICATE_CREDIT_OR_SOURCE', 'BANK_TRANSACTION_NOT_FOUND',
      'BANK_DEBIT_NOT_ELIGIBLE', 'SOURCE_NOT_ELIGIBLE',
      'ALREADY_PARTIALLY_MATCHED', 'AMOUNT_MISMATCH']
    const code = safe.find(key => result.error?.message?.includes(key))
    return reply(code ? 409 : 500, { ok: false, error: code ?? 'BULK_MATCH_FAILED' })
  }
  return reply(200, { ok: true, result: result.data })
}
