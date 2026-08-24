export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreAdmin } from '@/lib/rbac'
import AdminSaleForm from '@/components/store/AdminSaleForm'
import AdminSaleQuickEdit from '@/components/store/AdminSaleQuickEdit'
import AdminSaleReceipt from '@/components/store/AdminSaleReceipt'
import StoreAdminNav from '@/components/store/StoreAdminNav'

type SearchParams = Record<string, string | string[] | undefined>

type SortDir = 'asc' | 'desc'
type SaleSortKey = 'created_at' | 'purchase_date' | 'buyer_full_name' | 'status' | 'total_cents' | 'paid_cents' | 'debt_cents'

type SaleStatus = 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'
type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type MoneyFilter = 'all' | 'outstanding' | 'cleared'

type SaleRow = {
  id: string
  buyer_user_id: string | null
  buyer_member_id: string | null
  buyer_full_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  status: SaleStatus
  payment_method: PaymentMethod | null
  currency: string | null
  total_cents: number
  discount_cents: number | null
  paid_cents: number
  debt_cents: number
  note: string | null
  delivered_at: string | null
  purchase_date: string | null
  created_at: string
}

type SaleItemRow = {
  sale_id: string
  product_id: string
  product_name: string | null
  qty: number
  unit_price_cents: number
  line_total_cents: number
  currency: string | null
  delivered_stock_applied: boolean | null
}

type ProductOption = {
  id: string
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
}

const STATUSES: Array<{ value: 'all' | SaleStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'partial_paid', label: 'Partial paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'canceled', label: 'Canceled' },
]

