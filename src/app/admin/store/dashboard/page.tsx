export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreDashboard } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import StoreAdminNav from '@/components/store/StoreAdminNav'
import {
  FALLBACK_STORE_PRODUCT_CATEGORIES,
  buildStoreCategoryOptions,
  storeCategoryLabelMap,
  type StoreProductCategoryRow,
} from '@/lib/storeCategories'

type SearchParams = Record<string, string | string[] | undefined>

type DashboardSummaryRow = {
  total_products: number | string | null
  active_products: number | string | null
  preorder_enabled_products: number | string | null
  stock_units: number | string | null
  stock_value_cents: number | string | null
  low_stock_count: number | string | null
  out_of_stock_count: number | string | null
  open_supplier_orders: number | string | null
  pending_supplier_units: number | string | null
  open_preorders: number | string | null
  ready_preorders: number | string | null
  preorder_deposit_cents: number | string | null
  preorder_balance_cents: number | string | null
  outstanding_sales_debt_cents: number | string | null
  sales_count: number | string | null
  delivered_sales_count: number | string | null
  sales_total_cents: number | string | null
  sales_paid_cents: number | string | null
  sales_debt_cents: number | string | null
}

type ProductRow = {
  id: string
  category: string | null
  name: string | null
  color: string | null
  size: string | null
  inventory_qty: number | null
  price_cents: number | null
  currency: string | null
  low_stock_threshold: number | null
  is_active: boolean | null
  allow_preorder: boolean | null
}

type SupplierOrderRow = {
  id: string
  reference: string | null
  supplier_name: string | null
  status: string | null
  expected_at: string | null
  ordered_at: string | null
  created_at: string | null
}

type PreorderRow = {
  id: string
  buyer_full_name: string | null
  buyer_email: string | null
  product_name: string | null
  qty: number | null
  total_cents: number | null
  deposit_cents: number | null
  balance_due_cents: number | null
  status: string | null
  created_at: string | null
}

type SaleRow = {
  id: string
  buyer_full_name: string | null
  buyer_email: string | null
  status: string | null
  total_cents: number | null
  paid_cents: number | null
  debt_cents: number | null
  delivered_at: string | null
  created_at: string | null
}

type StoreExpenseRow = {
  id: string
  expense_date: string | null
  category: string | null
  title: string | null
  amount_cents: number | null
  payment_method: string | null
  vendor_name: string | null
  created_at: string | null
}

const ACTIVE_STOCK_PAGE_SIZE = 5

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function toInt(v: number | string | null | undefined) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
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

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
}

function positivePage(v: unknown) {
  const n = Number(strParam(v))
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1
}

function normalizeCategory(value: unknown, allowedKeys: Set<string>) {
  const clean = strParam(value).trim()
  if (clean && clean !== 'all' && allowedKeys.has(clean)) return clean
  return 'all'
}

function storeDashboardHref(activeStockPage = 1, stockCategory = 'all') {
  const params = new URLSearchParams()
  if (stockCategory && stockCategory !== 'all') params.set('stockCategory', stockCategory)
  if (activeStockPage > 1) params.set('stockPage', String(activeStockPage))
  const qs = params.toString()
  return qs ? `/admin/store/dashboard?${qs}` : '/admin/store/dashboard'
}

function productLabel(p: Pick<ProductRow, 'name' | 'color' | 'size'>) {
  return [p.name || 'Product', p.color || '', p.size || ''].filter(Boolean).join(' · ')
}

function stockStatus(product: Pick<ProductRow, 'inventory_qty' | 'low_stock_threshold'>) {
  const qty = toInt(product.inventory_qty)
  const threshold = toInt(product.low_stock_threshold)

  if (qty <= 0) {
    return {
      label: 'Out of stock',
      className: 'border-rose-300 bg-rose-50 text-rose-900',
    }
  }

  if (qty <= threshold) {
    return {
      label: 'Low stock',
      className: 'border-amber-300 bg-amber-50 text-amber-900',
    }
  }

  return {
    label: 'Available',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  }
}

function productStockValueCents(product: Pick<ProductRow, 'inventory_qty' | 'price_cents'>) {
  return Math.max(0, toInt(product.inventory_qty)) * Math.max(0, toInt(product.price_cents))
}

