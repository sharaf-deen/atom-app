// src/app/api/admin/stats/revenue/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // no Next static cache
export const revalidate = 0 // no ISR

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { cairoRangeBoundsUTC, cairoTodayDateOnly } from '@/lib/cairoTime'
import { computeRecognizedSubscriptionRevenue } from '@/lib/subscriptionRevenue'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'
type RevenueMode = 'cash' | 'recognized'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}
function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function todayUTC() {
  return cairoTodayDateOnly()
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  // 🔒 PROTECTION: service role endpoint must not be public
  const gate = await requireAdmin()
  if (!gate.ok) return noStore(gate.res)

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !service) {
      return noStore(NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 }))
    }

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') ?? 'kpi').toLowerCase()

    // ------------------------------------------------------------------
    // KPI (par défaut) — conserve tes RPC existantes
    // ------------------------------------------------------------------
    if (type === 'kpi') {
      // RPCs (assure-toi d’avoir créé ces fonctions SQL côté Supabase)
      const { data: a, error: ea } = await admin.rpc('atom_active_members_today'); if (ea) throw ea
      const { data: d, error: ed } = await admin.rpc('atom_dropin_with_credits_today'); if (ed) throw ed
      const { data: e, error: ee } = await admin.rpc('atom_expiring_in_7_days_from_today'); if (ee) throw ee
      const { data: c, error: ec } = await admin.rpc('atom_todays_checkins_today'); if (ec) throw ec

      // Répartition par type d’abonnement actif (mensuel/trimestriel/annuel/sessions)
      const { data: t, error: et } = await admin.rpc('atom_active_by_type_today'); if (et) throw et
      const types = t?.[0] ?? { monthly: 0, quarterly: 0, yearly: 0, dropin: 0 }

      const resp = NextResponse.json({
        ok: true,
        mode: 'kpi',
        date: todayUTC(),
        kpis: {
          active_members: Number(a?.[0]?.count ?? 0),
          dropin_with_credits: Number(d?.[0]?.count ?? 0),
          expiring_in_7_days: Number(e?.[0]?.count ?? 0),
          todays_checkins: Number(c?.[0]?.count ?? 0),
          active_by_type: {
            monthly: Number((types as any).monthly ?? 0),
            quarterly: Number((types as any).quarterly ?? 0),
            yearly: Number((types as any).yearly ?? 0),
            dropin: Number((types as any).dropin ?? 0),
          },
        },
      })
      return noStore(resp)
    }

    // ------------------------------------------------------------------
    // REVENUE — agrège depuis subscriptions
    //  - query params: ?type=revenue&from=YYYY-MM-DD&to=YYYY-MM-DD
    //  - défaut: derniers 30 jours (inclus)
    // ------------------------------------------------------------------
    if (type === 'revenue') {
      let from = searchParams.get('from')
      let to = searchParams.get('to')
      const revenueMode = (searchParams.get('mode') ?? 'cash').toLowerCase() === 'recognized' ? 'recognized' : 'cash'

      if (!isISODateOnly(from) || !isISODateOnly(to) || (from! > to!)) {
        to = todayUTC()
        from = addDays(to, -29)
      }

      const plans: Plan[] = ['1m', '3m', '6m', '12m', 'sessions']

      if (revenueMode === 'cash') {
        const { startISO, endISO } = cairoRangeBoundsUTC(from!, to!)

        const { data: rows, error: qErr } = await admin
          .from('subscriptions')
          .select('plan, amount, paid_at')
          .gte('paid_at', startISO)
          .lt('paid_at', endISO)
          .limit(100000)

        if (qErr) {
          return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: qErr.message }, { status: 500 }))
        }

        const byPlan: Record<Plan, number> = { '1m': 0, '3m': 0, '6m': 0, '12m': 0, 'sessions': 0 }
        const dailyMap = new Map<string, number>()
        for (let d = from!; d < addDays(to!, 1); d = addDays(d, 1)) dailyMap.set(d, 0)

        let sum = 0
        for (const r of rows ?? []) {
          const amt = Number((r as any).amount || 0)
          sum += amt
          const p = (r as any).plan as Plan | null
          if (p && plans.includes(p)) byPlan[p] += amt

          const paidAt = (r as any).paid_at as string | null
          if (paidAt) {
            const day = new Date(paidAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
            if (dailyMap.has(day)) dailyMap.set(day, (dailyMap.get(day) || 0) + amt)
          }
        }

        const daily = Array.from(dailyMap.entries())
          .filter(([d]) => d >= from! && d <= to!)
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([date, val]) => ({ date, sum: Number(val.toFixed(2)) }))

        const monthMap = new Map<string, number>()
        for (const row of daily) monthMap.set(row.date.slice(0, 7), (monthMap.get(row.date.slice(0, 7)) || 0) + row.sum)
        const monthly = Array.from(monthMap.entries()).sort((a,b)=>a[0]<b[0]?-1:1).map(([month,val])=>({ month, sum: Number(val.toFixed(2)) }))

        const resp = NextResponse.json({
          ok: true,
          mode: 'revenue',
          revenue_mode: revenueMode as RevenueMode,
          range: { from, to, days: daily.length },
          totals: {
            sum: Number(sum.toFixed(2)),
            by_plan: byPlan,
          },
          daily,
          monthly,
        })
        return noStore(resp)
      }

      const { data: timeRows, error: timeErr } = await admin
        .from('subscriptions')
        .select('plan, amount, amount_due, start_date, end_date, frozen_from, frozen_until')
        .neq('plan', 'sessions')
        .lte('start_date', to!)
        .gt('end_date', from!)
        .limit(100000)

      if (timeErr) {
        return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: timeErr.message }, { status: 500 }))
      }

      const { startISO, endISO } = cairoRangeBoundsUTC(from!, to!)
      const { data: sessionRows, error: sessionErr } = await admin
        .from('subscriptions')
        .select('plan, amount, amount_due, paid_at')
        .eq('plan', 'sessions')
        .gte('paid_at', startISO)
        .lt('paid_at', endISO)
        .limit(100000)

      if (sessionErr) {
        return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: sessionErr.message }, { status: 500 }))
      }

      const recognized = computeRecognizedSubscriptionRevenue([...(timeRows ?? []), ...(sessionRows ?? [])] as any[], from!, to!)
      const monthly = recognized.monthly
      const resp = NextResponse.json({
        ok: true,
        mode: 'revenue',
        revenue_mode: revenueMode as RevenueMode,
        range: { from, to, days: monthly.length },
        totals: {
          sum: recognized.sum,
          by_plan: recognized.totalsByPlan,
        },
        daily: [],
        monthly,
        note: 'Time plans are spread across active service days. Freeze days pause recognition and shift revenue forward.',
      })
      return noStore(resp)
    }

    return noStore(
      NextResponse.json(
        { ok: false, error: 'INVALID_TYPE', hint: 'Use ?type=kpi or ?type=revenue' },
        { status: 400 },
      ),
    )
  } catch (err: any) {
    return noStore(NextResponse.json({ ok: false, error: err?.message ?? 'Server error' }, { status: 500 }))
  }
}