const PAYMENTS: Array<{ value: 'all' | PaymentMethod; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

const MONEY_FILTERS: Array<{ value: MoneyFilter; label: string }> = [
  { value: 'all', label: 'All money status' },
  { value: 'outstanding', label: 'Outstanding debt' },
  { value: 'cleared', label: 'No remaining debt' },
]

function normalizeSortDir(v: string): SortDir {
  return v === 'asc' ? 'asc' : 'desc'
}

function normalizeSaleSort(v: string): SaleSortKey {
  return v === 'purchase_date' || v === 'buyer_full_name' || v === 'status' || v === 'total_cents' || v === 'paid_cents' || v === 'debt_cents' ? v : 'purchase_date'
}

function renderSortLink(basePath: string, params: Record<string, string>, column: SaleSortKey, currentSort: SaleSortKey, currentDir: SortDir, label: string, defaultDir: SortDir = 'asc') {
  const isActive = currentSort === column
  const nextDir: SortDir = isActive ? (currentDir === 'asc' ? 'desc' : 'asc') : defaultDir
  return (
    <Link
      prefetch={false}
      href={buildUrl(basePath, { ...params, sort: column, dir: nextDir, page: '1' })}
      className="inline-flex items-center gap-1 hover:text-black"
    >
      <span>{label}</span>
      <span className="text-[10px]">{isActive ? (currentDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </Link>
  )
}

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function normalizeDateParam(v: unknown) {
  const s = strParam(v).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function dateParamFromDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function todayDateParam() {
  return dateParamFromDate(new Date())
}

function firstDayOfCurrentMonthParam() {
  const now = new Date()
  return dateParamFromDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function humanStatus(s: SaleStatus) {
  switch (s) {
    case 'draft':
      return 'Draft'
    case 'partial_paid':
      return 'Partial paid'
    case 'paid':
      return 'Paid'
    case 'delivered':
      return 'Delivered'
    case 'canceled':
      return 'Canceled'
    default:
      return s
  }
}

function statusChipClass(status: SaleStatus) {
  switch (status) {
    case 'delivered':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    case 'paid':
      return 'border-sky-300 bg-sky-50 text-sky-900'
    case 'partial_paid':
      return 'border-amber-300 bg-amber-50 text-amber-900'
    case 'canceled':
      return 'border-rose-300 bg-rose-50 text-rose-900'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--fg))]'
  }
}

function saleItemsLabel(items: SaleItemRow[]) {
  if (items.length === 0) return 'No items'
  const first = items[0]?.product_name || 'Product'
  if (items.length === 1) return first
  return `${first} +${items.length - 1}`
}

function paymentLabel(value: PaymentMethod | null) {
  if (!value) return '—'
  return PAYMENTS.find((payment) => payment.value === value)?.label || value
}

function debtTextClass(debtCents: number) {
  return debtCents > 0 ? 'font-semibold text-amber-700' : 'font-medium text-emerald-700'
}

export default async function AdminStoreSalesPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/sales')

  if (!canAccessStoreAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Sales"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store/sales"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const supa = getSupabaseAdminClientCached()
  const q = strParam(searchParams?.q).trim()
  const statusRaw = strParam(searchParams?.status)
  const paymentRaw = strParam(searchParams?.payment)
  const moneyRaw = strParam(searchParams?.money)
  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = 5
  const purchaseFrom = normalizeDateParam(searchParams?.purchase_from)
  const purchaseTo = normalizeDateParam(searchParams?.purchase_to)
  const sort = normalizeSaleSort(strParam(searchParams?.sort))
  const dir = normalizeSortDir(strParam(searchParams?.dir))

  const status = (STATUSES.map((s) => s.value) as string[]).includes(statusRaw) ? statusRaw : 'all'
  const payment = (PAYMENTS.map((p) => p.value) as string[]).includes(paymentRaw) ? paymentRaw : 'all'
  const money = (MONEY_FILTERS.map((m) => m.value) as string[]).includes(moneyRaw) ? (moneyRaw as MoneyFilter) : 'all'

  let productOptions: ProductOption[] = []
  let sales: SaleRow[] = []
  let itemsBySale = new Map<string, SaleItemRow[]>()
  let salesError: string | null = null
  let totalCount = 0
  let metrics = {
    totalSales: 0,
    deliveredCount: 0,
    collectedCents: 0,
    debtCents: 0,
    totalCents: 0,
    outstandingCount: 0,
    partialPaidCount: 0,
    unpaidDraftCount: 0,
  }

  try {
    const [{ data: productsData, error: productsErr }, { data: metricsData, error: metricsErr }] = await Promise.all([
      supa
        .from('store_products')
        .select('id,name,color,size,price_cents,currency,inventory_qty,is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(200),
      supa
        .from('store_sales')
        .select('status,total_cents,paid_cents,debt_cents')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (productsErr) throw new Error(productsErr.message)
    if (metricsErr) throw new Error(metricsErr.message)

    productOptions = Array.isArray(productsData) ? (productsData as ProductOption[]) : []

    const metricRows = Array.isArray(metricsData) ? metricsData : []
    metrics = metricRows.reduce(
      (acc, row: any) => {
        const rowDebtCents = Number(row?.debt_cents || 0)
        acc.totalSales += 1
        if (row?.status === 'delivered') acc.deliveredCount += 1
        if (row?.status === 'partial_paid') acc.partialPaidCount += 1
        if (row?.status === 'draft' && rowDebtCents > 0) acc.unpaidDraftCount += 1
        if (rowDebtCents > 0) acc.outstandingCount += 1
        acc.totalCents += Number(row?.total_cents || 0)
        acc.collectedCents += Number(row?.paid_cents || 0)
        acc.debtCents += rowDebtCents
        return acc
      },
      { totalSales: 0, deliveredCount: 0, collectedCents: 0, debtCents: 0, totalCents: 0, outstandingCount: 0, partialPaidCount: 0, unpaidDraftCount: 0 }
    )

    let countQ = supa.from('store_sales').select('id', { count: 'exact', head: true })
    let salesQ = supa
      .from('store_sales')
      .select('id,buyer_user_id,buyer_member_id,buyer_full_name,buyer_email,buyer_phone,status,payment_method,currency,total_cents,discount_cents,paid_cents,debt_cents,note,delivered_at,purchase_date,created_at')
      .order(sort, { ascending: dir === 'asc' })

    if (sort !== 'created_at') {
      salesQ = salesQ.order('created_at', { ascending: false })
    }

    salesQ = salesQ.range((page - 1) * pageSize, page * pageSize - 1)

    if (status !== 'all') {
      countQ = countQ.eq('status', status)
      salesQ = salesQ.eq('status', status)
    }
    if (payment !== 'all') {
      countQ = countQ.eq('payment_method', payment)
      salesQ = salesQ.eq('payment_method', payment)
    }
    if (money === 'outstanding') {
      countQ = countQ.gt('debt_cents', 0)
      salesQ = salesQ.gt('debt_cents', 0)
    } else if (money === 'cleared') {
      countQ = countQ.eq('debt_cents', 0)
      salesQ = salesQ.eq('debt_cents', 0)
    }
    if (purchaseFrom) {
      countQ = countQ.gte('purchase_date', purchaseFrom)
      salesQ = salesQ.gte('purchase_date', purchaseFrom)
    }
    if (purchaseTo) {
      countQ = countQ.lte('purchase_date', purchaseTo)
      salesQ = salesQ.lte('purchase_date', purchaseTo)
    }
    if (q) {
      const like = `%${q.replace(/,/g, ' ')}%`
      const orExpr = `buyer_full_name.ilike.${like},buyer_email.ilike.${like},buyer_phone.ilike.${like}`
      countQ = countQ.or(orExpr)
      salesQ = salesQ.or(orExpr)
    }

    const [{ count, error: countErr }, { data: salesData, error: salesErr }] = await Promise.all([countQ, salesQ])
    if (countErr) throw new Error(countErr.message)
    if (salesErr) throw new Error(salesErr.message)

    totalCount = Number(count || 0)
    sales = Array.isArray(salesData) ? (salesData as SaleRow[]) : []

    if (sales.length > 0) {
      const saleIds = sales.map((s) => s.id)
      const { data: itemsData, error: itemsErr } = await supa
        .from('store_sale_items')
        .select('sale_id,product_id,product_name,qty,unit_price_cents,line_total_cents,currency,delivered_stock_applied')
        .in('sale_id', saleIds)
        .order('created_at', { ascending: true })
      if (itemsErr) throw new Error(itemsErr.message)

      for (const item of Array.isArray(itemsData) ? (itemsData as SaleItemRow[]) : []) {
        const bucket = itemsBySale.get(item.sale_id) ?? []
        bucket.push(item)
        itemsBySale.set(item.sale_id, bucket)
      }
    }
  } catch (e: any) {
    salesError = e?.message || String(e)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const baseParams = {
    q,
    status,
    payment,
    money,
    purchase_from: purchaseFrom,
    purchase_to: purchaseTo,
    sort,
    dir,
  }

  const today = todayDateParam()
  const monthStart = firstDayOfCurrentMonthParam()
  const quickFilters = [
    {
      label: 'All sales',
      href: '/admin/store/sales',
      active: !q && status === 'all' && payment === 'all' && money === 'all' && !purchaseFrom && !purchaseTo,
    },
    {
      label: 'Outstanding debt',
      href: buildUrl('/admin/store/sales', { money: 'outstanding', sort: 'debt_cents', dir: 'desc' }),
      active: money === 'outstanding',
    },
    {
      label: 'No remaining debt',
      href: buildUrl('/admin/store/sales', { money: 'cleared', sort: 'purchase_date', dir: 'desc' }),
      active: money === 'cleared',
    },
    {
      label: 'Partial paid',
      href: buildUrl('/admin/store/sales', { status: 'partial_paid', money: 'outstanding', sort: 'debt_cents', dir: 'desc' }),
      active: status === 'partial_paid',
    },
    {
      label: 'Today',
      href: buildUrl('/admin/store/sales', { purchase_from: today, purchase_to: today, sort: 'purchase_date', dir: 'desc' }),
      active: purchaseFrom === today && purchaseTo === today,
    },
    {
      label: 'This month',
      href: buildUrl('/admin/store/sales', { purchase_from: monthStart, purchase_to: today, sort: 'purchase_date', dir: 'desc' }),
      active: purchaseFrom === monthStart && purchaseTo === today,
    },
  ]

  return (
    <main>
      <PageHeader
        title="Store Admin — Sales & Debt"
        subtitle="Create sales, filter purchase dates, and edit sale details safely."
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/sales" role={me.role} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Sales tracked</div>
              <div className="text-2xl font-semibold">{metrics.totalSales}</div>
              <div className="text-xs text-[hsl(var(--muted))]">Delivered: {metrics.deliveredCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Total sold</div>
              <div className="text-2xl font-semibold">{formatCurrency(metrics.totalCents, 'en-EG', 'EGP')}</div>
              <div className="text-xs text-[hsl(var(--muted))]">Last 500 sales rows</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Collected</div>
              <div className="text-2xl font-semibold">{formatCurrency(metrics.collectedCents, 'en-EG', 'EGP')}</div>
              <div className="text-xs text-[hsl(var(--muted))]">Paid amount recorded</div>
            </CardContent>
          </Card>
          <Card className={metrics.debtCents > 0 ? 'border-amber-200 ring-1 ring-amber-100' : ''}>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Outstanding debt</div>
              <div className={metrics.debtCents > 0 ? 'text-2xl font-semibold text-amber-700' : 'text-2xl font-semibold text-emerald-700'}>{formatCurrency(metrics.debtCents, 'en-EG', 'EGP')}</div>
              <div className="text-xs text-[hsl(var(--muted))]">{metrics.outstandingCount} sale{metrics.outstandingCount === 1 ? '' : 's'} need follow-up</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Partial paid: {metrics.partialPaidCount}</span>
              <span className="rounded-full border px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">Draft with debt: {metrics.unpaidDraftCount}</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">No remaining debt: {Math.max(0, metrics.totalSales - metrics.outstandingCount)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div>
              <div className="text-lg font-semibold">Create sale</div>
              <div className="text-sm text-[hsl(var(--muted))]">One product per sale for now. Keep it simple and stable.</div>
            </div>
            <AdminSaleForm products={productOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-semibold">Sales history filters</div>
              <div className="flex flex-wrap gap-2">
                {quickFilters.map((filter) => (
                  <Link
                    key={filter.label}
                    prefetch={false}
                    href={filter.href}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${filter.active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]'}`}
                  >
                    {filter.label}
                  </Link>
                ))}
              </div>
            </div>

            <form className="grid grid-cols-1 gap-3 md:grid-cols-7" action="/admin/store/sales" method="get">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-sm font-medium">Search buyer</span>
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Name, email, phone…"
                  className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Status</span>
                <select name="status" defaultValue={status} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment</span>
                <select name="payment" defaultValue={payment} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {PAYMENTS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Money</span>
                <select name="money" defaultValue={money} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {MONEY_FILTERS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">From date</span>
                <input
                  type="date"
                  name="purchase_from"
                  defaultValue={purchaseFrom}
                  className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">To date</span>
                <input
                  type="date"
                  name="purchase_to"
                  defaultValue={purchaseTo}
                  className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                />
              </label>
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="dir" value={dir} />
              <div className="flex flex-wrap items-center gap-2 md:col-span-7">
                <Button type="submit">Apply filters</Button>
                <Button asChild variant="outline" href="/admin/store/sales">
                  Reset
                </Button>
                <div className="ml-auto text-sm text-[hsl(var(--muted))]">{totalCount} result{totalCount === 1 ? '' : 's'}</div>
              </div>
            </form>
          </CardContent>
        </Card>

        {salesError ? <InlineAlert variant="error">{salesError}</InlineAlert> : null}

        <div className="space-y-4">
          {sales.length === 0 && !salesError ? (
            <Card>
              <CardContent>
                <InlineAlert compact variant="info">No sales found for the current filters.</InlineAlert>
              </CardContent>
            </Card>
          ) : null}

          {sales.length > 0 ? (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Sales history</div>
                    <div className="text-xs text-[hsl(var(--muted))]">5 sales per page. Debt rows are highlighted. Open only the sales you need to inspect, edit, or delete.</div>
                  </div>
                  <div className="rounded-full border px-3 py-1 text-xs text-[hsl(var(--muted))]">Showing {sales.length} / {totalCount}</div>
                </div>

                <div className="hidden lg:grid sticky top-16 z-20 grid-cols-[minmax(0,1.8fr)_minmax(0,1.8fr)_140px_120px_120px_120px_150px_96px] gap-3 rounded-2xl border bg-[hsl(var(--card))]/95 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted))] shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/90">
                  {renderSortLink('/admin/store/sales', baseParams, 'buyer_full_name', sort, dir, 'Buyer')}
                  <div>Items</div>
                  {renderSortLink('/admin/store/sales', baseParams, 'status', sort, dir, 'Status')}
                  {renderSortLink('/admin/store/sales', baseParams, 'total_cents', sort, dir, 'Total', 'desc')}
                  {renderSortLink('/admin/store/sales', baseParams, 'paid_cents', sort, dir, 'Paid', 'desc')}
                  {renderSortLink('/admin/store/sales', baseParams, 'debt_cents', sort, dir, 'Debt', 'desc')}
                  {renderSortLink('/admin/store/sales', baseParams, 'purchase_date', sort, dir, 'Purchase', 'desc')}
                  <div className="text-right">Open</div>
                </div>

                <div className="space-y-3">
                    {sales.map((sale) => {
                    const items = itemsBySale.get(sale.id) ?? []
                    const hasAppliedStock = items.some((item) => !!item.delivered_stock_applied)
                    const canDeleteSale = !hasAppliedStock
                    const deleteBlockedReason = canDeleteSale
                      ? null
                      : 'Delete is blocked because stock was already applied on this sale.'
                    const rowDebtCents = Math.max(0, Number(sale.debt_cents || 0))
                    const hasDebt = rowDebtCents > 0

                    return (
                      <details
                        key={sale.id}
                        className={`group overflow-hidden rounded-2xl border bg-white shadow-sm ${hasDebt ? 'border-amber-200 ring-1 ring-amber-100' : ''}`}
                      >
                        <summary className="list-none cursor-pointer">
                          <div className="lg:hidden p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{sale.buyer_full_name || 'Buyer'}</div>
                                <div className="mt-1 text-xs text-[hsl(var(--muted))]">{saleItemsLabel(items)}</div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${statusChipClass(sale.status)}`}>
                                  {humanStatus(sale.status)}
                                </span>
                                {hasDebt ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Debt</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                              <div><span className="text-[hsl(var(--muted))]">Total:</span> <span className="font-medium">{formatCurrency(sale.total_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Paid:</span> <span className="font-medium">{formatCurrency(sale.paid_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Debt:</span> <span className={debtTextClass(rowDebtCents)}>{formatCurrency(rowDebtCents, 'en-EG', sale.currency || 'EGP')}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Purchase:</span> <span className="font-medium">{fmtDate(sale.purchase_date)}</span></div>
                            </div>
                            <div className="mt-3 text-right text-xs font-medium text-[hsl(var(--muted))] group-open:hidden">Tap to open</div>
                            <div className="mt-3 hidden text-right text-xs font-medium text-[hsl(var(--muted))] group-open:block">Tap to close</div>
                          </div>

                          <div className="hidden lg:grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.8fr)_140px_120px_120px_120px_150px_96px] items-center gap-3 px-4 py-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{sale.buyer_full_name || 'Buyer'}</div>
                              <div className="truncate text-[11px] text-[hsl(var(--muted))]">{sale.buyer_email || sale.buyer_phone || 'No contact details'}</div>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{saleItemsLabel(items)}</div>
                              <div className="truncate text-[11px] text-[hsl(var(--muted))]">{items.reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0)} unit(s)</div>
                            </div>
                            <div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${statusChipClass(sale.status)}`}>
                                  {humanStatus(sale.status)}
                                </span>
                                {hasDebt ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Debt</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="text-sm font-medium">{formatCurrency(sale.total_cents, 'en-EG', sale.currency || 'EGP')}</div>
                            <div className="text-sm font-medium">{formatCurrency(sale.paid_cents, 'en-EG', sale.currency || 'EGP')}</div>
                            <div className={`text-sm ${debtTextClass(rowDebtCents)}`}>{formatCurrency(rowDebtCents, 'en-EG', sale.currency || 'EGP')}</div>
                            <div className="text-sm text-[hsl(var(--muted))]">{fmtDate(sale.purchase_date)}</div>
                            <div className="text-right text-xs font-medium text-[hsl(var(--muted))] group-open:hidden">Details</div>
                            <div className="hidden text-right text-xs font-medium text-[hsl(var(--muted))] group-open:block">Close</div>
                          </div>
                        </summary>

                        <div className="border-t bg-[hsl(var(--bg))]/40 p-4">
                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                            <div className="space-y-4">
                              {hasDebt ? (
                                <InlineAlert compact variant="warning">
                                  Outstanding debt: {formatCurrency(rowDebtCents, 'en-EG', sale.currency || 'EGP')}. Check buyer contact details before marking this sale as cleared.
                                </InlineAlert>
                              ) : (
                                <InlineAlert compact variant="success">No remaining debt on this sale.</InlineAlert>
                              )}

                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                <div className="rounded-2xl border bg-white p-3 text-sm">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Buyer</div>
                                  <div className="mt-1 font-medium">{sale.buyer_full_name || 'Buyer'}</div>
                                  <div className="mt-1 text-[hsl(var(--muted))]">{sale.buyer_email || '—'}</div>
                                  <div className="text-[hsl(var(--muted))]">{sale.buyer_phone || '—'}</div>
                                </div>
                                <div className="rounded-2xl border bg-white p-3 text-sm">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Money</div>
                                  <div className="mt-1">Total: <span className="font-medium">{formatCurrency(sale.total_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                                  <div>Discount: <span className="font-medium">{formatCurrency(Math.max(0, Number(sale.discount_cents || 0)), 'en-EG', sale.currency || 'EGP')}</span></div>
                                  <div>Paid: <span className="font-medium">{formatCurrency(sale.paid_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                                  <div>Debt: <span className={debtTextClass(rowDebtCents)}>{formatCurrency(rowDebtCents, 'en-EG', sale.currency || 'EGP')}</span></div>
                                </div>
                                <div className="rounded-2xl border bg-white p-3 text-sm">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Timeline</div>
                                  <div className="mt-1">Purchase: <span className="font-medium">{fmtDate(sale.purchase_date)}</span></div>
                                  <div>Delivered: <span className="font-medium">{fmtDateTime(sale.delivered_at)}</span></div>
                                  <div>Payment: <span className="font-medium">{paymentLabel(sale.payment_method)}</span></div>
                                </div>
                              </div>

                              <div className="rounded-2xl border bg-white p-4">
                                <div className="text-sm font-semibold">Items</div>
                                <div className="mt-3 grid gap-2">
                                  {items.length === 0 ? <div className="text-sm text-[hsl(var(--muted))]">No items.</div> : null}
                                  {items.map((item, index) => (
                                    <div key={`${sale.id}-${item.product_id}-${index}`} className="rounded-xl border px-3 py-2 text-sm">
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                          <div className="font-medium">{item.product_name || 'Product'}</div>
                                          <div className="mt-1 text-[hsl(var(--muted))]">
                                            Qty {item.qty} · {formatCurrency(item.line_total_cents, 'en-EG', item.currency || sale.currency || 'EGP')}
                                          </div>
                                        </div>
                                        {item.delivered_stock_applied ? (
                                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">Stock applied</span>
                                        ) : (
                                          <span className="rounded-full border px-2 py-0.5 text-[11px] text-[hsl(var(--muted))]">Pending stock</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <AdminSaleReceipt
                                saleId={sale.id}
                                purchaseDate={sale.purchase_date}
                                createdAt={sale.created_at}
                                buyerFullName={sale.buyer_full_name}
                                buyerEmail={sale.buyer_email}
                                buyerPhone={sale.buyer_phone}
                                status={sale.status}
                                paymentMethod={sale.payment_method}
                                currency={sale.currency}
                                totalCents={sale.total_cents}
                                discountCents={sale.discount_cents}
                                paidCents={sale.paid_cents}
                                debtCents={sale.debt_cents}
                                items={items.map((item) => ({
                                  productName: item.product_name,
                                  qty: item.qty,
                                  unitPriceCents: item.unit_price_cents,
                                  lineTotalCents: item.line_total_cents,
                                  currency: item.currency,
                                  stockApplied: !!item.delivered_stock_applied,
                                }))}
                              />

                              {sale.buyer_user_id ? (
                                <div>
                                  <Button asChild variant="outline" size="sm" href={`/members/${sale.buyer_user_id}`}>
                                    Open member
                                  </Button>
                                </div>
                              ) : null}
                            </div>

                            <AdminSaleQuickEdit
                              id={sale.id}
                              purchaseDate={sale.purchase_date}
                              buyerFullName={sale.buyer_full_name}
                              buyerEmail={sale.buyer_email}
                              buyerPhone={sale.buyer_phone}
                              totalCents={sale.total_cents}
                              discountCents={sale.discount_cents}
                              paidCents={sale.paid_cents}
                              debtCents={sale.debt_cents}
                              paymentMethod={sale.payment_method}
                              status={sale.status}
                              note={sale.note}
                              currency={sale.currency}
                              item={items[0] ? {
                                productId: items[0].product_id,
                                productName: items[0].product_name,
                                qty: items[0].qty,
                                unitPriceCents: items[0].unit_price_cents,
                                deliveredStockApplied: !!items[0].delivered_stock_applied,
                              } : null}
                              hasAppliedStock={hasAppliedStock}
                              canDelete={canDeleteSale}
                              deleteBlockedReason={deleteBlockedReason}
                            />
                          </div>
                        </div>
                      </details>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[hsl(var(--muted))]">Page {page} of {totalPages}</div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                href={buildUrl('/admin/store/sales', { ...baseParams, page: String(Math.max(1, page - 1)) })}
              >
                Previous
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                href={buildUrl('/admin/store/sales', { ...baseParams, page: String(Math.min(totalPages, page + 1)) })}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
