export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function reply(status: number, body: Record<string, unknown>) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return reply(401, { ok: false, error: 'NOT_AUTHENTICATED' })
  if (me.role !== 'super_admin') return reply(403, { ok: false, error: 'SUPER_ADMIN_REQUIRED' })
  let data: unknown
  try {
    data = await req.json()
  } catch {
    return reply(400, { ok: false, error: 'INVALID_JSON' })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return reply(400, { ok: false, error: 'INVALID_BODY' })
  }
  const body = data as Record<string, unknown>
  const pairs = body.pairs
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (body.verified !== true || !Array.isArray(pairs) || pairs.length < 1 || pairs.length > 50
      || reason.length < 10 || reason.length > 500) {
    return reply(400, { ok: false, error: 'INVALID_BULK_CONFIRMATION' })
  }
  const credits = new Set<string>()
  const batches = new Set<string>()
  for (const entry of pairs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return reply(400, { ok: false, error: 'INVALID_PAIR' })
    }
    const item = entry as Record<string, unknown>
    if (typeof item.bank_transaction_id !== 'string' || !UUID.test(item.bank_transaction_id)
        || typeof item.batch_id !== 'string' || !UUID.test(item.batch_id)
        || credits.has(item.bank_transaction_id) || batches.has(item.batch_id)) {
      return reply(400, { ok: false, error: 'DUPLICATE_OR_INVALID_PAIR' })
    }
    credits.add(item.bank_transaction_id)
    batches.add(item.batch_id)
  }
  const admin = createSupabaseAdminClient()
  const result = await admin.rpc('bulk_match_instapay_income_v1', {
    p_pairs: pairs,
    p_actor: me.id,
    p_note: reason,
    p_verified: true,
  })
  if (result.error) {
    // Never expose raw SQL, identifiers or internal table names to the client.
    const safeCodes = [
      'SUPER_ADMIN_REQUIRED', 'INVALID_BULK_SELECTION', 'INVALID_PAIR',
      'DUPLICATE_CREDIT_OR_BATCH', 'MATCH_SOURCE_MISSING', 'CREDIT_NOT_ELIGIBLE',
      'BATCH_NOT_ELIGIBLE', 'LEGACY_BATCH_MATCHED',
      'CREDIT_ALREADY_PARTIALLY_MATCHED', 'BATCH_ALREADY_PARTIALLY_MATCHED',
      'AMOUNT_MISMATCH', 'AMBIGUOUS_CANDIDATES',
    ]
    const code = safeCodes.find(value => result.error?.message?.includes(value))
    return reply(code ? 409 : 500, { ok: false, error: code ?? 'BULK_MATCH_FAILED_RETRY_OR_CONTACT_ADMIN' })
  }
  return reply(200, { ok: true, result: result.data })
}