function safeAverageCents(totalCents: number, count: number) {
  if (!Number.isFinite(totalCents) || !Number.isFinite(count) || count <= 0) return 0
  return Math.round(totalCents / count)
}

function preorderStatusLabel(status?: string | null) {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'confirmed':
      return 'Confirmed'
    case 'ordered_from_supplier':
      return 'Ordered from supplier'
    case 'ready':
      return 'Ready'
    case 'completed':
      return 'Completed'
    case 'canceled':
      return 'Canceled'
    default:
      return status || '—'
  }
}

function saleStatusLabel(status?: string | null) {
  switch (status) {
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
      return status || '—'
  }
}

function supplierStatusLabel(status?: string | null) {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'ordered':
      return 'Ordered'
    case 'partially_received':
      return 'Partially received'
    case 'received':
      return 'Received'
    case 'canceled':
      return 'Canceled'
    default:
      return status || '—'
  }
}

function storeExpenseCategoryLabel(category?: string | null) {
  switch (category) {
    case 'supplier_order':
      return 'Supplier order'
    case 'transport':
      return 'Transport'
    case 'customs_taxes':
      return 'Customs / taxes'
    case 'packaging':
      return 'Packaging'
    case 'refund':
      return 'Refund'
    case 'other':
      return 'Other'
    default:
      return category || '—'
  }
}

function paymentMethodLabel(method?: string | null) {
  switch (method) {
    case 'cash':
      return 'Cash'
    case 'card':
      return 'Card'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return method || '—'
  }
}

function chipClass(status?: string | null) {
  switch (status) {
    case 'ready':
    case 'delivered':
    case 'received':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    case 'pending':
    case 'draft':
      return 'border-amber-300 bg-amber-50 text-amber-900'
    case 'confirmed':
    case 'paid':
    case 'ordered':
      return 'border-sky-300 bg-sky-50 text-sky-900'
    case 'ordered_from_supplier':
    case 'partial_paid':
    case 'partially_received':
      return 'border-violet-300 bg-violet-50 text-violet-900'
    case 'canceled':
      return 'border-rose-300 bg-rose-50 text-rose-900'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--fg))]'
  }
}

function StatCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">{title}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint ? <div className="text-xs text-[hsl(var(--muted))]">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

