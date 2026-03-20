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
  addDaysDateOnly,
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
type PersonalKind = 'advance_to_gym' | 'expense_paid_personally' | 'reimbursement_from_gym'

type PersonalEntry = {
  id: string
  entry_date: string
  person_id: string
  kind: PersonalKind
  amount: number
  payment_method: string | null
  note: string | null
  created_at: string
}

function formatEGP(n: number) {
  const v = Number(n ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)
  } catch {
    return `${v.toFixed(2)} EGP`
  }
}

function formatShortDate(isoDateOnly: string) {
  const [y, m, d] = String(isoDateOnly ?? '').split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  if (Number.isNaN(dt.getTime())) return isoDateOnly
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function formatCairoTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
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

function personalKindLabel(kind: PersonalKind) {
  if (kind === 'advance_to_gym') return 'Advance to gym'
  if (kind === 'reimbursement_from_gym') return 'Reimbursement from gym'
  return 'Expense paid personally'
}

function personalTypeBadge(kind: PersonalKind) {
  if (kind === 'advance_to_gym') {
    return <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Advance</span>
  }
  if (kind === 'reimbursement_from_gym') {
    return <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">Reimbursement</span>
  }
  return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">Off-cash personal expense</span>
}

function personalCashEffectBadge(kind: PersonalKind) {
  if (kind === 'advance_to_gym') {
    return <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Cash in</span>
  }
  if (kind === 'reimbursement_from_gym') {
    return <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">Cash out</span>
  }
  return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">Off-cash</span>
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
  const last7From = addDaysDateOnly(today, -6)
  const yesterday = addDaysDateOnly(today, -1)

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

  const rangeFrom =
    mode === 'week' ? weekFrom : mode === 'month' ? monthFrom : mode === 'range' ? rangeFromParam : anchorDate
  const rangeTo = mode === 'week' ? weekTo : mode === 'month' ? monthTo : mode === 'range' ? rangeToParam : anchorDate

  const safeFrom = rangeFrom <= rangeTo ? rangeFrom : rangeTo
  const safeTo = rangeFrom <= rangeTo ? rangeTo : rangeFrom

  const rangeLabel =
    mode === 'day'
      ? `Day: ${formatShortDate(safeFrom)}`
      : mode === 'week'
      ? `Week (Mon–Sun): ${formatShortDate(safeFrom)} → ${formatShortDate(safeTo)}`
      : mode === 'month'
      ? `Month: ${safeFrom.slice(0, 7)}`
      : `Range: ${formatShortDate(safeFrom)} → ${formatShortDate(safeTo)}`

  const admin = createSupabaseAdminClient()
  const { startISO, endISO } = cairoRangeBoundsUTC(safeFrom, safeTo)

  const { data: pays, error: payErr } = await admin
    .from('subscription_payments')
    .select('amount, payment_method')
    .gte('paid_at', startISO)
    .lt('paid_at', endISO)
    .limit(10000)

  const subscriptionIncomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  for (const r of (pays ?? []) as any[]) {
    const amt = Number(r.amount ?? 0)
    if (!Number.isFinite(amt)) continue
    subscriptionIncomeBy[normMethod(r.payment_method)] += amt
  }

  const { data: exps, error: expErr } = await admin
    .from('expenses')
    .select('id, date, category_key, description, amount, payment_method')
    .gte('date', safeFrom)
    .lte('date', safeTo)
    .limit(10000)

  const businessExpenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  for (const r of (exps ?? []) as any[]) {
    const amt = Number(r.amount ?? 0)
    if (!Number.isFinite(amt)) continue
    businessExpenseBy[normMethod(r.payment_method)] += amt
  }

  const { data: rawPersonalEntries, error: pfErr } = await admin
    .from('personal_fund_entries')
    .select('id, entry_date, person_id, kind, amount, payment_method, note, created_at')
    .gte('entry_date', safeFrom)
    .lte('entry_date', safeTo)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10000)

  const personalEntries = ((rawPersonalEntries ?? []) as any[]).filter(
    (row) => row.kind === 'advance_to_gym' || row.kind === 'expense_paid_personally' || row.kind === 'reimbursement_from_gym'
  ) as PersonalEntry[]

  const personIds = [...new Set(personalEntries.map((row) => row.person_id).filter(Boolean))]
  const { data: pfPeople } = personIds.length
    ? await admin.from('personal_fund_people').select('id,label').in('id', personIds)
    : { data: [] as Array<{ id: string; label: string }> }
  const personById = new Map(((pfPeople ?? []) as Array<{ id: string; label: string }>).map((row) => [row.id, row.label]))

  const personalCashInBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  const personalCashOutBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  const personalCashMovements = personalEntries.filter((row) => row.kind !== 'expense_paid_personally')
  const personalOffCashExpenses = personalEntries.filter((row) => row.kind === 'expense_paid_personally')

  for (const row of personalCashMovements) {
    const amt = Number(row.amount ?? 0)
    if (!Number.isFinite(amt)) continue
    const method = normMethod(row.payment_method)
    if (row.kind === 'advance_to_gym') personalCashInBy[method] += amt
    if (row.kind === 'reimbursement_from_gym') personalCashOutBy[method] += amt
  }

  const incomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  const expenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  for (const method of METHODS) {
    incomeBy[method] = subscriptionIncomeBy[method] + personalCashInBy[method]
    expenseBy[method] = businessExpenseBy[method] + personalCashOutBy[method]
  }

  const totalIncome = METHODS.reduce((s, m) => s + incomeBy[m], 0)
  const totalExpenses = METHODS.reduce((s, m) => s + expenseBy[m], 0)
  const net = totalIncome - totalExpenses
  const paymentsCount = (pays ?? []).length
  const expensesCount = (exps ?? []).length
  const personalCashInTotal = METHODS.reduce((s, m) => s + personalCashInBy[m], 0)
  const personalCashOutTotal = METHODS.reduce((s, m) => s + personalCashOutBy[m], 0)
  const personalOffCashTotal = personalOffCashExpenses.reduce((s, row) => s + Number(row.amount ?? 0), 0)

  const { data: recentPays } = await admin
    .from('subscription_payments')
    .select(
      'id, amount, payment_method, note, paid_at, created_at, member_id, member:profiles!subscription_payments_member_id_fkey(first_name,last_name,email,member_id)'
    )
    .gte('paid_at', startISO)
    .lt('paid_at', endISO)
    .order('paid_at', { ascending: false })
    .limit(10)

  const topExpenses = (exps ?? [])
    .slice()
    .sort((a: any, b: any) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
    .slice(0, 10)

  const latestPersonalCash = personalCashMovements.slice(0, 10)
  const latestOffCash = personalOffCashExpenses.slice(0, 10)

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
    income: (
      <div className="space-y-0.5">
        <div className="font-semibold">{formatEGP(incomeBy[m])}</div>
        {personalCashInBy[m] > 0 ? <div className="text-xs text-[hsl(var(--muted))]">includes PF cash in {formatEGP(personalCashInBy[m])}</div> : null}
      </div>
    ),
    expenses: (
      <div className="space-y-0.5">
        <div className="font-semibold">{formatEGP(expenseBy[m])}</div>
        {personalCashOutBy[m] > 0 ? <div className="text-xs text-[hsl(var(--muted))]">includes PF cash out {formatEGP(personalCashOutBy[m])}</div> : null}
      </div>
    ),
    net: (
      <span className={`font-semibold ${incomeBy[m] - expenseBy[m] < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
        {formatEGP(incomeBy[m] - expenseBy[m])}
      </span>
    ),
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
      when: formatCairoTime(r.paid_at || r.created_at),
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
    { key: 'date', header: 'Date' },
    { key: 'category', header: 'Category' },
    { key: 'desc', header: 'Description' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
  ]

  const expRows = (topExpenses as any[]).map((r) => {
    const m = normMethod(r.payment_method)
    return {
      id: String(r.id),
      date: <span className="text-sm text-[hsl(var(--muted))]">{formatShortDate(String(r.date ?? '—'))}</span>,
      category: <span className="font-medium">{String(r.category_key ?? '—')}</span>,
      desc: <span className="text-sm text-[hsl(var(--muted))]">{String(r.description ?? '—')}</span>,
      amount: <span className="font-semibold">{formatEGP(Number(r.amount ?? 0))}</span>,
      method: <Badge className={badgeClassForMethod(m)}>{labelMethod(m)}</Badge>,
    }
  })

  const personalCashColumns = [
    { key: 'date', header: 'Date' },
    { key: 'person', header: 'Person' },
    { key: 'type', header: 'Type' },
    { key: 'effect', header: 'Cash effect' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
    { key: 'note', header: 'Note' },
  ]

  const personalCashRows = latestPersonalCash.map((row) => {
    const m = normMethod(row.payment_method)
    return {
      id: row.id,
      date: <span className="text-sm text-[hsl(var(--muted))]">{formatShortDate(row.entry_date)}</span>,
      person: <span className="font-medium">{personById.get(row.person_id) ?? 'Unknown person'}</span>,
      type: personalTypeBadge(row.kind),
      effect: personalCashEffectBadge(row.kind),
      amount: <span className="font-semibold">{formatEGP(Number(row.amount ?? 0))}</span>,
      method: <Badge className={badgeClassForMethod(m)}>{labelMethod(m)}</Badge>,
      note: <span className="text-sm text-[hsl(var(--muted))]">{row.note || '—'}</span>,
    }
  })

  const personalOffCashColumns = [
    { key: 'date', header: 'Date' },
    { key: 'person', header: 'Person' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Paid with' },
    { key: 'note', header: 'Note' },
  ]

  const personalOffCashRows = latestOffCash.map((row) => {
    const m = normMethod(row.payment_method)
    return {
      id: row.id,
      date: <span className="text-sm text-[hsl(var(--muted))]">{formatShortDate(row.entry_date)}</span>,
      person: <span className="font-medium">{personById.get(row.person_id) ?? 'Unknown person'}</span>,
      amount: <span className="font-semibold">{formatEGP(Number(row.amount ?? 0))}</span>,
      method: <Badge className={badgeClassForMethod(m)}>{labelMethod(m)}</Badge>,
      note: <span className="text-sm text-[hsl(var(--muted))]">{row.note || '—'}</span>,
    }
  })

  const paymentsHref = `/admin/payments?${new URLSearchParams({ preset: 'custom', from: safeFrom, to: safeTo }).toString()}`
  const personalFundsHref = `/admin/personal-funds?${new URLSearchParams({ preset: 'custom', from: safeFrom, to: safeTo }).toString()}`

  const activeChips = [
    rangeLabel,
    'Timezone: Africa/Cairo',
    `Payments: ${paymentsCount}`,
    `Expenses: ${expensesCount}`,
    `PF cash movements: ${personalCashMovements.length}`,
    `PF off-cash: ${personalOffCashExpenses.length}`,
  ]

  const statCards = [
    { label: 'Income', value: formatEGP(totalIncome), tone: 'text-[hsl(var(--fg))]', sub: 'includes subscription income + PF cash in' },
    { label: 'Expenses', value: formatEGP(totalExpenses), tone: 'text-[hsl(var(--fg))]', sub: 'includes business expenses + PF cash out' },
    { label: 'Net cash', value: formatEGP(net), tone: net < 0 ? 'text-rose-700' : 'text-emerald-700', sub: 'selected period' },
    { label: 'Payments', value: String(paymentsCount), tone: 'text-[hsl(var(--fg))]', sub: 'subscription payment lines' },
    { label: 'Expense lines', value: String(expensesCount), tone: 'text-[hsl(var(--fg))]', sub: 'business expense lines' },
    { label: 'PF cash in', value: formatEGP(personalCashInTotal), tone: 'text-sky-700', sub: 'advances to gym' },
    { label: 'PF cash out', value: formatEGP(personalCashOutTotal), tone: 'text-rose-700', sub: 'reimbursements from gym' },
    { label: 'PF off-cash', value: formatEGP(personalOffCashTotal), tone: 'text-slate-700', sub: 'context only, not in net cash' },
  ]

  return (
    <main className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin · Cash Report</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            {rangeLabel}. Uses <span className="font-medium">Egypt time (Africa/Cairo)</span> for day boundaries and now includes
            <span className="font-medium"> cash-affecting Personal Funds movements</span>.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href={paymentsHref} className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Filtered Payments
          </Link>
          <Link prefetch={false} href={personalFundsHref} className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Personal Funds
          </Link>
        </div>
      </div>

      <Card className="p-4 sm:p-5 space-y-4">
        <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,180px)_minmax(0,180px)_auto] xl:grid-cols-[minmax(0,180px)_minmax(0,180px)_minmax(0,180px)_auto_auto] xl:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Period</span>
            <select
              name="mode"
              defaultValue={mode}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">To (Egypt)</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={safeTo}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </>
          ) : (
            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-medium">Anchor date (Egypt)</span>
              <input
                type="date"
                name="date"
                defaultValue={anchorDate}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          )}

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button className="rounded-xl bg-black text-white px-4 py-2 text-sm font-medium">Load report</button>
            <Link
              prefetch={false}
              href="/admin/cash-report"
              className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Reset
            </Link>
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Link prefetch={false} href={`/admin/cash-report?mode=day&date=${today}`} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">Today</Link>
          <Link prefetch={false} href={`/admin/cash-report?mode=day&date=${yesterday}`} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">Yesterday</Link>
          <Link prefetch={false} href={`/admin/cash-report?mode=week&date=${today}`} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">This week</Link>
          <Link prefetch={false} href={`/admin/cash-report?mode=month&date=${today}`} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">This month</Link>
          <Link prefetch={false} href={`/admin/cash-report?mode=range&from=${last7From}&to=${today}`} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">Last 7 days</Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]"
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link prefetch={false} href={`/api/admin/cash-report/export?${exportQuery.toString()}`} className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Export filtered CSV
          </Link>
          <Link prefetch={false} href={`/api/admin/cash-report/export-pdf?${exportQuery.toString()}`} className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Export filtered PDF
          </Link>
          <div className="self-center text-xs text-[hsl(var(--muted))]">
            Exports and shortcuts follow the same selected period and include Personal Funds cash in/out. Off-cash personal expenses stay contextual only.
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label} className="p-4">
            <div className="text-sm text-[hsl(var(--muted))]">{card.label}</div>
            <div className={`mt-1 text-2xl font-semibold ${card.tone}`}>{card.value}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">{card.sub}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4 sm:p-5 space-y-2">
        <div className="text-sm font-medium">Cash logic</div>
        <div className="text-sm text-[hsl(var(--muted))]">Advance to gym is counted as cash in. Reimbursement from gym is counted as cash out. Expense paid personally is shown below for context but does not reduce cash until the reimbursement actually happens.</div>
      </Card>

      {payErr ? <p className="text-sm text-rose-700">❌ Income error: {payErr.message}</p> : null}
      {expErr ? <p className="text-sm text-rose-700">❌ Expenses error: {expErr.message}</p> : null}
      {pfErr ? <p className="text-sm text-amber-700">⚠️ Personal Funds cash movements could not be loaded. Cash totals below currently include Payments and Expenses only.</p> : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">Breakdown</h2>
          <p className="text-xs text-[hsl(var(--muted))]">Net cash = total income − total expenses by payment method.</p>
        </div>
        <Table columns={breakdownColumns} rows={breakdownRows as any} keyField="id" stickyTopClassName="top-0" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Subscription income (latest 10)</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs text-[hsl(var(--muted))]">Sorted by latest paid_at in Cairo range.</p>
              <Link prefetch={false} href={paymentsHref} className="text-xs font-medium underline underline-offset-4">
                Open full filtered payments
              </Link>
            </div>
          </div>
          <Table columns={payColumns} rows={payRows as any} keyField="id" stickyTopClassName="top-0" />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Top business expenses (highest 10)</h2>
            <p className="text-xs text-[hsl(var(--muted))]">Sorted by amount for the selected period.</p>
          </div>
          <Table columns={expColumns} rows={expRows as any} keyField="id" stickyTopClassName="top-0" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Personal Funds cash movements (latest 10)</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs text-[hsl(var(--muted))]">Advances count as cash in. Reimbursements count as cash out.</p>
              <Link prefetch={false} href={personalFundsHref} className="text-xs font-medium underline underline-offset-4">
                Open Personal Funds
              </Link>
            </div>
          </div>
          <Table columns={personalCashColumns} rows={personalCashRows as any} keyField="id" stickyTopClassName="top-0" />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Personal expenses paid personally (latest 10 · off-cash)</h2>
            <p className="text-xs text-[hsl(var(--muted))]">Context only. These do not reduce cash until reimbursement happens.</p>
          </div>
          <Table columns={personalOffCashColumns} rows={personalOffCashRows as any} keyField="id" stickyTopClassName="top-0" />
        </div>
      </div>
    </main>
  )
}
