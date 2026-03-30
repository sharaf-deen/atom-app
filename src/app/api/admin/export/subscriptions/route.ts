// src/app/api/admin/export/subscriptions/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { cairoRangeBoundsUTC } from '@/lib/cairoTime'
import { buildMonthlyRecognitionRows, subscriptionRecognitionNotes } from '@/lib/subscriptionRevenue'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function csvCell(v: any) {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

type ProfileLite = { email: string | null; first_name: string | null; last_name: string | null }

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (!['admin', 'super_admin'].includes(me?.role ?? 'member')) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    const view = (searchParams.get('view') ?? 'cash').toLowerCase() === 'recognized' ? 'recognized' : 'cash'
    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    const memberProfiles = new Map<string, ProfileLite>()
    async function hydrateProfiles(memberIds: string[]) {
      const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)))
      if (uniqueIds.length === 0) return
      const { data: profs } = await supa
        .from('profiles')
        .select('user_id, email, first_name, last_name')
        .in('user_id', uniqueIds)
      for (const p of profs ?? []) {
        memberProfiles.set(p.user_id, { email: p.email, first_name: p.first_name, last_name: p.last_name })
      }
    }

    if (view === 'cash') {
      const { startISO, endISO } = cairoRangeBoundsUTC(from, to)
      const { data: subs, error: qErr } = await supa
        .from('subscriptions')
        .select('id, member_id, plan, subscription_type, status, start_date, end_date, amount, amount_due, paid_at, payment_method, sessions_total, sessions_used')
        .gte('paid_at', startISO)
        .lt('paid_at', endISO)
        .order('paid_at', { ascending: false })
        .limit(100000)
      if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

      await hydrateProfiles((subs ?? []).map((r: any) => r.member_id).filter(Boolean))

      const header = [
        'id','member_id','member_email','first_name','last_name',
        'plan','subscription_type','status',
        'start_date','end_date',
        'sessions_total','sessions_used',
        'paid_amount','amount_due','total_subscription_value','payment_method','paid_at'
      ]

      const lines = [header.map(csvCell).join(',')]
      for (const r of subs ?? []) {
        const prof = memberProfiles.get(r.member_id) ?? { email: null, first_name: null, last_name: null }
        const totalValue = Number(r.amount ?? 0) + Number((r as any).amount_due ?? 0)
        lines.push([
          r.id,
          r.member_id,
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
          r.amount,
          (r as any).amount_due,
          totalValue.toFixed(2),
          (r as any).payment_method,
          r.paid_at,
        ].map(csvCell).join(','))
      }

      const csv = lines.join('\r\n')
      const filename = `subscriptions_cash_basis_${from}_to_${to}.csv`
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const { data: subs, error: qErr } = await supa
      .from('subscriptions')
      .select('id, member_id, plan, subscription_type, status, start_date, end_date, amount, amount_due, paid_at, payment_method, frozen_from, frozen_until')
      .eq('subscription_type', 'time')
      .lte('start_date', to)
      .gte('end_date', from)
      .order('start_date', { ascending: true })
      .limit(100000)
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    await hydrateProfiles((subs ?? []).map((r: any) => r.member_id).filter(Boolean))
    const recognized = buildMonthlyRecognitionRows((subs ?? []) as any, from, to)

    const header = [
      'month','subscription_id','member_id','member_email','first_name','last_name',
      'plan','start_date','end_date','freeze_from','freeze_until',
      'recognized_days','total_service_days','recognized_amount','total_subscription_value'
    ]
    const lines = [header.map(csvCell).join(',')]
    for (const row of recognized) {
      const prof = row.member_id ? memberProfiles.get(row.member_id) : null
      lines.push([
        row.month,
        row.subscription_id,
        row.member_id,
        prof?.email ?? null,
        prof?.first_name ?? null,
        prof?.last_name ?? null,
        row.plan,
        row.start_date,
        row.end_date,
        row.frozen_from,
        row.frozen_until,
        row.recognized_days,
        row.total_service_days,
        row.recognized_amount.toFixed(2),
        row.total_subscription_value.toFixed(2),
      ].map(csvCell).join(','))
    }
    lines.push('')
    lines.push(csvCell(`Note: ${subscriptionRecognitionNotes('recognized')}`))

    const csv = lines.join('\r\n')
    const filename = `subscriptions_monthly_recognition_${from}_to_${to}.csv`
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