export default async function StoreDashboardPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/dashboard')

  if (!canAccessStoreDashboard(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Dashboard"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for admin and super admin roles."
        allowed="admin, super_admin"
        nextPath="/admin/store/dashboard"
        actions={[{ href: '/admin/store', label: 'Go to Store Admin' }]}
        showBackHome
      />
    )
  }

  const supa = getSupabaseAdminClientCached()

  let summary: DashboardSummaryRow | null = null
  let activeStockProducts: ProductRow[] = []
  let lowStockProducts: ProductRow[] = []
  let recentSupplierOrders: SupplierOrderRow[] = []
  let recentPreorders: PreorderRow[] = []
  let recentSales: SaleRow[] = []
  let recentStoreExpenses: StoreExpenseRow[] = []
  let storeExpensesLast30dCents = 0
  let pageError: string | null = null

  let categoryRows: StoreProductCategoryRow[] = []
  try {
    const { data, error } = await supa
      .from('store_product_categories')
      .select('key,label,is_active,sort_order')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (error) throw error
    categoryRows = ((data ?? []) as StoreProductCategoryRow[]).filter((row) => row.key && row.label)
  } catch {
    categoryRows = FALLBACK_STORE_PRODUCT_CATEGORIES
  }

  if (categoryRows.length === 0) categoryRows = FALLBACK_STORE_PRODUCT_CATEGORIES
  const activeCategoryRows = categoryRows.filter((row) => row.is_active)
  const categoryKeys = new Set(activeCategoryRows.map((row) => row.key))
  const activeStockCategory = normalizeCategory(searchParams?.stockCategory, categoryKeys)
  const categoryOptions = buildStoreCategoryOptions(activeCategoryRows, { includeAll: true })
  const categoryLabels = storeCategoryLabelMap(categoryRows)
  const last30Date = new Date()
  last30Date.setDate(last30Date.getDate() - 29)
  const last30DateString = last30Date.toISOString().slice(0, 10)

  try {
    const [summaryRes, activeProductsRes, supplierRes, preorderRes, salesRes, expensesRes, recentExpensesRes] = await Promise.all([
      supa.rpc('admin_store_dashboard_summary', { _days: 30 } as any),
      supa
        .from('store_products')
        .select('id,category,name,color,size,inventory_qty,price_cents,currency,low_stock_threshold,is_active,allow_preorder')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .order('color', { ascending: true })
        .order('size', { ascending: true })
        .limit(500),
      supa
        .from('store_supplier_orders')
        .select('id,reference,supplier_name,status,expected_at,ordered_at,created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supa
        .from('store_preorders')
        .select('id,buyer_full_name,buyer_email,product_name,qty,total_cents,deposit_cents,balance_due_cents,status,created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supa
        .from('store_sales')
        .select('id,buyer_full_name,buyer_email,status,total_cents,paid_cents,debt_cents,delivered_at,created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supa
        .from('store_expenses')
        .select('amount_cents')
        .is('deleted_at', null)
        .gte('expense_date', last30DateString)
        .limit(100000),
      supa
        .from('store_expenses')
        .select('id,expense_date,category,title,amount_cents,payment_method,vendor_name,created_at')
        .is('deleted_at', null)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(6),
    ])

    if (summaryRes.error) throw new Error(summaryRes.error.message)
    if (activeProductsRes.error) throw new Error(activeProductsRes.error.message)
    if (supplierRes.error) throw new Error(supplierRes.error.message)
    if (preorderRes.error) throw new Error(preorderRes.error.message)
    if (salesRes.error) throw new Error(salesRes.error.message)

    summary = Array.isArray(summaryRes.data) ? ((summaryRes.data[0] as DashboardSummaryRow | undefined) ?? null) : null

    const activeProductsRaw = Array.isArray(activeProductsRes.data) ? (activeProductsRes.data as ProductRow[]) : []
    activeStockProducts = activeProductsRaw
      .filter((row) => Boolean(row.is_active))
      .sort((a, b) => productLabel(a).localeCompare(productLabel(b), 'en'))

    lowStockProducts = [...activeStockProducts]
      .filter((row) => toInt(row.inventory_qty) <= toInt(row.low_stock_threshold))
      .sort((a, b) => toInt(a.inventory_qty) - toInt(b.inventory_qty))
      .slice(0, 8)

    recentSupplierOrders = Array.isArray(supplierRes.data) ? (supplierRes.data as SupplierOrderRow[]) : []
    recentPreorders = Array.isArray(preorderRes.data) ? (preorderRes.data as PreorderRow[]) : []
    recentSales = Array.isArray(salesRes.data) ? (salesRes.data as SaleRow[]) : []
    storeExpensesLast30dCents = !expensesRes.error && Array.isArray(expensesRes.data)
      ? expensesRes.data.reduce((sum: number, row: any) => sum + Math.max(0, Number(row?.amount_cents ?? 0)), 0)
      : 0
    recentStoreExpenses = !recentExpensesRes.error && Array.isArray(recentExpensesRes.data) ? (recentExpensesRes.data as StoreExpenseRow[]) : []
  } catch (e: any) {
    pageError = e?.message || String(e)
  }

  const metrics = summary || {
    total_products: 0,
    active_products: 0,
    preorder_enabled_products: 0,
    stock_units: 0,
    stock_value_cents: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    open_supplier_orders: 0,
    pending_supplier_units: 0,
    open_preorders: 0,
    ready_preorders: 0,
    preorder_deposit_cents: 0,
    preorder_balance_cents: 0,
    outstanding_sales_debt_cents: 0,
    sales_count: 0,
    delivered_sales_count: 0,
    sales_total_cents: 0,
    sales_paid_cents: 0,
    sales_debt_cents: 0,
  }

  const filteredActiveStockProducts = activeStockCategory === 'all'
    ? activeStockProducts
    : activeStockProducts.filter((product) => product.category === activeStockCategory)
  const filteredActiveStockTotalUnits = filteredActiveStockProducts.reduce((sum, product) => sum + toInt(product.inventory_qty), 0)
  const activeStockCategoryLabel = activeStockCategory === 'all'
    ? 'All categories'
    : (categoryLabels.get(activeStockCategory) ?? activeStockCategory)

  const requestedStockPage = positivePage(searchParams?.stockPage)
  const activeStockTotalPages = Math.max(1, Math.ceil(filteredActiveStockProducts.length / ACTIVE_STOCK_PAGE_SIZE))
  const activeStockPage = Math.min(requestedStockPage, activeStockTotalPages)
  const activeStockStart = (activeStockPage - 1) * ACTIVE_STOCK_PAGE_SIZE
  const visibleActiveStockProducts = filteredActiveStockProducts.slice(activeStockStart, activeStockStart + ACTIVE_STOCK_PAGE_SIZE)
  const activeStockTotalUnits = activeStockProducts.reduce((sum, product) => sum + toInt(product.inventory_qty), 0)
  const activeStockForecastRevenueCents = activeStockProducts.reduce((sum, product) => sum + productStockValueCents(product), 0)
  const sellableProductsCount = activeStockProducts.filter((product) => toInt(product.inventory_qty) > 0).length
  const outOfStockProductsCount = activeStockProducts.filter((product) => toInt(product.inventory_qty) <= 0).length
  const lowStockProductsCount = activeStockProducts.filter((product) => {
    const qty = toInt(product.inventory_qty)
    return qty > 0 && qty <= toInt(product.low_stock_threshold)
  }).length
  const averageStockUnitPriceCents = safeAverageCents(activeStockForecastRevenueCents, activeStockTotalUnits)
  const storeNetCashLast30dCents = toInt(metrics.sales_paid_cents) - storeExpensesLast30dCents

  return (
    <main>
      <PageHeader
        title="Store Dashboard"
        subtitle="Current stock, pipeline, supplier flow, preorders, and sales overview."
        showReload
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/dashboard" role={me.role} />
      </Section>

      <Section className="space-y-6">
        {pageError ? (
          <InlineAlert variant="error" title="Dashboard failed to load">{pageError}</InlineAlert>
        ) : null}

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Current business health</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Live stock, preorder pipeline, supplier flow, and outstanding balances.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Active products"
              value={String(toInt(metrics.active_products))}
              hint={`${toInt(metrics.total_products)} total · ${toInt(metrics.preorder_enabled_products)} preorder enabled`}
            />
            <StatCard
              title="Units in stock"
              value={String(toInt(metrics.stock_units))}
              hint={`${formatCurrency(toInt(metrics.stock_value_cents), 'en-EG', 'EGP')} stock value`}
            />
            <StatCard
              title="Low / out of stock"
              value={`${toInt(metrics.low_stock_count)} / ${toInt(metrics.out_of_stock_count)}`}
              hint="Low stock threshold is product-based"
            />
            <StatCard
              title="Open supplier orders"
              value={String(toInt(metrics.open_supplier_orders))}
              hint={`${toInt(metrics.pending_supplier_units)} units still pending receipt`}
            />
            <StatCard
              title="Open preorders"
              value={String(toInt(metrics.open_preorders))}
              hint={`${toInt(metrics.ready_preorders)} ready for pickup / delivery`}
            />
            <StatCard
              title="Preorder deposits"
              value={formatCurrency(toInt(metrics.preorder_deposit_cents), 'en-EG', 'EGP')}
              hint={`${formatCurrency(toInt(metrics.preorder_balance_cents), 'en-EG', 'EGP')} still due on open preorders`}
            />
            <StatCard
              title="Outstanding sales debt"
              value={formatCurrency(toInt(metrics.outstanding_sales_debt_cents), 'en-EG', 'EGP')}
              hint="Current unpaid amount across non-canceled sales"
            />
            <StatCard
              title="Sales last 30d"
              value={String(toInt(metrics.sales_count))}
              hint={`${toInt(metrics.delivered_sales_count)} delivered in the last 30 days`}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Stock revenue forecast</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Potential revenue if the current active stock is sold at the recorded product prices.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Forecast revenue"
              value={formatCurrency(activeStockForecastRevenueCents, 'en-EG', 'EGP')}
              hint="Active stock × product sale price"
            />
            <StatCard
              title="Sellable products"
              value={`${sellableProductsCount} / ${activeStockProducts.length}`}
              hint={`${activeStockTotalUnits} units currently available`}
            />
            <StatCard
              title="Average unit price"
              value={formatCurrency(averageStockUnitPriceCents, 'en-EG', 'EGP')}
              hint="Weighted by units currently in stock"
            />
            <StatCard
              title="Stock risk"
              value={`${lowStockProductsCount} low · ${outOfStockProductsCount} out`}
              hint="Active products needing attention"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Available stock by active product</h2>
              <p className="text-sm text-[hsl(var(--muted))]">
                Active products only · 5 products per page · {filteredActiveStockTotalUnits} units available · {activeStockCategoryLabel}.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <form method="get" action="/admin/store/dashboard" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="stockPage" value="1" />
                <label className="grid gap-1 text-xs font-medium text-[hsl(var(--muted))]">
                  Category
                  <select
                    name="stockCategory"
                    defaultValue={activeStockCategory}
                    className="min-h-9 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm text-[hsl(var(--fg))]"
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="min-h-9 rounded-xl border px-3 py-1.5 text-sm font-semibold shadow-sm">
                  Apply
                </button>
                {activeStockCategory !== 'all' ? (
                  <Button asChild href={storeDashboardHref(1, 'all')} variant="outline" size="sm" className="min-h-9 rounded-xl px-3 py-1.5 text-sm">
                    Clear
                  </Button>
                ) : null}
              </form>
              <Button asChild href="/admin/store" variant="outline" size="sm">
                Manage catalog
              </Button>
            </div>
          </div>

          <Card className="p-4">
            <CardContent className="space-y-2">
              {visibleActiveStockProducts.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted))]">No active products found for this category.</div>
              ) : (
                <>
                  <div className="space-y-2">
                    {visibleActiveStockProducts.map((product) => {
                      const status = stockStatus(product)
                      const qty = toInt(product.inventory_qty)
                      const threshold = toInt(product.low_stock_threshold)

                      return (
                        <div key={product.id} className="rounded-2xl border px-3 py-2">
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold">{productLabel(product)}</div>
                              <div className="text-xs text-[hsl(var(--muted))]">
                                #{shortId(product.id)} · {categoryLabels.get(product.category || '') ?? product.category ?? 'Uncategorized'}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className={`rounded-full border px-2 py-1 text-xs font-medium ${status.className}`}>
                                {status.label}
                              </span>
                              <span className="rounded-full border px-2 py-1 text-xs font-semibold">
                                Stock {qty}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-1 text-xs text-[hsl(var(--muted))] sm:grid-cols-3">
                            <div>Threshold {threshold}</div>
                            <div>Value {formatCurrency(productStockValueCents(product), 'en-EG', product.currency || 'EGP')}</div>
                            <div>{product.allow_preorder ? 'Preorder enabled' : 'Preorder disabled'}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-[hsl(var(--muted))]">
                    <div>
                      Showing {activeStockStart + 1}-{Math.min(activeStockStart + ACTIVE_STOCK_PAGE_SIZE, filteredActiveStockProducts.length)} of {filteredActiveStockProducts.length} active products
                    </div>
                    <div className="flex items-center gap-2">
                      {activeStockPage > 1 ? (
                        <Button asChild href={storeDashboardHref(activeStockPage - 1, activeStockCategory)} variant="outline" size="sm" className="min-h-9 rounded-xl px-3 py-1.5 text-xs">
                          Previous
                        </Button>
                      ) : (
                        <span className="inline-flex min-h-9 items-center rounded-xl border px-3 py-1.5 text-xs font-semibold opacity-50">Previous</span>
                      )}
                      <span>Page {activeStockPage} / {activeStockTotalPages}</span>
                      {activeStockPage < activeStockTotalPages ? (
                        <Button asChild href={storeDashboardHref(activeStockPage + 1, activeStockCategory)} variant="outline" size="sm" className="min-h-9 rounded-xl px-3 py-1.5 text-xs">
                          Next
                        </Button>
                      ) : (
                        <span className="inline-flex min-h-9 items-center rounded-xl border px-3 py-1.5 text-xs font-semibold opacity-50">Next</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Sales activity</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Last 30 days. The period selector was removed to keep the dashboard simple and stable.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              title="Sales total"
              value={formatCurrency(toInt(metrics.sales_total_cents), 'en-EG', 'EGP')}
              hint="Total sale value created in the last 30 days"
            />
            <StatCard
              title="Collected"
              value={formatCurrency(toInt(metrics.sales_paid_cents), 'en-EG', 'EGP')}
              hint="Paid amount recorded in the last 30 days"
            />
            <StatCard
              title="Store expenses"
              value={formatCurrency(storeExpensesLast30dCents, 'en-EG', 'EGP')}
              hint="Active store expenses in the last 30 days"
            />
            <StatCard
              title="Net store cash"
              value={formatCurrency(storeNetCashLast30dCents, 'en-EG', 'EGP')}
              hint="Collected sales minus store expenses"
            />
            <StatCard
              title="Debt in last 30 days"
              value={formatCurrency(toInt(metrics.sales_debt_cents), 'en-EG', 'EGP')}
              hint="Remaining debt from sales created in the last 30 days"
            />
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Low stock now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lowStockProducts.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted))]">No low stock products right now.</div>
              ) : (
                lowStockProducts.map((product) => (
                  <div key={product.id} className="rounded-2xl border p-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{productLabel(product)}</div>
                        <div className="text-xs text-[hsl(var(--muted))]">#{shortId(product.id)}</div>
                      </div>
                      <span className="rounded-full border px-2 py-1 text-xs font-medium">
                        Stock {toInt(product.inventory_qty)} / Threshold {toInt(product.low_stock_threshold)}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-[hsl(var(--muted))]">
                      {formatCurrency(toInt(product.price_cents), 'en-EG', product.currency || 'EGP')}
                      {product.allow_preorder ? ' · Preorder enabled' : ' · Preorder disabled'}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest supplier orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentSupplierOrders.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted))]">No supplier orders yet.</div>
              ) : (
                recentSupplierOrders.map((order) => (
                  <div key={order.id} className="rounded-2xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{order.reference || `Order #${shortId(order.id)}`}</div>
                      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${chipClass(order.status)}`}>
                        {supplierStatusLabel(order.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">{order.supplier_name || 'No supplier name'}</div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                      Expected: {fmtDate(order.expected_at)} · Created: {fmtDateTime(order.created_at)}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest preorders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentPreorders.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted))]">No preorders yet.</div>
              ) : (
                recentPreorders.map((preorder) => (
                  <div key={preorder.id} className="rounded-2xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{preorder.product_name || 'Product'}</div>
                      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${chipClass(preorder.status)}`}>
                        {preorderStatusLabel(preorder.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {(preorder.buyer_full_name || preorder.buyer_email || 'Unknown buyer')}
                      {preorder.qty ? ` · Qty ${preorder.qty}` : ''}
                    </div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                      Total {formatCurrency(toInt(preorder.total_cents), 'en-EG', 'EGP')} · Deposit {formatCurrency(toInt(preorder.deposit_cents), 'en-EG', 'EGP')} · Due {formatCurrency(toInt(preorder.balance_due_cents), 'en-EG', 'EGP')}
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDateTime(preorder.created_at)}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest sales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentSales.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted))]">No sales yet.</div>
              ) : (
                recentSales.map((sale) => (
                  <div key={sale.id} className="rounded-2xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{sale.buyer_full_name || sale.buyer_email || `Sale #${shortId(sale.id)}`}</div>
                      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${chipClass(sale.status)}`}>
                        {saleStatusLabel(sale.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                      Total {formatCurrency(toInt(sale.total_cents), 'en-EG', 'EGP')} · Paid {formatCurrency(toInt(sale.paid_cents), 'en-EG', 'EGP')} · Debt {formatCurrency(toInt(sale.debt_cents), 'en-EG', 'EGP')}
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      Created: {fmtDateTime(sale.created_at)}{sale.delivered_at ? ` · Delivered: ${fmtDateTime(sale.delivered_at)}` : ''}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest store expenses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentStoreExpenses.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted))]">No store expenses yet.</div>
              ) : (
                recentStoreExpenses.map((expense) => (
                  <div key={expense.id} className="rounded-2xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{expense.title || `Expense #${shortId(expense.id)}`}</div>
                      <span className="rounded-full border px-2 py-1 text-xs font-medium">
                        {storeExpenseCategoryLabel(expense.category)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">{expense.vendor_name || 'No vendor'}</div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                      {formatCurrency(toInt(expense.amount_cents), 'en-EG', 'EGP')} · {paymentMethodLabel(expense.payment_method)} · Date {fmtDate(expense.expense_date)}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </Section>
    </main>
  )
}
