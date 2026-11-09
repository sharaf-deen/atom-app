export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (status: number, body: Record<string, unknown>) => {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return reply(401, { ok: false, error: 'NOT_AUTHENTICATED' })
  if (me.role !== 'super_admin') return reply(403, { ok: false, error: 'SUPER_ADMIN_REQUIRED' })
  let value: unknown
  try { value = await req.json() } catch { return reply(400, { ok: false, error: 'INVALID_JSON' }) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(400, { ok: false, error: 'INVALID_BODY' })
  const body = value as Record<string, unknown>
  const note = typeof body.reason === 'string' ? body.reason.trim() : ''
  const pairs = body.pairs
  if (body.verified !== true || note.length < 10 || note.length > 480 ||
      !Array.isArray(pairs) || pairs.length < 1 || pairs.length > 50) {
    return reply(400, { ok: false, error: 'INVALID_BULK_CONFIRMATION' })
  }
  const credits = new Set<string>()
  const batches = new Set<string>()
  for (const raw of pairs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reply(400, { ok: false, error: 'INVALID_PAIR' })
    const entry = raw as Record<string, unknown>
    const credit = entry.bank_transaction_id
    const batch = entry.batch_id
    const evidence = entry.evidence
    if (typeof credit !== 'string' || !UUID.test(credit) ||
        typeof batch !== 'string' || !UUID.test(batch) ||
        typeof evidence !== 'string' || evidence.trim().length < 15 || evidence.trim().length > 480 ||
        credits.has(credit) || batches.has(batch)) {
      return reply(400, { ok: false, error: 'DUPLICATE_OR_UNVERIFIED_PAIR' })
    }
    credits.add(credit)
    batches.add(batch)
  }
  const result = await createSupabaseAdminClient().rpc('bulk_match_bank_instapay_verified_v1', {
    p_pairs: pairs, p_actor: me.id, p_note: note, p_verified: true,
  })
  if (result.error) {
    const known = ['SUPER_ADMIN_REQUIRED','EVIDENCE_CONFIRMATION_REQUIRED','INVALID_BULK_SELECTION',
      'RECONCILIATION_REASON_REQUIRED','INVALID_PAIR','PAIR_EVIDENCE_REQUIRED','DUPLICATE_CREDIT_OR_BATCH',
      'CREDIT_NOT_FOUND','BATCH_NOT_FOUND','CREDIT_NOT_ELIGIBLE','BATCH_NOT_ELIGIBLE',
      'LEGACY_BATCH_MATCHED','ALREADY_MATCHED']
    const code = known.find(item => result.error?.message.includes(item))
    return reply(code ? 409 : 500, { ok: false, error: code ?? 'BULK_MATCH_FAILED' })
  }
  return reply(200, { ok: true, result: result.data })
}
