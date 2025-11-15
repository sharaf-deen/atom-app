// src/app/api/admin/export/active-now/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
function todayDateOnly() {
  // UTC date-only; cohérent avec Postgres current_date (UTC sur Supabase)
  return new Date().toISOString().slice(0, 10)
}
function csvCell(v: any) {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export async function GET() {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    // Only admin / super_admin
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (!['admin', 'super_admin'].includes(me?.role ?? 'member')) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const today = todayDateOnly()
    const selectFields =
      'id, member_id, plan, subscription_type, status, start_date, end_date, amount, paid_at, sessions_total, sessions_used'

    // TIME plans actifs: start_date ≤ today ≤ end_date
    const { data: timeRows, error: timeErr } = await supa
      .from('subscriptions')
      .select(selectFields)
      .eq('subscription_type', 'time')
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today)
      .limit(50000)
    if (timeErr) return json(500, { ok: false, error: 'QUERY_TIME_FAILED', details: timeErr.message })

    // SESSIONS actifs: end_date ≥ today ET séances restantes > 0
    const { data: sessRows, error: sessErr } = await supa
      .from('subscriptions')
      .select(selectFields)
      .eq('subscription_type', 'sessions')
      .eq('status', 'active')
      .gte('end_date', today)
      .limit(50000)
    if (sessErr) return json(500, { ok: false, error: 'QUERY_SESS_FAILED', details: sessErr.message })

    const sessionActive = (sessRows ?? []).filter(
      (r: any) => (r.sessions_total ?? 0) > (r.sessions_used ?? 0)
    )

    const rows: any[] = [...(timeRows ?? []), ...sessionActive]

    // Profils pour enrichir le CSV
    const memberIds = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean)))
    const profilesMap = new Map<
      string,
      { email: string | null; first_name: string | null; last_name: string | null }
    >()
    if (memberIds.length > 0) {
      const { data: profs } = await supa
        .from('profiles')
        .select('user_id, email, first_name, last_name')
        .in('user_id', memberIds)
      for (const p of profs ?? []) {
        profilesMap.set(p.user_id, {
          email: p.email,
          first_name: p.first_name,
          last_name: p.last_name,
        })
      }
    }

    const header = [
      'id',
      'member_id',
      'member_email',
      'first_name',
      'last_name',
      'plan',
      'subscription_type',
      'status',
      'start_date',
      'end_date',
      'sessions_total',
      'sessions_used',
      'sessions_remaining',
      'amount',
      'paid_at',
    ]
    const lines = [header.map(csvCell).join(',')]

    for (const r of rows) {
      const prof =
        profilesMap.get(r.member_id) ?? { email: null, first_name: null, last_name: null }
      const remaining =
        r.subscription_type === 'sessions'
          ? Math.max((r.sessions_total ?? 0) - (r.sessions_used ?? 0), 0)
          : ''
      lines.push(
        [
          prof.email,
          prof.first_name,
          prof.last_name,
          r.plan,
          r.subscription_type,
          r.status,
          r.start_date,
          r.end_date,
          r.sessions_total,
          r.sessions_used,
          remaining,
          r.amount,
          r.paid_at,
        ].map(csvCell).join(',')
      )
    }

    const csv = lines.join('\r\n')
    const filename = `subscriptions_active_now_${today}.csv`
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
