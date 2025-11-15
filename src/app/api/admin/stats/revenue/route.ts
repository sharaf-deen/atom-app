// src/app/api/admin/stats/revenue/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'   // pas de cache statique côté Next
export const revalidate = 0              // pas d'ISR

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}
function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function todayUTC() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !service) {
      return noStore(NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 }))
    }

    const admin = createClient(url, service)

    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') ?? 'kpi').toLowerCase()

    // ------------------------------------------------------------------
    // BRANCHE KPI (par défaut) — conserve tes RPC existantes
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
            monthly: Number(types.monthly ?? 0),
            quarterly: Number(types.quarterly ?? 0),
            yearly: Number(types.yearly ?? 0),
            dropin: Number(types.dropin ?? 0),
          },
        },
      })
      return noStore(resp)
    }

    // ------------------------------------------------------------------
    // BRANCHE REVENUE — agrège depuis subscriptions (pas besoin de RPC)
    //  - query params: ?type=revenue&from=YYYY-MM-DD&to=YYYY-MM-DD
    //  - défaut: derniers 30 jours (inclus)
    // ------------------------------------------------------------------
    if (type === 'revenue') {
      let from = searchParams.get('from')
      let to = searchParams.get('to')

      if (!isISODateOnly(from) || !isISODateOnly(to) || (from! > to!)) {
        to = todayUTC()
        from = addDays(to, -29)
      }

      const toExclusive = addDays(to!, +1)

      // Récupère toutes les souscriptions payées dans l’intervalle (paid_at)
      const { data: rows, error: qErr } = await admin
        .from('subscriptions')
        .select('plan, amount, paid_at')
        .gte('paid_at', from!)
        .lt('paid_at', toExclusive)
        .limit(100000)

      if (qErr) {
        return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: qErr.message }, { status: 500 }))
      }

      const plans: Plan[] = ['1m', '3m', '6m', '12m', 'sessions']
      const byPlan: Record<Plan, number> = { '1m': 0, '3m': 0, '6m': 0, '12m': 0, 'sessions': 0 }

      const dailyMap = new Map<string, number>()
      // init toutes les dates à 0 (pour un graphe continu)
      for (let d = from!; d < toExclusive; d = addDays(d, 1)) {
        dailyMap.set(d, 0)
      }

      let sum = 0
      for (const r of rows ?? []) {
        const amt = Number((r as any).amount || 0)
        sum += amt
        const p = (r as any).plan as Plan | null
        if (p && plans.includes(p)) byPlan[p] += amt

        const paidAt = (r as any).paid_at as string | null
        if (paidAt) {
          const day = new Date(paidAt).toISOString().slice(0, 10)
          if (dailyMap.has(day)) {
            dailyMap.set(day, (dailyMap.get(day) || 0) + amt)
          }
        }
      }

      const daily = Array.from(dailyMap.entries())
        .filter(([d]) => d >= from! && d <= to!)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, val]) => ({ date, sum: Number(val.toFixed(2)) }))

      const resp = NextResponse.json({
        ok: true,
        mode: 'revenue',
        range: { from, to, days: daily.length },
        totals: {
          sum: Number(sum.toFixed(2)),
          by_plan: byPlan,
        },
        daily,
      })
      return noStore(resp)
    }

    // Type inconnu
    return noStore(NextResponse.json(
      { ok: false, error: 'INVALID_TYPE', hint: 'Use ?type=kpi or ?type=revenue' },
      { status: 400 },
    ))
  } catch (err: any) {
    return noStore(NextResponse.json(
      { ok: false, error: err?.message ?? 'Server error' },
      { status: 500 },
    ))
  }
}
