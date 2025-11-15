// src/app/api/subscriptions/create/route.ts
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
function dateOnly(d = new Date()) {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}
function addDays(dateOnlyStr: string, days: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
function addMonths(dateOnlyStr: string, months: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  return dt.toISOString().slice(0, 10)
}
function normQR(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const raw = v.trim()
  if (!raw) return null
  return raw.startsWith('ATOM:') ? 'atom:' + raw.slice(5) : raw
}
function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth + staff only
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    const isStaff = ['reception', 'admin', 'super_admin'].includes(me?.role ?? 'member')
    if (!isStaff) return json(403, { ok: false, error: 'FORBIDDEN' })

    // 2) Parse payload
    const body = await req.json().catch(() => ({} as any))
    const plan = body?.plan as Plan | undefined
    const amountNum = Number(body?.amount ?? 0)
    const amount = Number.isFinite(amountNum) ? amountNum : 0

    let memberId: string | null = typeof body?.memberId === 'string' ? body.memberId : null
    const member_qr = normQR(body?.member_qr ?? body?.qr ?? body?.code)
    const member_email = typeof body?.member_email === 'string' ? body.member_email.trim() : null

    // 3) Validate plan
    if (!isPlan(plan)) return json(400, { ok: false, error: 'INVALID_PLAN' })

    // 4) Resolve member_id (memberId | qr | email)
    if (!memberId) {
      if (member_qr) {
        const { data: profByQr } = await supa
          .from('profiles')
          .select('user_id')
          .eq('qr_code', member_qr)
          .maybeSingle<{ user_id: string }>()
        memberId = profByQr?.user_id ?? null
      } else if (member_email) {
        const { data: profByEmail } = await supa
          .from('profiles')
          .select('user_id')
          .eq('email', member_email)
          .maybeSingle<{ user_id: string }>()
        memberId = profByEmail?.user_id ?? null
      }
    }
    if (!memberId) {
      return json(400, {
        ok: false,
        error: 'INVALID_MEMBER_ID',
        hint: 'Provide memberId (uuid) OR member_qr (atom:uuid) OR member_email',
      })
    }

    // 5) Build insert payload with only concrete (non-null) types
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
      // Sessions: optional start_date (default today), fixed 45d validity
      const requestedStart = isISODateOnly(body?.start_date) ? (body.start_date as string) : dateOnly()
      payload.start_date = requestedStart
      payload.end_date = addDays(requestedStart, 45)
      payload.sessions_total = Math.max(1, Math.min(10, Number(body?.sessions_total ?? 10)))
      payload.sessions_used = 0
    } else {
      // Time plans require start_date
      const start = isISODateOnly(body?.start_date) ? (body.start_date as string) : null
      if (!start) return json(400, { ok: false, error: 'START_DATE_REQUIRED' })

      const months = plan === '1m' ? 1 : plan === '3m' ? 3 : plan === '6m' ? 6 : 12
      payload.start_date = start
      payload.end_date = addMonths(start, months)
      payload.sessions_total = null
      payload.sessions_used = null
    }

    // 6) Insert
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
