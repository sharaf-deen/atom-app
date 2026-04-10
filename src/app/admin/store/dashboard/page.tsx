export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreDashboard, canManageStorePreorders, canManageStoreSales } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import StoreAdminNav from '@/components/store/StoreAdminNav'

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

const WINDOWS: Array<{ value: string; label: string; days: number }> = [
  { value: '7', label: '7d', days: 7 },
  { value: '30', label: '30d', days: 30 },
  { value: '90', label: '90d', days: 90 },
  { value: 'all', label: 'All', days: 0 },
]

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

function productLabel(p: Pick<ProductRow, 'name' | 'color' | 'size'>) {
  return [p.name || 'Product', p.color || '', p.size || ''].filter(Boolean).join(' · ')
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
        message="This page is for admin and super admin."
        allowed="admin, super_admin"
        nextPath="/admin/store/dashboard"
        actions={[{ href: '/admin/store', label: 'Go to Store Admin' }]}
        showBackHome
      />
    )
  }

  const windowRaw = strParam(searchParams?.window)
  const selectedWindow = WINDOWS.find((item) => item.value === windowRaw) ?? WINDOWS[1]
  const supa = getSupabaseAdminClientCached()

  let summary: DashboardSummaryRow | null = null
  let lowStockProducts: ProductRow[] = []
  let recentSupplierOrders: SupplierOrderRow[] = []
  let recentPreorders: PreorderRow[] = []
  let recentSales: SaleRow[] = []
  let pageError: string | null = null

  try {
    const [summaryRes, lowStockRes, supplierRes, preorderRes, salesRes] = await Promise.all([
      supa.rpc('admin_store_dashboard_summary', { _days: selectedWindow.days } as any),
      supa
        .from('store_products')
        .select('id,name,color,size,inventory_qty,price_cents,currency,low_stock_threshold,is_active,allow_preorder')
        .eq('is_active', true)
        .order('inventory_qty', { ascending: true })
        .limit(100),
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
    ])

    if (summaryRes.error) throw new Error(summaryRes.error.message)
    if (lowStockRes.error) throw new Error(lowStockRes.error.message)
    if (supplierRes.error) throw new Error(supplierRes.error.message)
    if (preorderRes.error) throw new Error(preorderRes.error.message)
    if (salesRes.error) throw new Error(salesRes.error.message)

    summary = Array.isArray(summaryRes.data) ? ((summaryRes.data[0] as DashboardSummaryRow | undefined) ?? null) : null

    const lowStockRaw = Array.isArray(lowStockRes.data) ? (lowStockRes.data as ProductRow[]) : []
    lowStockProducts = lowStockRaw
      .filter((row) => Boolean(row.is_active))
      .filter((row) => toInt(row.inventory_qty) <= toInt(row.low_stock_threshold))
      .slice(0, 8)

    recentSupplierOrders = Array.isArray(supplierRes.data) ? (supplierRes.data as SupplierOrderRow[]) : []
    recentPreorders = Array.isArray(preorderRes.data) ? (preorderRes.data as PreorderRow[]) : []
    recentSales = Array.isArray(salesRes.data) ? (salesRes.data as SaleRow[]) : []
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

  return (
    <main>
      <PageHeader
        title="Store Dashboard"
        subtitle="Current stock, pipeline, supplier flow, preorders, and sales overview."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {WINDOWS.map((item) => {
              const active = item.value === selectedWindow.value
              return (
                <Link
                  key={item.value}
                  href={item.value === '30' ? '/admin/store/dashboard' : `/admin/store/dashboard?window=${item.value}`}
                  prefetch={false}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium ${active ? 'bg-black text-white border-black' : 'hover:bg-gray-50'}`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        }
        showReload
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/dashboard" role={me.role} />
      </Section>

      <Section className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button asChild href="/admin/store" variant="outline" size="sm">
              Catalog & stock
            </Button>
            {canManageStorePreorders(me.role) ? (
              <Button asChild href="/admin/store/preorders" variant="outline" size="sm">
                Preorders
              </Button>
            ) : null}
            {canManageStoreSales(me.role) ? (
              <Button asChild href="/admin/store/sales" variant="outline" size="sm">
                Sales
              </Button>
            ) : null}
            <Button asChild href="/store" variant="ghost" size="sm">
              Open /store
            </Button>
            <div className="ml-auto text-xs text-[hsl(var(--muted))]">Sales window: {selectedWindow.label}</div>
          </CardContent>
        </Card>

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
              title="Sales in window"
              value={String(toInt(metrics.sales_count))}
              hint={`${toInt(metrics.delivered_sales_count)} delivered in ${selectedWindow.label}`}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Sales activity</h2>
            <p className="text-sm text-[hsl(var(--muted))]">This block follows the selected sales window.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              title="Sales total"
              value={formatCurrency(toInt(metrics.sales_total_cents), 'en-EG', 'EGP')}
              hint="Total sale value created in the selected window"
            />
            <StatCard
              title="Collected"
              value={formatCurrency(toInt(metrics.sales_paid_cents), 'en-EG', 'EGP')}
              hint="Paid amount recorded in the selected window"
            />
            <StatCard
              title="Debt in window"
              value={formatCurrency(toInt(metrics.sales_debt_cents), 'en-EG', 'EGP')}
              hint="Remaining debt from sales created in the selected window"
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
        </div>
      </Section>
    </main>
  )
}
