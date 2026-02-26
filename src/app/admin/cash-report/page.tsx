// src/app/admin/cash-report/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser } from '@/lib/session'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Badge from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
import {
  cairoMonthBoundsDateOnly,
  cairoRangeBoundsUTC,
  cairoTodayDateOnly,
  cairoWeekBoundsDateOnly,
  isISODateOnly,
} from '@/lib/cairoTime'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
const ALLOWED: Role[] = ['admin', 'super_admin']

type Method = 'cash' | 'instapay' | 'card' | 'bank_transfer'
const METHODS: Method[] = ['cash', 'instapay', 'card', 'bank_transfer']

function formatEGP(n: number) {
  const v = Number(n ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)
  } catch {
    return `${v.toFixed(2)} EGP`
  }
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

function badgeClassForMethod(m: Method) {
  if (m === 'cash') return 'bg-emerald-50 text-emerald-700'
  if (m === 'instapay') return 'bg-sky-50 text-sky-700'
  if (m === 'card') return 'bg-violet-50 text-violet-700'
  if (m === 'bank_transfer') return 'bg-amber-50 text-amber-800'
  return ''
}

export default async function AdminCashReportPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/cash-report')

  if (!ALLOWED.includes(me.role as Role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Cash Report</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access this page."
            nextPath="/admin/cash-report"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const today = cairoTodayDateOnly()

  const modeRaw = typeof searchParams.mode === 'string' ? searchParams.mode : 'day'
  const mode: 'day' | 'week' | 'month' | 'range' =
    modeRaw === 'week' || modeRaw === 'month' || modeRaw === 'range' ? modeRaw : 'day'

  const anchorDate = isISODateOnly(typeof searchParams.date === 'string' ? searchParams.date : null)
    ? (searchParams.date as string)
    : today

  const rangeFromParam = isISODateOnly(typeof searchParams.from === 'string' ? searchParams.from : null)
    ? (searchParams.from as string)
    : today
  const rangeToParam = isISODateOnly(typeof searchParams.to === 'string' ? searchParams.to : null)
    ? (searchParams.to as string)
    : rangeFromParam

  const { from: weekFrom, to: weekTo } = cairoWeekBoundsDateOnly(anchorDate)
  const { from: monthFrom, to: monthTo } = cairoMonthBoundsDateOnly(anchorDate)

  const rangeFrom = mode === 'week' ? weekFrom : mode === 'month' ? monthFrom : mode === 'range' ? rangeFromParam : anchorDate
  const rangeTo = mode === 'week' ? weekTo : mode === 'month' ? monthTo : mode === 'range' ? rangeToParam : anchorDate

  const safeFrom = rangeFrom <= rangeTo ? rangeFrom : rangeTo
  const safeTo = rangeFrom <= rangeTo ? rangeTo : rangeFrom

  const rangeLabel =
    mode === 'day'
      ? `Day: ${safeFrom}`
      : mode === 'week'
      ? `Week (Mon–Sun): ${safeFrom} → ${safeTo}`
      : mode === 'month'
      ? `Month: ${safeFrom.slice(0, 7)}`
      : `Range: ${safeFrom} → ${safeTo}`

  const admin = createSupabaseAdminClient()

  const { startISO, endISO } = cairoRangeBoundsUTC(safeFrom, safeTo)

  // Income from subscription_payments (created_at in UTC bounds for Cairo day)
  const { data: pays, error: payErr } = await admin
    .from('subscription_payments')
    .select('amount, payment_method')
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .limit(10000)

  const incomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  for (const r of (pays ?? []) as any[]) {
    const amt = Number(r.amount ?? 0)
    if (!Number.isFinite(amt)) continue
    incomeBy[normMethod(r.payment_method)] += amt
  }

  // Expenses for the same Cairo date range (expenses.date is YYYY-MM-DD)
  const { data: exps, error: expErr } = await admin
    .from('expenses')
    .select('id, date, category_key, description, amount, payment_method')
    .gte('date', safeFrom)
    .lte('date', safeTo)
    .limit(10000)

  const expenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  for (const r of (exps ?? []) as any[]) {
    const amt = Number(r.amount ?? 0)
    if (!Number.isFinite(amt)) continue
    expenseBy[normMethod(r.payment_method)] += amt
  }

  const totalIncome = METHODS.reduce((s, m) => s + incomeBy[m], 0)
  const totalExpenses = METHODS.reduce((s, m) => s + expenseBy[m], 0)
  const net = totalIncome - totalExpenses

  // Recent payments (top 10 by time)
  const { data: recentPays } = await admin
    .from('subscription_payments')
    .select(
      'id, amount, payment_method, note, created_at, member_id, member:profiles!subscription_payments_member_id_fkey(first_name,last_name,email,member_id)'
    )
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .order('created_at', { ascending: false })
    .limit(10)

  // "Recent" expenses for the range: highest 10 amounts
  const topExpenses = (exps ?? [])
    .slice()
    .sort((a: any, b: any) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
    .slice(0, 10)

  const exportQuery = new URLSearchParams()
  exportQuery.set('mode', mode)
  exportQuery.set('date', anchorDate)
  exportQuery.set('from', safeFrom)
  exportQuery.set('to', safeTo)

  const breakdownColumns = [
    { key: 'method', header: 'Method' },
    { key: 'income', header: 'Income' },
    { key: 'expenses', header: 'Expenses' },
    { key: 'net', header: 'Net' },
  ]

  const breakdownRows = METHODS.map((m) => ({
    id: m,
    method: <Badge className={badgeClassForMethod(m)}>{labelMethod(m)}</Badge>,
    income: <span className="font-semibold">{formatEGP(incomeBy[m])}</span>,
    expenses: <span className="font-semibold">{formatEGP(expenseBy[m])}</span>,
    net: <span className={`font-semibold ${incomeBy[m] - expenseBy[m] < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatEGP(incomeBy[m] - expenseBy[m])}</span>,
  }))

  const payColumns = [
    { key: 'when', header: 'When' },
    { key: 'member', header: 'Member' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
  ]

  const payRows = ((recentPays ?? []) as any[]).map((r) => {
    const m = normMethod(r.payment_method)
    const name = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || r.member?.email || '—'
    return {
      id: String(r.id),
      when: new Date(r.created_at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' }),
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-[hsl(var(--muted))]">{r.member?.member_id ?? ''}</div>
        </div>
      ),
      amount: <span className="font-semibold">{formatEGP(Number(r.amount ?? 0))}</span>,
      method: <Badge className={badgeClassForMethod(m)}>{labelMethod(m)}</Badge>,
    }
  })

  const expColumns = [
    { key: 'category', header: 'Category' },
    { key: 'desc', header: 'Description' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
  ]

  const expRows = (topExpenses as any[]).map((r) => {
    const m = normMethod(r.payment_method)
    return {
      id: String(r.id),
      category: <span className="font-medium">{String(r.category_key ?? '—')}</span>,
      desc: <span className="text-sm text-[hsl(var(--muted))]">{String(r.description ?? '—')}</span>,
      amount: <span className="font-semibold">{formatEGP(Number(r.amount ?? 0))}</span>,
      method: <Badge className={badgeClassForMethod(m)}>{labelMethod(m)}</Badge>,
    }
  })

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin · Cash Report</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            {rangeLabel}. Uses <span className="font-medium">Egypt time (Africa/Cairo)</span> for day boundaries.
          </p>
        </div>

        <div className="flex gap-2">
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href="/admin/payments" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Payments
          </Link>
          <Link
            prefetch={false}
            href={`/api/admin/cash-report/export-pdf?${exportQuery.toString()}`}
            className="border px-4 py-2 rounded-lg hover:bg-gray-50"
          >
            Export PDF
          </Link>
        </div>
      </div>

      <Card className="p-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Period</span>
            <select
              name="mode"
              defaultValue={mode}
              className="w-56 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="day">Day</option>
              <option value="week">Week (Mon–Sun)</option>
              <option value="month">Month</option>
              <option value="range">Custom range</option>
            </select>
          </label>

          {mode === 'range' ? (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">From (Egypt)</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={safeFrom}
                  className="w-44 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">To (Egypt)</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={safeTo}
                  className="w-44 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Anchor date (Egypt)</span>
              <input
                type="date"
                name="date"
                defaultValue={anchorDate}
                className="w-56 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          )}

          <button className="rounded-xl bg-black text-white px-4 py-2 text-sm font-medium">Load</button>

          <div className="flex gap-2">
            <Link
              prefetch={false}
              href={`/admin/cash-report?mode=day&date=${today}`}
              className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Today
            </Link>
            <Link
              prefetch={false}
              href={`/admin/cash-report?mode=week&date=${today}`}
              className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              This week
            </Link>
            <Link
              prefetch={false}
              href={`/admin/cash-report?mode=month&date=${today}`}
              className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              This month
            </Link>
          </div>

          <div className="text-xs text-[hsl(var(--muted))]">
            Tip: use Week/Month for quick reporting, or Custom range for accounting.
          </div>
        </form>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Income</div>
          <div className="mt-1 text-2xl font-semibold">{formatEGP(totalIncome)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Expenses</div>
          <div className="mt-1 text-2xl font-semibold">{formatEGP(totalExpenses)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Net</div>
          <div className={`mt-1 text-2xl font-semibold ${net < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatEGP(net)}</div>
        </Card>
      </div>

      {payErr ? <p className="text-sm text-rose-700">❌ Income error: {payErr.message}</p> : null}
      {expErr ? <p className="text-sm text-rose-700">❌ Expenses error: {expErr.message}</p> : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Breakdown</h2>
        <Table columns={breakdownColumns} rows={breakdownRows as any} keyField="id" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Recent income</h2>
          <Table columns={payColumns} rows={payRows as any} keyField="id" />
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Top expenses (by amount)</h2>
          <Table columns={expColumns} rows={expRows as any} keyField="id" />
        </div>
      </div>
    </main>
  )
}
