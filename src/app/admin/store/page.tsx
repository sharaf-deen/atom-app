export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreAdmin } from '@/lib/rbac'
import AdminProductQuickEdit from '@/components/store/AdminProductQuickEdit'

const StoreProductForm = dynamicImport(() => import('@/components/StoreProductForm'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading catalog form…</div>,
})

const SupplierOrderForm = dynamicImport(() => import('@/components/store/SupplierOrderForm'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading supplier-order form…</div>,
})

const SupplierOrderHeaderEditor = dynamicImport(() => import('@/components/store/SupplierOrderHeaderEditor'), {
  ssr: false,
  loading: () => <div className="text-xs text-gray-500">Loading supplier-order editor…</div>,
})

const SupplierOrderReceiveLine = dynamicImport(() => import('@/components/store/SupplierOrderReceiveLine'), {
  ssr: false,
  loading: () => <div className="text-xs text-gray-500">Loading receive controls…</div>,
})

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type ActiveFilter = 'all' | 'active' | 'inactive'
type StockFilter = 'all' | 'in' | 'out' | 'low'
type PreorderFilter = 'all' | '1' | '0'
type SupplierStatusFilter = 'all' | 'draft' | 'ordered' | 'partially_received' | 'received' | 'canceled'
type Tab = 'dashboard' | 'catalog' | 'supplier-orders'

type ProductRow = {
  id: string
  category: Category
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
  allow_preorder: boolean
  low_stock_threshold: number
  created_at: string | null
}

type SupplierOrderItemRow = {
  id: string
  supplier_order_id: string
  product_id: string | null
  product_name: string
  product_category: Category | null
  product_color: string | null
  product_size: string | null
  unit_cost_cents: number
  ordered_qty: number
  received_qty: number
  line_total_cents: number
  line_status: 'ordered' | 'partially_received' | 'received' | 'canceled'
  created_at: string
  updated_at: string
}

type SupplierOrderRow = {
  id: string
  reference: string | null
  supplier_name: string | null
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'canceled'
  notes: string | null
  ordered_at: string | null
  expected_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  items?: SupplierOrderItemRow[] | null
}

type DashboardMetrics = {
  totalProducts: number
  activeProducts: number
  preorderEnabledProducts: number
  lowStockProducts: number
  outOfStockProducts: number
  totalUnits: number
  totalStockValueCents: number
  supplierOpenOrders: number
  supplierPartialOrders: number
  supplierReceivedOrders: number
  supplierPendingUnits: number
  supplierReceivedUnits: number
  supplierOrderedValueCents: number
}

const CATEGORIES: Array<{ value: 'all' | Category; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'kimono', label: 'Kimono' },
  { value: 'rashguard', label: 'Rashguard' },
  { value: 'short', label: 'Short' },
  { value: 'belt', label: 'Belt' },
]

const ACTIVE_FILTERS: Array<{ value: ActiveFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const STOCK_FILTERS: Array<{ value: StockFilter; label: string }> = [
  { value: 'all', label: 'All stock' },
  { value: 'in', label: 'In stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'low', label: 'Low stock' },
]

const PREORDER_FILTERS: Array<{ value: PreorderFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Preorder enabled' },
  { value: '0', label: 'Preorder disabled' },
]

const SUPPLIER_STATUS_FILTERS: Array<{ value: SupplierStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'partially_received', label: 'Partially received' },
  { value: 'received', label: 'Received' },
  { value: 'canceled', label: 'Canceled' },
]

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

function normalizeTab(v: string): Tab {
  return v === 'catalog' || v === 'supplier-orders' ? v : 'dashboard'
}

function normalizeCategory(v: string): 'all' | Category {
  return v === 'kimono' || v === 'rashguard' || v === 'short' || v === 'belt' ? v : 'all'
}

function normalizeActive(v: string): ActiveFilter {
  return v === 'active' || v === 'inactive' ? v : 'all'
}

function normalizeStock(v: string): StockFilter {
  return v === 'in' || v === 'out' || v === 'low' ? v : 'all'
}

function normalizePreorder(v: string): PreorderFilter {
  return v === '1' || v === '0' ? v : 'all'
}

function normalizeSupplierStatus(v: string): SupplierStatusFilter {
  return v === 'draft' || v === 'ordered' || v === 'partially_received' || v === 'received' || v === 'canceled' ? v : 'all'
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

function isLowStock(product: Pick<ProductRow, 'inventory_qty' | 'low_stock_threshold'>) {
  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))
  if (qty <= 0) return true
  return threshold > 0 && qty <= threshold
}

