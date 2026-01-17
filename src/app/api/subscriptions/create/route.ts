// src/app/api/subscriptions/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isPlan(v: unknown): v is Plan {
  return v === '1m' || v === '3m' || v === '6m' || v === '12m' || v === 'sessions'
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function dateOnlyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

function addDays(dateOnlyStr: string, days: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// addMonths "safe": clamp to last day of target month if needed (handles 31st)
function addMonthsSafe(dateOnlyStr: string, months: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)

  const base = new Date(Date.UTC(y, m - 1, d))
  const targetMonth = base.getUTCMonth() + months

  const lastDayInTarget = new Date(Date.UTC(y, m - 1, 1))
  lastDayInTarget.setUTCMonth(targetMonth + 1, 0) // last day of target month
  const lastDay = lastDayInTarget.getUTCDate()

  const clampedDay = Math.min(d, lastDay)
  const out = new Date(Date.UTC(y, m - 1, clampedDay))
  out.setUTCMonth(targetMonth)
  return out.toISOString().slice(0, 10)
}

function normQR(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const raw = v.trim()
  if (!raw) return null
  // tolère ATOM:xxxx => atom:xxxx
  if (raw.startsWith('ATOM:')) return 'atom:' + raw.slice(5)
  return raw
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth + staff only
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const isStaff = ['reception', 'admin', 'super_admin'].includes(me?.role ?? 'member')
    if (!isStaff) return json(403, { ok: false, error: 'FORBIDDEN' })

    // 2) Parse payload
    const body = await req.json().catch(() => ({} as any))

    const planRaw = body?.plan
    if (!isPlan(planRaw)) {
      return json(400, { ok: false, error: 'INVALID_PLAN' })
    }
    const plan: Plan = planRaw

    const amountNum = Number(body?.amount ?? 0)
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return json(400, { ok: false, error: 'INVALID_AMOUNT', details: 'Amount must be a positive number.' })
    }
    // si tu veux limiter:
    if (amountNum > 1_000_000_000) {
      return json(400, { ok: false, error: 'AMOUNT_TOO_LARGE' })
    }
    const amount = amountNum

    let memberId: string | null = typeof body?.memberId === 'string' ? body.memberId.trim() : null
    const member_qr = normQR(body?.member_qr ?? body?.qr ?? body?.code)
    const member_email = typeof body?.member_email === 'string' ? body.member_email.trim().toLowerCase() : null

    // 3) Resolve member_id (memberId | qr | email)
    if (!memberId) {
      if (member_qr) {
        const { data: profByQr, error: qrErr } = await supa
          .from('profiles')
          .select('user_id')
          .eq('qr_code', member_qr)
          .maybeSingle<{ user_id: string }>()
        if (qrErr) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: qrErr.message })
        memberId = profByQr?.user_id ?? null
      } else if (member_email) {
        const { data: profByEmail, error: emErr } = await supa
          .from('profiles')
          .select('user_id')
          .eq('email', member_email)
          .maybeSingle<{ user_id: string }>()
        if (emErr) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: emErr.message })
        memberId = profByEmail?.user_id ?? null
      }
    }

    if (!memberId) {
      return json(400, {
        ok: false,
        error: 'INVALID_MEMBER_ID',
        details: 'Member not found.',
        hint: 'Provide memberId (uuid) OR member_qr (atom:uuid) OR member_email',
      })
    }

    // (Optionnel mais utile) Vérifier que le member existe vraiment
    const { data: exists, error: exErr } = await supa
      .from('profiles')
      .select('user_id')
      .eq('user_id', memberId)
      .maybeSingle<{ user_id: string }>()
    if (exErr) return json(500, { ok: false, error: 'PROFILE_CHECK_FAILED', details: exErr.message })
    if (!exists) return json(404, { ok: false, error: 'MEMBER_NOT_FOUND' })

    // 4) Build insert payload
    const paid_at = new Date().toISOString()
    const subscription_type = plan === 'sessions' ? 'sessions' : 'time'
    const status = 'active' as const

    const payload: any = {
      member_id: memberId,
      plan,
      subscription_type,
      status,
      amount,
      paid_at,
    }

    if (plan === 'sessions') {
      // Sessions: start_date optional (default today UTC), fixed 45d validity
      const requestedStart = isISODateOnly(body?.start_date) ? String(body.start_date) : dateOnlyUTC()
      const sessionsTotalRaw = Number(body?.sessions_total ?? 10)
      const sessions_total = Math.max(1, Math.min(10, Math.floor(Number.isFinite(sessionsTotalRaw) ? sessionsTotalRaw : 10)))

      payload.start_date = requestedStart
      payload.end_date = addDays(requestedStart, 45)
      payload.sessions_total = sessions_total
      payload.sessions_used = 0
    } else {
      // Time plans require start_date
      const start = isISODateOnly(body?.start_date) ? String(body.start_date) : null
      if (!start) return json(400, { ok: false, error: 'START_DATE_REQUIRED', details: 'start_date (YYYY-MM-DD) is required for time plans.' })

      const months = plan === '1m' ? 1 : plan === '3m' ? 3 : plan === '6m' ? 6 : 12
      payload.start_date = start
      payload.end_date = addMonthsSafe(start, months)
      payload.sessions_total = null
      payload.sessions_used = null
    }

    // 5) Insert
    const { data: inserted, error: insErr } = await supa
      .from('subscriptions')
      .insert(payload)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (insErr) {
      return json(500, { ok: false, error: 'INSERT_FAILED', details: insErr.message })
    }

    return json(200, { ok: true, id: inserted?.id, ...payload })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
