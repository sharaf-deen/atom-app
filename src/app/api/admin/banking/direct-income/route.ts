export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function reply(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
const uuid = (value: unknown) => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return reply({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (me.role !== 'super_admin') return reply({ ok: false, error: 'FORBIDDEN' }, 403)
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return reply({ ok: false, error: 'INVALID_BODY' }, 400) }
  const admin = createSupabaseAdminClient()
  const action = String(body.action ?? '')
  if (action === 'match') {
    const mode = String(body.mode ?? '')
    const note = String(body.note ?? '').trim()
    const title = String(body.title ?? '').trim()
    const sourceId = body.source_id
    if (!uuid(body.bank_transaction_id) ||
        !['store_sale', 'external_income', 'new_small_income'].includes(mode) ||
        (mode !== 'new_small_income' && !uuid(sourceId)) ||
        note.length < 15 || note.length > 500 ||
        (mode === 'new_small_income' && (title.length < 5 || title.length > 140 || !['bar','store','other'].includes(String(body.source_key ?? '')))) ||
        body.verified !== true)
      return reply({ ok: false, error: 'INVALID_OR_UNVERIFIED_MATCH' }, 400)

    const { data, error } = await admin.rpc('bank_direct_income_match_v1', {
      p_bank_transaction_id: body.bank_transaction_id,
      p_mode: mode,
      p_source_id: mode === 'new_small_income' ? null : sourceId,
      p_title: mode === 'new_small_income' ? title : null,
      p_source_key: mode === 'new_small_income' ? body.source_key : null,
      p_note: note,
      p_actor: me.id,
    })
    if (error) return reply({ ok: false, error: 'DIRECT_MATCH_FAILED', details: error.message }, 409)
    return reply({ ok: true, match_id: data })
  }
  if (action === 'release') {
    if (!uuid(body.match_id) || String(body.reason ?? '').trim().length < 10)
      return reply({ ok: false, error: 'INVALID_RELEASE_REASON' }, 400)
    const { data, error } = await admin.rpc('bank_direct_income_release_v1', {
      p_match_id: body.match_id,
      p_reason: String(body.reason).trim().slice(0, 500),
      p_actor: me.id,
    })
    if (error) return reply({ ok: false, error: 'RELEASE_FAILED', details: error.message }, 409)
    return reply({ ok: true, match_id: data })
  }
  return reply({ ok: false, error: 'UNKNOWN_ACTION' }, 400)
}