function stockPill(product: Pick<ProductRow, 'inventory_qty' | 'low_stock_threshold'>) {
  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))

  if (qty <= 0) {
    return <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">Out of stock</span>
  }
  if (threshold > 0 && qty <= threshold) {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Low stock</span>
  }
  return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Healthy stock</span>
}

function supplierStatusPill(status: SupplierOrderRow['status']) {
  switch (status) {
    case 'draft':
      return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">Draft</span>
    case 'ordered':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Ordered</span>
    case 'partially_received':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Partially received</span>
    case 'received':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Received</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">Canceled</span>
  }
}

function supplierLinePill(status: SupplierOrderItemRow['line_status']) {
  switch (status) {
    case 'ordered':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">Ordered</span>
    case 'partially_received':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Partial</span>
    case 'received':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Received</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">Canceled</span>
  }
}

function computeMetrics(products: ProductRow[], supplierOrders: SupplierOrderRow[]): DashboardMetrics {
  const productMetrics = products.reduce(
    (acc, product) => {
      const qty = Math.max(0, Number(product.inventory_qty ?? 0))
      const price = Math.max(0, Number(product.price_cents ?? 0))
      acc.totalProducts += 1
      if (product.is_active) acc.activeProducts += 1
      if (product.allow_preorder) acc.preorderEnabledProducts += 1
      if (isLowStock(product)) acc.lowStockProducts += 1
      if (qty <= 0) acc.outOfStockProducts += 1
      acc.totalUnits += qty
      acc.totalStockValueCents += qty * price
      return acc
    },
    {
      totalProducts: 0,
      activeProducts: 0,
      preorderEnabledProducts: 0,
      lowStockProducts: 0,
      outOfStockProducts: 0,
      totalUnits: 0,
      totalStockValueCents: 0,
      supplierOpenOrders: 0,
      supplierPartialOrders: 0,
      supplierReceivedOrders: 0,
      supplierPendingUnits: 0,
      supplierReceivedUnits: 0,
      supplierOrderedValueCents: 0,
    } as DashboardMetrics
  )

  for (const order of supplierOrders) {
    if (order.status === 'draft' || order.status === 'ordered') productMetrics.supplierOpenOrders += 1
    if (order.status === 'partially_received') productMetrics.supplierPartialOrders += 1
    if (order.status === 'received') productMetrics.supplierReceivedOrders += 1
    for (const item of order.items ?? []) {
      const orderedQty = Math.max(0, Number(item.ordered_qty ?? 0))
      const receivedQty = Math.max(0, Number(item.received_qty ?? 0))
      productMetrics.supplierPendingUnits += Math.max(0, orderedQty - receivedQty)
      productMetrics.supplierReceivedUnits += receivedQty
      productMetrics.supplierOrderedValueCents += Math.max(0, Number(item.line_total_cents ?? 0))
    }
  }

  return productMetrics
}

