// src/app/admin/payments/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Badge from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
import EditPaymentDateButton from '@/components/EditPaymentDateButton'
import { addDaysDateOnly, cairoDayBoundsUTC, cairoTodayDateOnly, isISODateOnly } from '@/lib/cairoTime'
import type { Role } from '@/lib/session'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

const ALLOWED: Role[] = ['admin', 'super_admin']
const PAGE_SIZE = 50
const IMPOSSIBLE_MEMBER_ID = '00000000-0000-0000-0000-000000000000'

type RangePreset = 'today' | '7d' | 'month' | 'custom'

type ProfileLite = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

type PaymentRow = {
  id: string
  subscription_id: string
  member_id: string
  amount: number
  payment_method: string
  note: string | null
  paid_at: string
  created_at: string
  member: ProfileLite | null
  actor: { user_id: string; email: string | null; first_name: string | null; last_name: string | null } | null
}

function formatEGP(n: number) {
  const v = Number(n ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)
  } catch {
    return `${v.toFixed(2)} EGP`
  }
}

function labelMethod(m: string) {
  const s = String(m || 'cash')
  if (s === 'cash') return 'Cash'
  if (s === 'instapay') return 'Instapay'
  if (s === 'card' || s === 'visa') return 'Card'
  if (s === 'bank_transfer') return 'Bank transfer'
  return s
}

function badgeClassForMethod(m: string) {
  const s = String(m || 'cash')
  if (s === 'cash') return 'bg-emerald-50 text-emerald-700'
  if (s === 'instapay') return 'bg-sky-50 text-sky-700'
  if (s === 'card' || s === 'visa') return 'bg-violet-50 text-violet-700'
  if (s === 'bank_transfer') return 'bg-amber-50 text-amber-800'
  return ''
}

function safeQ(v: unknown) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, 80)
}

function sp1(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = sp[key]
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
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

function parsePreset(v?: string | null): RangePreset {
  return v === 'today' || v === '7d' || v === 'month' || v === 'custom' ? v : 'today'
}

function startOfMonthDateOnly(isoDate: string) {
  return `${isoDate.slice(0, 7)}-01`
}

function endOfMonthDateOnly(isoDate: string) {
  const [year, month] = isoDate.split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(year, month, 0))
  return dt.toISOString().slice(0, 10)
}

function buildQS(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const value = String(v ?? '')
    if (value.length) sp.set(k, value)
  }
  return sp.toString()
}

function applyPaymentMethodFilter<T extends { eq: Function; in: Function }>(query: T, method: string) {
  if (!method || method === 'all') return query
  if (method === 'card') return query.in('payment_method', ['card', 'visa'])
  return query.eq('payment_method', method)
}

