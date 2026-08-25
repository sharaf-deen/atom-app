export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreAdmin } from '@/lib/rbac'
import AdminPreorderQuickEdit from '@/components/store/AdminPreorderQuickEdit'
import AdminPreorderCollectPayment from '@/components/store/AdminPreorderCollectPayment'
import AdminPreorderForm from '@/components/store/AdminPreorderForm'
import CompletePreorderAsSaleButton from '@/components/store/CompletePreorderAsSaleButton'
import StoreAdminNav from '@/components/store/StoreAdminNav'

type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'
type PreorderStatusFilter = 'all' | PreorderStatus
type MoneyFilter = 'all' | 'balance_due' | 'fully_paid' | 'no_deposit' | 'ready_to_complete'
type PeriodFilter = 'all' | 'this_month'
type SortDir = 'asc' | 'desc'
type PreorderSortKey = 'updated_at' | 'product_name' | 'buyer' | 'status' | 'qty' | 'total_cents' | 'deposit_cents' | 'balance_due_cents'


type ProductOption = {
  id: string
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
  allow_preorder: boolean
}

type PreorderRow = {
  id: string
  buyer_user_id: string
  buyer_full_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  product_id: string | null
  product_name: string
  product_category: string | null
  product_color: string | null
  product_size: string | null
  qty: number
  unit_price_cents: number
  total_cents: number
  deposit_cents: number
  balance_due_cents: number
  deposit_payment_method: 'cash' | 'instapay' | 'bank_transfer' | 'card' | null
  status: PreorderStatus
  note: string | null
  converted_sale_id: string | null
  created_at: string
  updated_at: string
}

type Metrics = {
  total: number
  pending: number
  confirmed: number
  ready: number
  completed: number
  canceled: number
  demandValueCents: number
  depositsCents: number
  balanceCents: number
  balanceDue: number
  fullyPaidDeposit: number
  noDeposit: number
  readyToComplete: number
  thisMonth: number
}

const PREORDER_STATUS_FILTERS: Array<{ value: PreorderStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'ordered_from_supplier', label: 'Ordered from supplier' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

const PREORDER_MONEY_FILTERS: Array<{ value: MoneyFilter; label: string }> = [
  { value: 'all', label: 'All balances' },
  { value: 'balance_due', label: 'Balance due' },
  { value: 'fully_paid', label: 'Fully paid deposit' },
  { value: 'no_deposit', label: 'No deposit' },
  { value: 'ready_to_complete', label: 'Ready to complete' },
]

const PREORDER_PERIOD_FILTERS: Array<{ value: PeriodFilter; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'this_month', label: 'This month' },
]

const PREORDER_STATUS_ORDER: Record<PreorderStatus, number> = {
  pending: 0,
  confirmed: 1,
  ordered_from_supplier: 2,
  ready: 3,
  completed: 4,
  canceled: 5,
}

function normalizeSort(v: string): PreorderSortKey {
  return v === 'product_name' || v === 'buyer' || v === 'status' || v === 'qty' || v === 'total_cents' || v === 'deposit_cents' || v === 'balance_due_cents' ? v : 'updated_at'
}

function normalizeDir(v: string): SortDir {
  return v === 'asc' ? 'asc' : 'desc'
}

function compareText(a: string | null | undefined, b: string | null | undefined) {
  return String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' })
}

function compareNumber(a: number | null | undefined, b: number | null | undefined) {
  return Number(a || 0) - Number(b || 0)
}

function compareDate(a: string | null | undefined, b: string | null | undefined) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime()
}

function sortPreorders(rows: PreorderRow[], sort: PreorderSortKey, dir: SortDir) {
  const factor = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let result = 0
    switch (sort) {
      case 'product_name':
        result = compareText(a.product_name, b.product_name)
        break
      case 'buyer':
        result = compareText(a.buyer_full_name || a.buyer_email || a.buyer_phone, b.buyer_full_name || b.buyer_email || b.buyer_phone)
        break
      case 'status':
        result = compareNumber(PREORDER_STATUS_ORDER[a.status], PREORDER_STATUS_ORDER[b.status])
        break
      case 'qty':
        result = compareNumber(a.qty, b.qty)
        break
      case 'total_cents':
        result = compareNumber(a.total_cents, b.total_cents)
        break
      case 'deposit_cents':
        result = compareNumber(a.deposit_cents, b.deposit_cents)
        break
      case 'balance_due_cents':
        result = compareNumber(a.balance_due_cents, b.balance_due_cents)
        break
      case 'updated_at':
      default:
        result = compareDate(a.updated_at, b.updated_at)
        break
    }
    if (result === 0) {
      result = compareDate(a.updated_at, b.updated_at)
      if (result === 0) result = compareText(a.id, b.id)
    }
    return result * factor
  })
}