export default async function AdminStorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store')

  if (!canAccessStoreAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const tab = normalizeTab(strParam(searchParams?.tab))
  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 12, 6, 60)
  const q = strParam(searchParams?.q).trim()
  const category = normalizeCategory(strParam(searchParams?.category))
  const active = normalizeActive(strParam(searchParams?.active))
  const stock = normalizeStock(strParam(searchParams?.stock))
  const preorder = normalizePreorder(strParam(searchParams?.preorder))

  const supplierPage = clampInt(searchParams?.s_page, 1, 1, 9999)
  const supplierPageSize = clampInt(searchParams?.s_page_size, 10, 5, 30)
  const supplierQ = strParam(searchParams?.s_q).trim()
  const supplierStatus = normalizeSupplierStatus(strParam(searchParams?.s_status))

  const supa = getSupabaseAdminClientCached()

  let productsError: string | null = null
  let supplierError: string | null = null
  let allProducts: ProductRow[] = []
  let supplierOrders: SupplierOrderRow[] = []

  try {
    let productQuery = supa
      .from('store_products')
      .select('id, category, name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, low_stock_threshold, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (category !== 'all') productQuery = productQuery.eq('category', category)
    if (active === 'active') productQuery = productQuery.eq('is_active', true)
    if (active === 'inactive') productQuery = productQuery.eq('is_active', false)
    if (preorder === '1') productQuery = productQuery.eq('allow_preorder', true)
    if (preorder === '0') productQuery = productQuery.eq('allow_preorder', false)
    if (q) {
      const safe = q.replace(/,/g, ' ').trim()
      productQuery = productQuery.or(`name.ilike.%${safe}%,color.ilike.%${safe}%,size.ilike.%${safe}%,category.ilike.%${safe}%`)
    }

    const { data, error } = await productQuery
    if (error) throw new Error(error.message)
    allProducts = (Array.isArray(data) ? data : []) as ProductRow[]
  } catch (error: any) {
    productsError = error?.message || String(error)
  }

  try {
    let supplierQuery = supa
      .from('store_supplier_orders')
      .select(
        'id, reference, supplier_name, status, notes, ordered_at, expected_at, received_at, created_at, updated_at, created_by, updated_by, items:store_supplier_order_items(id, supplier_order_id, product_id, product_name, product_category, product_color, product_size, unit_cost_cents, ordered_qty, received_qty, line_total_cents, line_status, created_at, updated_at)'
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (supplierStatus !== 'all') supplierQuery = supplierQuery.eq('status', supplierStatus)
    if (supplierQ) {
      const safe = supplierQ.replace(/,/g, ' ').trim()
      supplierQuery = supplierQuery.or(`reference.ilike.%${safe}%,supplier_name.ilike.%${safe}%`)
    }

    const { data, error } = await supplierQuery
    if (error) throw new Error(error.message)
    supplierOrders = (Array.isArray(data) ? data : []) as SupplierOrderRow[]
  } catch (error: any) {
    supplierError = error?.message || String(error)
  }

  const filteredProducts = !productsError
    ? allProducts.filter((product) => {
        const qty = Math.max(0, Number(product.inventory_qty ?? 0))
        if (stock === 'in' && qty <= 0) return false
        if (stock === 'out' && qty > 0) return false
        if (stock === 'low' && !isLowStock(product)) return false
        return true
      })
    : []

  const metrics = computeMetrics(allProducts, supplierOrders)
  const totalFilteredProducts = filteredProducts.length
  const totalProductPages = Math.max(1, Math.ceil(totalFilteredProducts / pageSize))
  const safeProductPage = Math.min(page, totalProductPages)
  const productStart = (safeProductPage - 1) * pageSize
  const pagedProducts = filteredProducts.slice(productStart, productStart + pageSize)
  const hasMoreProducts = safeProductPage < totalProductPages

  const totalSupplierOrders = supplierOrders.length
  const totalSupplierPages = Math.max(1, Math.ceil(totalSupplierOrders / supplierPageSize))
  const safeSupplierPage = Math.min(supplierPage, totalSupplierPages)
  const supplierStart = (safeSupplierPage - 1) * supplierPageSize
  const pagedSupplierOrders = supplierOrders.slice(supplierStart, supplierStart + supplierPageSize)
  const hasMoreSupplierOrders = safeSupplierPage < totalSupplierPages

  const catalogBaseParams = {
    tab: 'catalog',
    q,
    category: category === 'all' ? '' : category,
    active: active === 'all' ? '' : active,
    stock: stock === 'all' ? '' : stock,
    preorder: preorder === 'all' ? '' : preorder,
    page_size: String(pageSize),
  }

  const supplierBaseParams = {
    tab: 'supplier-orders',
    s_q: supplierQ,
    s_status: supplierStatus === 'all' ? '' : supplierStatus,
    s_page_size: String(supplierPageSize),
  }

  return (
    <main>
      <PageHeader
        title="Store Admin"
        subtitle="V2 — catalog, stock, and supplier orders"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              prefetch={false}
              href="/admin/store/preorders"
              className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open preorders
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

      <Section>
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href="/admin/store?tab=dashboard" className={`rounded-xl border px-4 py-2 text-sm font-medium ${tab === 'dashboard' ? 'bg-black text-white border-black' : 'hover:bg-gray-50'}`}>
            Dashboard
          </Link>
          <Link href="/admin/store?tab=catalog" className={`rounded-xl border px-4 py-2 text-sm font-medium ${tab === 'catalog' ? 'bg-black text-white border-black' : 'hover:bg-gray-50'}`}>
            Catalog & Stock
          </Link>
          <Link href="/admin/store?tab=supplier-orders" className={`rounded-xl border px-4 py-2 text-sm font-medium ${tab === 'supplier-orders' ? 'bg-black text-white border-black' : 'hover:bg-gray-50'}`}>
            Supplier Orders
          </Link>
        </div>

        {tab === 'dashboard' && (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            <Card>
              <CardHeader><CardTitle>Catalog</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Total products</span><span className="font-semibold">{metrics.totalProducts}</span></div>
                <div className="flex items-center justify-between"><span>Active products</span><span className="font-semibold">{metrics.activeProducts}</span></div>
                <div className="flex items-center justify-between"><span>Preorder enabled</span><span className="font-semibold">{metrics.preorderEnabledProducts}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Stock</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Total units</span><span className="font-semibold">{metrics.totalUnits}</span></div>
                <div className="flex items-center justify-between"><span>Low stock</span><span className="font-semibold">{metrics.lowStockProducts}</span></div>
                <div className="flex items-center justify-between"><span>Out of stock</span><span className="font-semibold">{metrics.outOfStockProducts}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Supplier Orders</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Open</span><span className="font-semibold">{metrics.supplierOpenOrders}</span></div>
                <div className="flex items-center justify-between"><span>Partial</span><span className="font-semibold">{metrics.supplierPartialOrders}</span></div>
                <div className="flex items-center justify-between"><span>Received</span><span className="font-semibold">{metrics.supplierReceivedOrders}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Supplier Flow</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Pending units</span><span className="font-semibold">{metrics.supplierPendingUnits}</span></div>
                <div className="flex items-center justify-between"><span>Received units</span><span className="font-semibold">{metrics.supplierReceivedUnits}</span></div>
                <div className="flex items-center justify-between"><span>Ordered value</span><span className="font-semibold">{formatCurrency(metrics.supplierOrderedValueCents)}</span></div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 2xl:col-span-4">
              <CardHeader><CardTitle>Business snapshot</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Stock value</div>
                  <div className="mt-2 text-lg font-semibold">{formatCurrency(metrics.totalStockValueCents)}</div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Catalog health</div>
                  <div className="mt-2 text-lg font-semibold">{metrics.totalProducts === 0 ? 'No products yet' : `${metrics.activeProducts}/${metrics.totalProducts} active`}</div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Supplier pressure</div>
                  <div className="mt-2 text-lg font-semibold">{metrics.supplierPendingUnits} units pending</div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Receiving progress</div>
                  <div className="mt-2 text-lg font-semibold">{metrics.supplierReceivedUnits} units received</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'catalog' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <Card>
              <CardHeader><CardTitle>Create catalog product</CardTitle></CardHeader>
              <CardContent>
                <StoreProductForm />
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader><CardTitle>Catalog filters</CardTitle></CardHeader>
                <CardContent>
                  <form className="grid gap-3 lg:grid-cols-6">
                    <input type="hidden" name="tab" value="catalog" />
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Search</span>
                      <input name="q" defaultValue={q} placeholder="Model, color, size…" className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Category</span>
                      <select name="category" defaultValue={category} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Active</span>
                      <select name="active" defaultValue={active} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {ACTIVE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Stock</span>
                      <select name="stock" defaultValue={stock} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {STOCK_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Preorder</span>
                      <select name="preorder" defaultValue={preorder} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {PREORDER_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <div className="flex items-end gap-2">
                      <button className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button>
                      <Link href="/admin/store?tab=catalog" className="inline-flex min-h-[42px] items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">Reset</Link>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {productsError ? (
                <Card>
                  <CardContent className="text-sm text-red-700">Catalog query failed: {productsError}</CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Catalog & stock</CardTitle>
                    <div className="text-xs text-[hsl(var(--muted))]">{totalFilteredProducts} product(s)</div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {pagedProducts.length === 0 ? (
                      <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No products match the current filters.</div>
                    ) : (
                      pagedProducts.map((product) => (
                        <div key={product.id} className="rounded-2xl border bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">{product.name}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                <span className="rounded-full border px-2 py-1">ID: {shortId(product.id)}</span>
                                <span className="rounded-full border px-2 py-1">{product.category}</span>
                                {product.size ? <span className="rounded-full border px-2 py-1">Size: {product.size}</span> : null}
                                {product.color ? <span className="rounded-full border px-2 py-1">Color: {product.color}</span> : null}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {stockPill(product)}
                              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${product.allow_preorder ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                {product.allow_preorder ? 'Preorder enabled' : 'Preorder disabled'}
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                            <div><span className="text-[hsl(var(--muted))]">Price:</span> <span className="font-medium">{formatCurrency(product.price_cents, 'en-EG', product.currency ?? 'EGP')}</span></div>
                            <div><span className="text-[hsl(var(--muted))]">Stock:</span> <span className="font-medium">{product.inventory_qty}</span></div>
                            <div><span className="text-[hsl(var(--muted))]">Threshold:</span> <span className="font-medium">{product.low_stock_threshold}</span></div>
                            <div><span className="text-[hsl(var(--muted))]">Created:</span> <span className="font-medium">{formatDateTime(product.created_at)}</span></div>
                          </div>

                          <div className="mt-4">
                            <AdminProductQuickEdit
                              id={product.id}
                              inventoryQty={product.inventory_qty}
                              isActive={product.is_active}
                              allowPreorder={product.allow_preorder}
                              lowStockThreshold={product.low_stock_threshold}
                            />
                          </div>
                        </div>
                      ))
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
                      <div>Page {safeProductPage} / {totalProductPages}</div>
                      <div className="flex gap-2">
                        <Link href={buildUrl('/admin/store', { ...catalogBaseParams, page: String(Math.max(1, safeProductPage - 1)) })} className={`rounded-xl border px-4 py-2 ${safeProductPage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Previous</Link>
                        <Link href={buildUrl('/admin/store', { ...catalogBaseParams, page: String(safeProductPage + 1) })} className={`rounded-xl border px-4 py-2 ${!hasMoreProducts ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Next</Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {tab === 'supplier-orders' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
            <Card>
              <CardHeader><CardTitle>Create supplier order</CardTitle></CardHeader>
              <CardContent>
                <SupplierOrderForm
                  products={allProducts.map((product) => ({
                    id: product.id,
                    name: product.name,
                    category: product.category,
                    color: product.color,
                    size: product.size,
                    price_cents: product.price_cents,
                    currency: product.currency,
                    is_active: product.is_active,
                  }))}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader><CardTitle>Supplier-order filters</CardTitle></CardHeader>
                <CardContent>
                  <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                    <input type="hidden" name="tab" value="supplier-orders" />
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Search</span>
                      <input name="s_q" defaultValue={supplierQ} placeholder="Reference or supplier…" className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Status</span>
                      <select name="s_status" defaultValue={supplierStatus} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {SUPPLIER_STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <div className="flex items-end gap-2">
                      <button className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button>
                      <Link href="/admin/store?tab=supplier-orders" className="inline-flex min-h-[42px] items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">Reset</Link>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {supplierError ? (
                <Card>
                  <CardContent className="text-sm text-red-700">Supplier orders query failed: {supplierError}</CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Supplier orders</CardTitle>
                    <div className="text-xs text-[hsl(var(--muted))]">{totalSupplierOrders} order(s)</div>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    {pagedSupplierOrders.length === 0 ? (
                      <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No supplier orders match the current filters.</div>
                    ) : (
                      pagedSupplierOrders.map((order) => {
                        const totalOrderedQty = (order.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.ordered_qty ?? 0)), 0)
                        const totalReceivedQty = (order.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.received_qty ?? 0)), 0)
                        const totalCostCents = (order.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.line_total_cents ?? 0)), 0)

                        return (
                          <div key={order.id} className="rounded-2xl border bg-[hsl(var(--card))] p-4">
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">{order.supplier_name || 'Supplier'}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                  <span className="rounded-full border px-2 py-1">Order ID: {shortId(order.id)}</span>
                                  {order.reference ? <span className="rounded-full border px-2 py-1">Ref: {order.reference}</span> : null}
                                  <span className="rounded-full border px-2 py-1">Ordered qty: {totalOrderedQty}</span>
                                  <span className="rounded-full border px-2 py-1">Received qty: {totalReceivedQty}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">{supplierStatusPill(order.status)}</div>
                            </div>

                            <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                              <div><span className="text-[hsl(var(--muted))]">Expected:</span> <span className="font-medium">{order.expected_at || '—'}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Ordered at:</span> <span className="font-medium">{formatDateTime(order.ordered_at)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Received at:</span> <span className="font-medium">{formatDateTime(order.received_at)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Estimated cost:</span> <span className="font-medium">{formatCurrency(totalCostCents)}</span></div>
                            </div>

                            <div className="mt-4">
                              <SupplierOrderHeaderEditor
                                id={order.id}
                                reference={order.reference}
                                supplierName={order.supplier_name}
                                expectedAt={order.expected_at}
                                notes={order.notes}
                                status={order.status}
                              />
                            </div>

                            <div className="mt-4 grid gap-3">
                              {(order.items ?? []).length === 0 ? (
                                <div className="rounded-2xl border border-dashed p-3 text-sm text-[hsl(var(--muted))]">No lines on this supplier order.</div>
                              ) : (
                                (order.items ?? []).map((item) => {
                                  const remainingQty = Math.max(0, Number(item.ordered_qty ?? 0) - Number(item.received_qty ?? 0))
                                  return (
                                    <div key={item.id} className="rounded-2xl border bg-white p-3">
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                          <div className="text-sm font-medium">{item.product_name}</div>
                                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                            {item.product_id ? <span className="rounded-full border px-2 py-1">Product ID: {shortId(item.product_id)}</span> : null}
                                            {item.product_size ? <span className="rounded-full border px-2 py-1">Size: {item.product_size}</span> : null}
                                            {item.product_color ? <span className="rounded-full border px-2 py-1">Color: {item.product_color}</span> : null}
                                            {item.product_category ? <span className="rounded-full border px-2 py-1">{item.product_category}</span> : null}
                                          </div>
                                        </div>
                                        <div>{supplierLinePill(item.line_status)}</div>
                                      </div>

                                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-5">
                                        <div><span className="text-[hsl(var(--muted))]">Unit cost:</span> <span className="font-medium">{formatCurrency(item.unit_cost_cents)}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Ordered:</span> <span className="font-medium">{item.ordered_qty}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Received:</span> <span className="font-medium">{item.received_qty}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Remaining:</span> <span className="font-medium">{remainingQty}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Line total:</span> <span className="font-medium">{formatCurrency(item.line_total_cents)}</span></div>
                                      </div>

                                      <div className="mt-4">
                                        <SupplierOrderReceiveLine
                                          itemId={item.id}
                                          orderedQty={item.ordered_qty}
                                          receivedQty={item.received_qty}
                                          lineStatus={item.line_status}
                                        />
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
                      <div>Page {safeSupplierPage} / {totalSupplierPages}</div>
                      <div className="flex gap-2">
                        <Link href={buildUrl('/admin/store', { ...supplierBaseParams, s_page: String(Math.max(1, safeSupplierPage - 1)) })} className={`rounded-xl border px-4 py-2 ${safeSupplierPage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Previous</Link>
                        <Link href={buildUrl('/admin/store', { ...supplierBaseParams, s_page: String(safeSupplierPage + 1) })} className={`rounded-xl border px-4 py-2 ${!hasMoreSupplierOrders ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Next</Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </Section>
    </main>
  )
}
