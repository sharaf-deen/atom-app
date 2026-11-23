export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { CAIRO_TZ, cairoLocalToUTC, cairoTodayDateOnly } from '@/lib/cairoTime'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { normalizeRole } from '@/lib/rbac'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(status: number, payload: Record<string, unknown>) {
  const result = NextResponse.json(payload, { status })
  result.headers.set('Cache-Control', 'no-store')
  return result
}

function validDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const dt = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === value
}

function cairoTimeOfDay(iso: string) {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) throw new Error('INVALID_EXISTING_DATE')
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(dt)
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]))
  return { hour: Number(map.hour) % 24, minute: Number(map.minute), second: Number(map.second) }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const paymentId = String(params?.id ?? '')
  if (!UUID.test(paymentId)) return json(400, { ok: false, error: 'INVALID_PAYMENT_ID' })

  const supa = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supa.auth.getUser()
  if (authError || !auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
  const { data: profile, error: profileError } = await supa
    .from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
  if (profileError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED' })
  if (normalizeRole(profile?.role) !== 'super_admin') {
    return json(403, { ok: false, error: 'SUPER_ADMIN_REQUIRED' })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { ok: false, error: 'INVALID_BODY' })
  }
  const date = String(body.payment_date ?? '').trim()
  const expected = String(body.expected_paid_at ?? '').trim()
  const reason = String(body.reason ?? '').trim()
  if (!validDateOnly(date) || !expected || Number.isNaN(new Date(expected).getTime()) ||
      reason.length < 5 || reason.length > 500) {
    return json(400, { ok: false, error: 'INVALID_CORRECTION_REQUEST' })
  }
  if (date > cairoTodayDateOnly()) return json(400, { ok: false, error: 'FUTURE_PAYMENT_DATE' })

  const admin = createSupabaseAdminClient()
  const { data: payment, error: readError } = await admin
    .from('subscription_payments').select('id, paid_at')
    .eq('id', paymentId).maybeSingle()
  if (readError) return json(500, { ok: false, error: 'PAYMENT_LOOKUP_FAILED' })
  if (!payment) return json(404, { ok: false, error: 'PAYMENT_NOT_FOUND' })
  if (payment.paid_at !== expected && new Date(String(payment.paid_at)).getTime() !== new Date(expected).getTime()) {
    return json(409, { ok: false, error: 'STALE_PAYMENT_DATE' })
  }
  if (!payment.paid_at) return json(409, { ok: false, error: 'PAYMENT_WITHOUT_DATE' })

  const clock = cairoTimeOfDay(payment.paid_at)
  const newPaidAt = cairoLocalToUTC({ dateOnly: date, ...clock }).toISOString()
  const checkDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(newPaidAt))
  if (checkDate !== date) return json(400, { ok: false, error: 'INVALID_CAIRO_DATE' })

  const { data, error } = await admin.rpc('correct_subscription_payment_date_v1', {
    p_payment_id: paymentId,
    p_expected_paid_at: expected,
    p_new_paid_at: newPaidAt,
    p_reason: reason,
    p_actor: auth.user.id,
  })
  if (error) {
    // Never expose raw SQL diagnostics or underlying member data.
    const unavailable = error.code === 'PGRST202' || error.code === '42883'
    return json(unavailable ? 503 : 409, {
      ok: false, error: unavailable ? 'PAYMENT_DATE_MIGRATION_NOT_DEPLOYED' : 'PAYMENT_DATE_CORRECTION_REJECTED',
    })
  }
  return json(200, { ok: true, result: data })
}