function renderSortLink(basePath: string, params: Record<string, string>, column: PreorderSortKey, currentSort: PreorderSortKey, currentDir: SortDir, label: string, defaultDir: SortDir = 'asc', align: 'left' | 'right' = 'left') {
  const isActive = currentSort === column
  const nextDir: SortDir = isActive ? (currentDir === 'asc' ? 'desc' : 'asc') : defaultDir
  return (
    <Link
      prefetch={false}
      href={buildUrl(basePath, { ...params, sort: column, dir: nextDir, page: '1' })}
      className={`inline-flex w-full items-center gap-1 hover:text-black ${align === 'right' ? 'justify-end' : ''}`}
    >
      <span>{label}</span>
      <span className="text-[10px]">{isActive ? (currentDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </Link>
  )
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function normalizeStatus(v: string): PreorderStatusFilter {
  return v === 'pending' || v === 'confirmed' || v === 'ordered_from_supplier' || v === 'ready' || v === 'completed' || v === 'canceled' ? v : 'all'
}

function normalizeMoney(v: string): MoneyFilter {
  return v === 'balance_due' || v === 'fully_paid' || v === 'no_deposit' || v === 'ready_to_complete' ? v : 'all'
}

function normalizePeriod(v: string): PeriodFilter {
  return v === 'this_month' ? v : 'all'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function paymentLabel(value: PreorderRow['deposit_payment_method']) {
  switch (value) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank transfer'
    case 'card':
      return 'Card'
    default:
      return '—'
  }
}

function preorderBuyerLabel(row: PreorderRow) {
  return row.buyer_full_name || row.buyer_email || row.buyer_phone || 'Member'
}

function preorderProductLabel(row: PreorderRow) {
  const details = [row.product_name, row.product_color || null, row.product_size || null].filter(Boolean)
  return details.join(' · ') || 'Product'
}

function preorderStatusPill(status: PreorderStatus) {
  switch (status) {
    case 'pending':
      return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">Pending</span>
    case 'confirmed':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Confirmed</span>
    case 'ordered_from_supplier':
      return <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">Ordered from supplier</span>
    case 'ready':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Ready</span>
    case 'completed':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Completed</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">Canceled</span>
  }
}

function preorderBalanceDue(row: PreorderRow) {
  return Math.max(0, Number(row.balance_due_cents || 0)) > 0
}

function preorderFullyPaidDeposit(row: PreorderRow) {
  return Number(row.total_cents || 0) > 0 && Number(row.deposit_cents || 0) >= Number(row.total_cents || 0)
}

function preorderNoDeposit(row: PreorderRow) {
  return Number(row.deposit_cents || 0) <= 0
}

function preorderReadyToComplete(row: PreorderRow) {
  return row.status === 'ready' && !row.converted_sale_id
}

function preorderCreatedThisMonth(row: PreorderRow) {
  const d = new Date(row.created_at || row.updated_at || 0)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function filterPreorders(rows: PreorderRow[], money: MoneyFilter, period: PeriodFilter) {
  return rows.filter((row) => {
    if (period === 'this_month' && !preorderCreatedThisMonth(row)) return false
    if (money === 'balance_due' && !preorderBalanceDue(row)) return false
    if (money === 'fully_paid' && !preorderFullyPaidDeposit(row)) return false
    if (money === 'no_deposit' && !preorderNoDeposit(row)) return false
    if (money === 'ready_to_complete' && !preorderReadyToComplete(row)) return false
    return true
  })
}

function preorderFinancialBadges(row: PreorderRow): ReactNode[] {
  const badges: ReactNode[] = []
  if (preorderBalanceDue(row)) {
    badges.push(<span key="balance" className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Balance due</span>)
  }
  if (preorderNoDeposit(row)) {
    badges.push(<span key="no-deposit" className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">No deposit</span>)
  }
  if (preorderReadyToComplete(row)) {
    badges.push(<span key="ready" className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Ready to complete</span>)
  }
  if (preorderFullyPaidDeposit(row)) {
    badges.push(<span key="paid" className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">Deposit paid</span>)
  }
  return badges
}

function quickFilterClass(active: boolean) {
  return `inline-flex min-h-[36px] items-center rounded-full border px-3 py-1.5 text-xs font-medium ${active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--fg))] hover:bg-gray-50'}`
}

function computeMetrics(rows: PreorderRow[]): Metrics {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1
      if (row.status === 'pending') acc.pending += 1
      if (row.status === 'confirmed' || row.status === 'ordered_from_supplier') acc.confirmed += 1
      if (row.status === 'ready') acc.ready += 1
      if (row.status === 'completed') acc.completed += 1
      if (row.status === 'canceled') acc.canceled += 1
      acc.demandValueCents += Math.max(0, Number(row.total_cents ?? 0))
      acc.depositsCents += Math.max(0, Number(row.deposit_cents ?? 0))
      acc.balanceCents += Math.max(0, Number(row.balance_due_cents ?? 0))
      if (preorderBalanceDue(row)) acc.balanceDue += 1
      if (preorderFullyPaidDeposit(row)) acc.fullyPaidDeposit += 1
      if (preorderNoDeposit(row)) acc.noDeposit += 1
      if (preorderReadyToComplete(row)) acc.readyToComplete += 1
      if (preorderCreatedThisMonth(row)) acc.thisMonth += 1
      return acc
    },
    {
      total: 0,
      pending: 0,
      confirmed: 0,
      ready: 0,
      completed: 0,
      canceled: 0,
      demandValueCents: 0,
      depositsCents: 0,
      balanceCents: 0,
      balanceDue: 0,
      fullyPaidDeposit: 0,
      noDeposit: 0,
      readyToComplete: 0,
      thisMonth: 0,
    } as Metrics
  )
}

export default async function AdminStorePreordersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/preorders')

  if (!canAccessStoreAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store/preorders"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 12, 6, 40)
  const q = strParam(searchParams?.q).trim()
  const status = normalizeStatus(strParam(searchParams?.status))
  const money = normalizeMoney(strParam(searchParams?.money))
  const period = normalizePeriod(strParam(searchParams?.period))
  const sort = normalizeSort(strParam(searchParams?.sort))
  const dir = normalizeDir(strParam(searchParams?.dir))

  const supa = getSupabaseAdminClientCached()
  let productOptions: ProductOption[] = []
  let rows: PreorderRow[] = []
  let errorMsg: string | null = null

  try {
    const { data: productsData, error: productsError } = await supa
      .from('store_products')
      .select('id,name,color,size,price_cents,currency,inventory_qty,is_active,allow_preorder')
      .eq('is_active', true)
      .eq('allow_preorder', true)
      .order('created_at', { ascending: false })
      .limit(200)

    if (productsError) throw new Error(productsError.message)
    productOptions = (Array.isArray(productsData) ? productsData : []) as ProductOption[]

    let query = supa
      .from('store_preorders')
      .select('id, buyer_user_id, buyer_full_name, buyer_email, buyer_phone, product_id, product_name, product_category, product_color, product_size, qty, unit_price_cents, total_cents, deposit_cents, balance_due_cents, deposit_payment_method, status, note, converted_sale_id, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (status !== 'all') query = query.eq('status', status)
    if (q) {
      const safe = q.replace(/,/g, ' ').trim()
      query = query.or(`buyer_full_name.ilike.%${safe}%,buyer_email.ilike.%${safe}%,buyer_phone.ilike.%${safe}%,product_name.ilike.%${safe}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    rows = (Array.isArray(data) ? data : []) as PreorderRow[]
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const filteredRows = filterPreorders(rows, money, period)
  const metrics = computeMetrics(filteredRows)
  const sortedRows = sortPreorders(filteredRows, sort, dir)
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const items = sortedRows.slice(start, start + pageSize)
  const hasMore = safePage < totalPages

  const baseParams = {
    q,
    status: status === 'all' ? '' : status,
    money: money === 'all' ? '' : money,
    period: period === 'all' ? '' : period,
    page_size: String(pageSize),
    sort,
    dir,
  }

  return (
    <main>
      <PageHeader
        title="Store Admin — Preorders"
        subtitle="Preorder tracking with clearer deposit, balance, and completion visibility."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              prefetch={false}
              href="/admin/store"
              className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Back to /admin/store
            </Link>
            <Link
              prefetch={false}
              href="/store"
              className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open /store
            </Link>
          </div>
        }
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/preorders" role={me.role} />
      </Section>

      <Section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <Card>
            <CardHeader><CardTitle>Preorders tracked</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Filtered preorders</span><span className="font-semibold">{metrics.total}</span></div>
              <div className="flex items-center justify-between"><span>This month</span><span className="font-semibold">{metrics.thisMonth}</span></div>
              <div className="flex items-center justify-between"><span>Pending</span><span className="font-semibold">{metrics.pending}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Preorder value</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Total preorder value</span><span className="font-semibold">{formatCurrency(metrics.demandValueCents)}</span></div>
              <div className="flex items-center justify-between"><span>Deposit collected</span><span className="font-semibold">{formatCurrency(metrics.depositsCents)}</span></div>
              <div className="flex items-center justify-between"><span>Remaining balance</span><span className="font-semibold">{formatCurrency(metrics.balanceCents)}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Balance visibility</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Balance due</span><span className="font-semibold">{metrics.balanceDue}</span></div>
              <div className="flex items-center justify-between"><span>No deposit</span><span className="font-semibold">{metrics.noDeposit}</span></div>
              <div className="flex items-center justify-between"><span>Fully paid deposit</span><span className="font-semibold">{metrics.fullyPaidDeposit}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Fulfillment</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Ready to complete</span><span className="font-semibold">{metrics.readyToComplete}</span></div>
              <div className="flex items-center justify-between"><span>Completed</span><span className="font-semibold">{metrics.completed}</span></div>
              <div className="flex items-center justify-between"><span>Canceled</span><span className="font-semibold">{metrics.canceled}</span></div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create preorder</CardTitle>
            <div className="text-xs text-[hsl(var(--muted))]">Super admin only. This creates a reservation for an existing member and does not reduce stock.</div>
          </CardHeader>
          <CardContent>
            <AdminPreorderForm products={productOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Link href={buildUrl('/admin/store/preorders', { q, page_size: String(pageSize), sort, dir, page: '1' })} className={quickFilterClass(status === 'all' && money === 'all' && period === 'all')}>All preorders</Link>
              <Link href={buildUrl('/admin/store/preorders', { q, money: 'balance_due', page_size: String(pageSize), sort, dir, page: '1' })} className={quickFilterClass(money === 'balance_due')}>Balance due</Link>
              <Link href={buildUrl('/admin/store/preorders', { q, money: 'fully_paid', page_size: String(pageSize), sort, dir, page: '1' })} className={quickFilterClass(money === 'fully_paid')}>Fully paid deposit</Link>
              <Link href={buildUrl('/admin/store/preorders', { q, money: 'no_deposit', page_size: String(pageSize), sort, dir, page: '1' })} className={quickFilterClass(money === 'no_deposit')}>No deposit</Link>
              <Link href={buildUrl('/admin/store/preorders', { q, money: 'ready_to_complete', page_size: String(pageSize), sort, dir, page: '1' })} className={quickFilterClass(money === 'ready_to_complete')}>Ready to complete</Link>
              <Link href={buildUrl('/admin/store/preorders', { q, period: 'this_month', page_size: String(pageSize), sort, dir, page: '1' })} className={quickFilterClass(period === 'this_month')}>This month</Link>
            </div>

            <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_200px_160px_auto]">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Search</span>
                <input name="q" defaultValue={q} placeholder="Buyer, email, phone, product…" className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Status</span>
                <select name="status" defaultValue={status} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {PREORDER_STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Balance</span>
                <select name="money" defaultValue={money} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {PREORDER_MONEY_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Period</span>
                <select name="period" defaultValue={period} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {PREORDER_PERIOD_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="dir" value={dir} />
              <input type="hidden" name="page_size" value={String(pageSize)} />
              <div className="flex items-end gap-2">
                <button className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button>
                <Link href="/admin/store/preorders" className="inline-flex min-h-[42px] items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">Reset</Link>
              </div>
            </form>
          </CardContent>
        </Card>

        {errorMsg ? (
          <Card>
            <CardContent className="text-sm text-red-700">Preorders query failed: {errorMsg}</CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Admin preorders</CardTitle>
              <div className="text-xs text-[hsl(var(--muted))]">{filteredRows.length} preorder(s) · balance-focused row view · click desktop headers to sort</div>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No preorders match the current filters.</div>
              ) : (
                <>
                  <div className="hidden lg:grid sticky top-16 z-20 grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_130px_70px_115px_115px_120px_130px_86px] gap-3 rounded-2xl border bg-[hsl(var(--card))]/95 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted))] shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/90">
                    {renderSortLink('/admin/store/preorders', baseParams, 'product_name', sort, dir, 'Product')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'buyer', sort, dir, 'Buyer')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'status', sort, dir, 'Status')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'qty', sort, dir, 'Qty')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'total_cents', sort, dir, 'Total', 'desc')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'deposit_cents', sort, dir, 'Deposit', 'desc')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'balance_due_cents', sort, dir, 'Balance', 'desc')}
                    {renderSortLink('/admin/store/preorders', baseParams, 'updated_at', sort, dir, 'Updated', 'desc')}
                    <div className="text-right">Open</div>
                  </div>

                  <div className="overflow-x-auto">
                    <div className="min-w-[1120px] space-y-3">
                      {items.map((row) => (
                      <details key={row.id} className={`group overflow-hidden rounded-2xl border bg-white shadow-sm ${preorderBalanceDue(row) ? 'border-amber-200 ring-1 ring-amber-100' : ''}`}>
                        <summary className="list-none cursor-pointer">
                          <div className="lg:hidden p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{row.product_name}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                  <span className="rounded-full border px-2 py-1">ID: {shortId(row.id)}</span>
                                  {row.product_category ? <span className="rounded-full border px-2 py-1">{row.product_category}</span> : null}
                                  <span className="rounded-full border px-2 py-1">Qty: {row.qty}</span>
                                  {preorderFinancialBadges(row)}
                                </div>
                              </div>
                              {preorderStatusPill(row.status)}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                              <div><span className="text-[hsl(var(--muted))]">Buyer:</span> <span className="font-medium">{row.buyer_full_name || row.buyer_email || 'Member'}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Total:</span> <span className="font-medium">{formatCurrency(row.total_cents)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Deposit:</span> <span className="font-medium">{formatCurrency(row.deposit_cents)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Balance:</span> <span className={`font-medium ${preorderBalanceDue(row) ? 'text-amber-800' : ''}`}>{formatCurrency(row.balance_due_cents)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Updated:</span> <span className="font-medium">{formatDateTime(row.updated_at)}</span></div>
                            </div>
                            <div className="mt-3 text-right text-xs font-medium text-[hsl(var(--muted))] group-open:hidden">Tap to open</div>
                            <div className="mt-3 hidden text-right text-xs font-medium text-[hsl(var(--muted))] group-open:block">Tap to close</div>
                          </div>

                          <div className="hidden lg:grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_130px_70px_115px_115px_120px_130px_86px] items-center gap-3 px-4 py-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{row.product_name}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[hsl(var(--muted))]">
                                <span className="rounded-full border px-2 py-0.5">ID: {shortId(row.id)}</span>
                                {row.product_category ? <span className="rounded-full border px-2 py-0.5">{row.product_category}</span> : null}
                                {row.product_size ? <span className="rounded-full border px-2 py-0.5">Size: {row.product_size}</span> : null}
                                {row.product_color ? <span className="rounded-full border px-2 py-0.5">Color: {row.product_color}</span> : null}
                                {preorderFinancialBadges(row)}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{row.buyer_full_name || row.buyer_email || 'Member'}</div>
                              <div className="truncate text-[11px] text-[hsl(var(--muted))]">{row.buyer_email || row.buyer_phone || 'No contact details'}</div>
                            </div>
                            <div>{preorderStatusPill(row.status)}</div>
                            <div className="text-sm font-medium">{row.qty}</div>
                            <div className="text-sm font-medium">{formatCurrency(row.total_cents)}</div>
                            <div className="text-sm font-medium">{formatCurrency(row.deposit_cents)}</div>
                            <div className={`text-sm font-medium ${preorderBalanceDue(row) ? 'text-amber-800' : 'text-[hsl(var(--muted))]'}`}>{formatCurrency(row.balance_due_cents)}</div>
                            <div className="text-sm text-[hsl(var(--muted))]">{formatDateTime(row.updated_at)}</div>
                            <div className="text-right text-xs font-medium text-[hsl(var(--muted))] group-open:hidden">Details</div>
                            <div className="hidden text-right text-xs font-medium text-[hsl(var(--muted))] group-open:block">Close</div>
                          </div>
                        </summary>

                        <div className="border-t bg-[hsl(var(--bg))]/40 p-4">
                          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                            <div className="space-y-4">
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                <div className="rounded-2xl border bg-white p-3 text-sm">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Buyer</div>
                                  <div className="mt-1 font-medium">{row.buyer_full_name || row.buyer_email || 'Member'}</div>
                                  <div className="mt-1 text-[hsl(var(--muted))]">{row.buyer_email || '—'}</div>
                                  <div className="text-[hsl(var(--muted))]">{row.buyer_phone || '—'}</div>
                                </div>
                                <div className={`rounded-2xl border bg-white p-3 text-sm ${preorderBalanceDue(row) ? 'border-amber-200' : ''}`}>
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Money</div>
                                  <div className="mt-1">Unit: <span className="font-medium">{formatCurrency(row.unit_price_cents)}</span></div>
                                  <div>Total: <span className="font-medium">{formatCurrency(row.total_cents)}</span></div>
                                  <div>Deposit: <span className="font-medium">{formatCurrency(row.deposit_cents)}</span></div>
                                  <div>Balance: <span className={`font-medium ${preorderBalanceDue(row) ? 'text-amber-800' : ''}`}>{formatCurrency(row.balance_due_cents)}</span></div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">{preorderFinancialBadges(row)}</div>
                                </div>
                                <div className="rounded-2xl border bg-white p-3 text-sm">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Timeline</div>
                                  <div className="mt-1">Created: <span className="font-medium">{formatDateTime(row.created_at)}</span></div>
                                  <div>Updated: <span className="font-medium">{formatDateTime(row.updated_at)}</span></div>
                                  <div>Deposit payment: <span className="font-medium">{paymentLabel(row.deposit_payment_method)}</span></div>
                                </div>
                              </div>

                              {preorderBalanceDue(row) ? (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                  <span className="font-semibold">Balance due:</span> {formatCurrency(row.balance_due_cents)} remains to be collected before or during completion.
                                </div>
                              ) : (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                                  <span className="font-semibold">No remaining balance:</span> deposit covers the current preorder total.
                                </div>
                              )}

                              {preorderReadyToComplete(row) ? (
                                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                                  <span className="font-semibold">Ready to complete:</span> use Complete & create sale when the item is delivered to the member.
                                </div>
                              ) : null}

                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  prefetch={false}
                                  href={`/members/${row.buyer_user_id}`}
                                  className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                                >
                                  Open member
                                </Link>
                              </div>

                              {row.note ? (
                                <div className="rounded-2xl border border-dashed bg-white p-3 text-sm text-[hsl(var(--muted))]">
                                  <span className="font-medium text-black">Customer note:</span> {row.note}
                                </div>
                              ) : null}
                            </div>

                            <div className="space-y-4">
                              <AdminPreorderCollectPayment
                                id={row.id}
                                totalCents={row.total_cents}
                                depositCents={row.deposit_cents}
                                balanceDueCents={row.balance_due_cents}
                                depositPaymentMethod={row.deposit_payment_method}
                                status={row.status}
                                convertedSaleId={row.converted_sale_id}
                                productLabel={preorderProductLabel(row)}
                                buyerLabel={preorderBuyerLabel(row)}
                                qty={row.qty}
                              />
                              <AdminPreorderQuickEdit
                                id={row.id}
                                totalCents={row.total_cents}
                                depositCents={row.deposit_cents}
                                depositPaymentMethod={row.deposit_payment_method}
                                status={row.status}
                                note={row.note}
                                productLabel={preorderProductLabel(row)}
                                buyerLabel={preorderBuyerLabel(row)}
                                qty={row.qty}
                              />
                              <CompletePreorderAsSaleButton
                                id={row.id}
                                status={row.status}
                                totalCents={row.total_cents}
                                balanceDueCents={row.balance_due_cents}
                                depositPaymentMethod={row.deposit_payment_method}
                                convertedSaleId={row.converted_sale_id}
                                productLabel={preorderProductLabel(row)}
                                buyerLabel={preorderBuyerLabel(row)}
                                qty={row.qty}
                              />
                            </div>
                          </div>
                        </div>
                      </details>
                    ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
                <div>Page {safePage} / {totalPages}</div>
                <div className="flex gap-2">
                  <Link href={buildUrl('/admin/store/preorders', { ...baseParams, page: String(Math.max(1, safePage - 1)) })} className={`rounded-xl border px-4 py-2 ${safePage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Previous</Link>
                  <Link href={buildUrl('/admin/store/preorders', { ...baseParams, page: String(safePage + 1) })} className={`rounded-xl border px-4 py-2 ${!hasMore ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Next</Link>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </Section>
    </main>
  )
}