function presetLabel(preset: RangePreset) {
  if (preset === '7d') return 'Last 7 days'
  if (preset === 'month') return 'This month'
  if (preset === 'custom') return 'Custom'
  return 'Today'
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/payments')

  if (!ALLOWED.includes(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Payments</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access this page."
            nextPath="/admin/payments"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const todayCairo = cairoTodayDateOnly()
  const monthFrom = startOfMonthDateOnly(todayCairo)
  const monthTo = endOfMonthDateOnly(todayCairo)

  const presetRaw = sp1(searchParams, 'preset')
  const fromRaw = sp1(searchParams, 'from')
  const toRaw = sp1(searchParams, 'to')

  const preset: RangePreset =
    presetRaw ? parsePreset(presetRaw) : isISODateOnly(fromRaw) || isISODateOnly(toRaw) ? 'custom' : 'today'

  let from = todayCairo
  let to = todayCairo

  if (preset === '7d') {
    from = addDaysDateOnly(todayCairo, -6)
    to = todayCairo
  } else if (preset === 'month') {
    from = monthFrom
    to = monthTo
  } else if (preset === 'custom') {
    from = isISODateOnly(fromRaw) ? fromRaw! : todayCairo
    to = isISODateOnly(toRaw) ? toRaw! : from
  }

  const payment_method = sp1(searchParams, 'payment_method') ?? 'all'
  const q = safeQ(sp1(searchParams, 'q'))

  const page = Math.max(1, Number(sp1(searchParams, 'page') ?? '1') || 1)
  const fromIdx = (page - 1) * PAGE_SIZE
  const toIdx = fromIdx + PAGE_SIZE - 1

  const admin = getSupabaseAdminClientCached()

  const startISO = cairoDayBoundsUTC(from).startISO
  const endISO = cairoDayBoundsUTC(addDaysDateOnly(to, 1)).startISO

  let memberIds: string[] | null = null
  if (q) {
    const like = `%${q.replace(/%/g, '')}%`
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id')
      .or(
        `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},member_id.ilike.${like}`
      )
      .limit(200)

    memberIds = (profs ?? []).map((p: any) => p.user_id).filter(Boolean)
    if (!memberIds.length) memberIds = []
  }

  let query = admin
    .from('subscription_payments')
    .select(
      'id, subscription_id, member_id, amount, payment_method, note, paid_at, created_at, member:profiles!subscription_payments_member_id_fkey(user_id,member_id,email,first_name,last_name,phone), actor:profiles!subscription_payments_created_by_fkey(user_id,email,first_name,last_name)',
      { count: 'exact' }
    )
    .gte('paid_at', startISO)
    .lt('paid_at', endISO)
    .order('paid_at', { ascending: false })

  query = applyPaymentMethodFilter(query as any, payment_method) as any
  if (memberIds) {
    if (!memberIds.length) query = query.in('member_id', [IMPOSSIBLE_MEMBER_ID])
    else query = query.in('member_id', memberIds)
  }

  const { data: rowsRaw, error: err, count } = await query.range(fromIdx, toIdx)

  const rows: PaymentRow[] = ((rowsRaw ?? []) as any[]).map((r) => ({
    id: String(r.id),
    subscription_id: String(r.subscription_id),
    member_id: String(r.member_id),
    amount: Number(r.amount ?? 0),
    payment_method: String(r.payment_method ?? 'cash'),
    note: r.note ?? null,
    paid_at: String(r.paid_at ?? r.created_at),
    created_at: String(r.created_at),
    member: (r.member ?? null) as any,
    actor: (r.actor ?? null) as any,
  }))

  let totals = { all: 0, cash: 0, instapay: 0, card: 0, bank_transfer: 0 }

  try {
    let totalsQuery = admin
      .from('subscription_payments')
      .select('amount, payment_method, member_id')
      .gte('paid_at', startISO)
      .lt('paid_at', endISO)
      .limit(10000)

    totalsQuery = applyPaymentMethodFilter(totalsQuery as any, payment_method) as any
    if (memberIds) {
      if (!memberIds.length) totalsQuery = totalsQuery.in('member_id', [IMPOSSIBLE_MEMBER_ID])
      else totalsQuery = totalsQuery.in('member_id', memberIds)
    }

    const { data: allRows } = await totalsQuery
    for (const r of (allRows ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      totals.all += amt
      const pm = String(r.payment_method ?? 'cash')
      if (pm === 'cash') totals.cash += amt
      else if (pm === 'instapay') totals.instapay += amt
      else if (pm === 'card' || pm === 'visa') totals.card += amt
      else if (pm === 'bank_transfer') totals.bank_transfer += amt
    }
  } catch {
    // ignore totals failure
  }

  const totalPages = Math.max(1, Math.ceil(Number(count ?? 0) / PAGE_SIZE))
  const pageTotal = rows.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0)

  const qsBase = {
    preset,
    from,
    to,
    payment_method,
    q,
  }

  const navLink = (p: number) => `/admin/payments?${buildQS({ ...qsBase, page: String(p) })}`

  const quickLinks = {
    today: `/admin/payments?${buildQS({ preset: 'today', from: todayCairo, to: todayCairo, payment_method, q })}`,
    seven: `/admin/payments?${buildQS({ preset: '7d', from: addDaysDateOnly(todayCairo, -6), to: todayCairo, payment_method, q })}`,
    month: `/admin/payments?${buildQS({ preset: 'month', from: monthFrom, to: monthTo, payment_method, q })}`,
    custom: `/admin/payments?${buildQS({ preset: 'custom', from, to, payment_method, q })}`,
    reset: '/admin/payments',
  }

  const exportQS = buildQS({ from, to, payment_method, q })
  const cashReportHref = `/admin/cash-report?${buildQS({ mode: from === to ? 'day' : 'range', date: from, from, to })}`

  const activeFilters = [
    `Range: ${from} → ${to}`,
    preset !== 'custom' ? `Preset: ${presetLabel(preset)}` : '',
    payment_method !== 'all' ? `Method: ${labelMethod(payment_method)}` : '',
    q ? `Search: ${q}` : '',
  ].filter(Boolean)

  const tableColumns = [
    { key: 'paid_when', header: 'Paid at (EG)' },
    { key: 'recorded_when', header: 'Recorded at', hideOnMobile: true },
    { key: 'member', header: 'Member' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
    { key: 'note', header: 'Note', hideOnMobile: true },
    { key: 'by', header: 'By', hideOnMobile: true },
    { key: 'edit_date', header: '', tdClassName: 'whitespace-normal' },
    { key: 'open', header: '' },
  ]

  const tableRows = rows.map((r) => {
    const name = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || r.member?.email || '—'
    const by = `${r.actor?.first_name ?? ''} ${r.actor?.last_name ?? ''}`.trim() || r.actor?.email || '—'
    const memberLabel = `${name}${r.member?.member_id ? ` · ${r.member.member_id}` : ''}`
    return {
      id: r.id,
      paid_when: <span className="font-medium">{formatCairoDateTime(r.paid_at)}</span>,
      recorded_when: <span className="text-sm text-[hsl(var(--muted))]">{formatCairoDateTime(r.created_at)}</span>,
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">{name}</div>
          {r.member?.member_id ? (
            <div className="text-xs text-[hsl(var(--muted))]">{r.member.member_id}</div>
          ) : r.member?.email ? (
            <div className="text-xs text-[hsl(var(--muted))]">{r.member.email}</div>
          ) : null}
        </div>
      ),
      amount: <span className="font-semibold">{formatEGP(r.amount)}</span>,
      method: <Badge className={badgeClassForMethod(r.payment_method)}>{labelMethod(r.payment_method)}</Badge>,
      note: <span className="text-sm text-[hsl(var(--muted))]">{r.note ?? '—'}</span>,
      by: <span className="text-sm">{by}</span>,
      edit_date: (
        <EditPaymentDateButton
          paymentId={r.id}
          memberLabel={memberLabel}
          currentPaidAt={r.paid_at || r.created_at}
        />
      ),
      open: (
        <Link
          className="inline-flex items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          href={`/members/${r.member_id}`}
          prefetch={false}
        >
          Open
        </Link>
      ),
    }
  })

  return (
    <main className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Admin · Payments</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            Egypt-time accounting view for real payment dates, with quick filters, export shortcuts, and clearer mobile scanning of results.
          </p>
          <p className="text-sm text-[hsl(var(--muted))]">
            Signed in as <span className="font-medium">{me.email || 'unknown'}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href={cashReportHref} className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Filtered Cash Report
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick filters</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Egypt time (Africa/Cairo)</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Link prefetch={false} href={quickLinks.today} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              Today
            </Link>
            <Link prefetch={false} href={quickLinks.seven} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              Last 7 days
            </Link>
            <Link prefetch={false} href={quickLinks.month} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              This month
            </Link>
            <Link prefetch={false} href={quickLinks.custom} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              Custom
            </Link>
            <Link prefetch={false} href={quickLinks.reset} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              Reset all
            </Link>
          </div>

          <form method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Preset</span>
              <select
                name="preset"
                defaultValue={preset}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="month">This month</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">From</span>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">To</span>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Method</span>
              <select
                name="payment_method"
                defaultValue={payment_method}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="instapay">Instapay</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>

            <label className="block sm:col-span-2 xl:col-span-2">
              <span className="mb-1 block text-sm font-medium">Search member</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="name / email / phone / ATOM-000123"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <div className="sm:col-span-2 xl:col-span-6 flex flex-wrap items-center gap-2 pt-1">
              <button className="inline-flex items-center justify-center rounded-2xl bg-black text-white px-4 py-2 text-sm font-medium hover:opacity-95">
                Apply filters
              </button>
              <a href={`/api/admin/payments/export?${exportQS}`} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Export filtered CSV
              </a>
              <a href={`/api/admin/payments/export-pdf?${exportQS}`} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Export filtered PDF
              </a>
              <Link
                prefetch={false}
                href="/admin/payments"
                className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80"
              >
                Reset
              </Link>
            </div>
          </form>

          {activeFilters.length ? (
            <div className="flex flex-wrap gap-2">
              {activeFilters.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-1">
          <div className="text-sm text-[hsl(var(--muted))]">
            <strong>Payment date</strong> is the real accounting date. <strong>Recorded at</strong> is when the payment was entered in ATOM App.
            Use <strong>Edit date</strong> for historical imports already entered with today&apos;s date.
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">
            Filtered CSV/PDF exports and the Cash Report shortcut always follow the current filtered result, not only the visible page.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Filtered total</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(totals.all)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Results</div>
            <div className="mt-1 text-xl font-semibold">{count ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Cash</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(totals.cash)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Instapay</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(totals.instapay)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Card</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(totals.card)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Bank transfer</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(totals.bank_transfer)}</div>
          </CardContent>
        </Card>
      </div>

      {err ? <p className="text-sm text-rose-700">❌ Failed to load payments: {err.message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">
            {count ?? 0} result{Number(count ?? 0) === 1 ? '' : 's'} · Current page total {formatEGP(pageTotal)}
          </div>
        </CardHeader>
        <CardContent>
          {!rows.length ? (
            <div className="mb-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
              No payments found for the current filters. Try another date range, change the payment method, or reset all filters.
            </div>
          ) : null}

          <Table columns={tableColumns} rows={tableRows as any} keyField="id" stickyTopClassName="top-0" />

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-[hsl(var(--muted))]">
                Page {page} / {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  prefetch={false}
                  href={navLink(Math.max(1, page - 1))}
                  aria-disabled={page <= 1}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold ${page <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-black/[0.03]'}`}
                >
                  Prev
                </Link>
                <Link
                  prefetch={false}
                  href={navLink(Math.min(totalPages, page + 1))}
                  aria-disabled={page >= totalPages}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold ${page >= totalPages ? 'pointer-events-none opacity-50' : 'hover:bg-black/[0.03]'}`}
                >
                  Next
                </Link>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
