// src/app/api/admin/cash-report/export/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  cairoMonthBoundsDateOnly,
  cairoRangeBoundsUTC,
  cairoTodayDateOnly,
  cairoWeekBoundsDateOnly,
  isISODateOnly,
} from '@/lib/cairoTime'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
type Method = 'cash' | 'instapay' | 'card' | 'bank_transfer'
const METHODS: Method[] = ['cash', 'instapay', 'card', 'bank_transfer']

type RangeMode = 'day' | 'week' | 'month' | 'range'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function csvCell(v: unknown) {
  const s = String(v ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function normMethod(m: any): Method {
  const s = String(m ?? 'cash')
  if (s === 'visa') return 'card'
  if (s === 'card') return 'card'
  if (s === 'instapay') return 'instapay'
  if (s === 'bank_transfer') return 'bank_transfer'
  return 'cash'
}

function labelMethod(m: Method) {
  if (m === 'cash') return 'Cash'
  if (m === 'instapay') return 'Instapay'
  if (m === 'card') return 'Card'
  return 'Bank transfer'
}

function formatCairoDateTime(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return '—'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt)
}

function resolveRange(params: URLSearchParams): {
  mode: RangeMode
  anchorDate: string
  from: string
  to: string
  label: string
  startISO: string
  endISO: string
} {
  const today = cairoTodayDateOnly()
  const modeRaw = (params.get('mode') || 'day') as RangeMode
  const mode: RangeMode = modeRaw === 'week' || modeRaw === 'month' || modeRaw === 'range' ? modeRaw : 'day'

  const anchorDate = isISODateOnly(params.get('date')) ? (params.get('date') as string) : today
  const fromParam = isISODateOnly(params.get('from')) ? (params.get('from') as string) : today
  const toParam = isISODateOnly(params.get('to')) ? (params.get('to') as string) : fromParam

  const { from: weekFrom, to: weekTo } = cairoWeekBoundsDateOnly(anchorDate)
  const { from: monthFrom, to: monthTo } = cairoMonthBoundsDateOnly(anchorDate)

  const rFrom = mode === 'week' ? weekFrom : mode === 'month' ? monthFrom : mode === 'range' ? fromParam : anchorDate
  const rTo = mode === 'week' ? weekTo : mode === 'month' ? monthTo : mode === 'range' ? toParam : anchorDate
  const from = rFrom <= rTo ? rFrom : rTo
  const to = rFrom <= rTo ? rTo : rFrom

  const label =
    mode === 'day'
      ? `Day: ${from}`
      : mode === 'week'
      ? `Week (Mon–Sun): ${from} → ${to}`
      : mode === 'month'
      ? `Month: ${from.slice(0, 7)}`
      : `Range: ${from} → ${to}`

  const { startISO, endISO } = cairoRangeBoundsUTC(from, to)
  return { mode, anchorDate, from, to, label, startISO, endISO }
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    const role: Role = (me?.role as Role) ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const range = resolveRange(searchParams)

    const { data: pays, error: payErr } = await admin
      .from('subscription_payments')
      .select(
        'id, amount, payment_method, note, paid_at, created_at, member:profiles!subscription_payments_member_id_fkey(first_name,last_name,email,member_id)'
      )
      .gte('paid_at', range.startISO)
      .lt('paid_at', range.endISO)
      .order('paid_at', { ascending: false })
      .limit(100000)

    if (payErr) return json(500, { ok: false, error: 'PAYMENTS_QUERY_FAILED', details: payErr.message })

    const { data: exps, error: expErr } = await admin
      .from('expenses')
      .select('id, date, category_key, description, amount, payment_method')
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: false })
      .limit(100000)

    if (expErr) return json(500, { ok: false, error: 'EXPENSES_QUERY_FAILED', details: expErr.message })

    const incomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    const expenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }

    for (const r of (pays ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      incomeBy[normMethod(r.payment_method)] += amt
    }

    for (const r of (exps ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      expenseBy[normMethod(r.payment_method)] += amt
    }

    const totalIncome = METHODS.reduce((sum, method) => sum + incomeBy[method], 0)
    const totalExpenses = METHODS.reduce((sum, method) => sum + expenseBy[method], 0)
    const net = totalIncome - totalExpenses

    const lines: string[] = []
    lines.push(['Filtered cash report export', range.label].map(csvCell).join(','))
    lines.push(['Timezone', 'Africa/Cairo'].map(csvCell).join(','))
    lines.push(['From', range.from, 'To', range.to].map(csvCell).join(','))
    lines.push(['Filtered payments count', (pays ?? []).length, 'Filtered expense lines count', (exps ?? []).length].map(csvCell).join(','))
    lines.push('')

    lines.push(['Summary', 'Amount'].map(csvCell).join(','))
    lines.push(['Filtered income', totalIncome.toFixed(2)].map(csvCell).join(','))
    lines.push(['Filtered expenses', totalExpenses.toFixed(2)].map(csvCell).join(','))
    lines.push(['Filtered net', net.toFixed(2)].map(csvCell).join(','))
    for (const method of METHODS) {
      lines.push([
        `${labelMethod(method)} income`,
        incomeBy[method].toFixed(2),
        `${labelMethod(method)} expenses`,
        expenseBy[method].toFixed(2),
      ].map(csvCell).join(','))
    }
    lines.push('')

    lines.push(['Filtered payments'].map(csvCell).join(','))
    lines.push(
      ['paid_at_egypt', 'recorded_at_egypt', 'member_id', 'member_name', 'member_email', 'amount', 'payment_method', 'note']
        .map(csvCell)
        .join(',')
    )
    for (const r of (pays ?? []) as any[]) {
      const memberName = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim()
      const amount = Number(r.amount ?? 0)
      lines.push(
        [
          formatCairoDateTime(r.paid_at ?? r.created_at),
          formatCairoDateTime(r.created_at),
          r.member?.member_id ?? '',
          memberName,
          r.member?.email ?? '',
          Number.isFinite(amount) ? amount.toFixed(2) : '',
          labelMethod(normMethod(r.payment_method)),
          r.note ?? '',
        ]
          .map(csvCell)
          .join(',')
      )
    }
    lines.push('')

    lines.push(['Filtered expenses'].map(csvCell).join(','))
    lines.push(['date_egypt', 'category', 'description', 'amount', 'payment_method'].map(csvCell).join(','))
    for (const r of (exps ?? []) as any[]) {
      const amount = Number(r.amount ?? 0)
      lines.push(
        [
          r.date ?? '',
          r.category_key ?? '',
          r.description ?? '',
          Number.isFinite(amount) ? amount.toFixed(2) : '',
          labelMethod(normMethod(r.payment_method)),
        ]
          .map(csvCell)
          .join(',')
      )
    }

    const filename = `cash-report_${range.from}_${range.to}.csv`

    return new NextResponse(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'UNEXPECTED', details: String(e?.message || e) })
  }
}
