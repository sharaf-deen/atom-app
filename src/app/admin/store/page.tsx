// src/app/admin/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
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

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type ActiveFilter = 'all' | 'active' | 'inactive'
type StockFilter = 'all' | 'in' | 'out' | 'low'
type PreorderFilter = 'all' | '1' | '0'
type Tab = 'dashboard' | 'catalog'

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

type DashboardMetrics = {
  totalProducts: number
  activeProducts: number
  inactiveProducts: number
  preorderEnabledProducts: number
  lowStockProducts: number
  outOfStockProducts: number
  totalUnits: number
  totalStockValueCents: number
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

const loadStoreCatalogRowsCached = unstable_cache(
  async (category: string, active: ActiveFilter, preorder: PreorderFilter, q: string) => {
    const supa = getSupabaseAdminClientCached()

    let query = supa
      .from('store_products')
      .select(
        'id, category, name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, low_stock_threshold, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(1000)

    if (category && category !== 'all') query = query.eq('category', category)
    if (active === 'active') query = query.eq('is_active', true)
    if (active === 'inactive') query = query.eq('is_active', false)
    if (preorder === '1') query = query.eq('allow_preorder', true)
    if (preorder === '0') query = query.eq('allow_preorder', false)

    if (q) {
      if (q.length >= 3) {
        query = query.textSearch('search_tsv', q, { type: 'websearch', config: 'simple' })
      } else {
        const safe = q.replace(/,/g, ' ').trim()
        query = query.or(
          [
            `name.ilike.%${safe}%`,
            `color.ilike.%${safe}%`,
            `size.ilike.%${safe}%`,
            `category.ilike.%${safe}%`,
          ].join(',')
        )
      }
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return (Array.isArray(data) ? data : []) as ProductRow[]
  },
  ['store_admin_catalog_v2'],
  { revalidate: 30, tags: ['admin-store-catalog', 'store-products'] }
)

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

function normalizeTab(v: string): Tab {
  return v === 'catalog' ? 'catalog' : 'dashboard'
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
  const qty = Number(product.inventory_qty ?? 0)
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))
  if (qty <= 0) return true
  return threshold > 0 && qty <= threshold
}

function stockPill(product: Pick<ProductRow, 'inventory_qty' | 'low_stock_threshold'>) {
  const qty = Number(product.inventory_qty ?? 0)
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))

  if (qty <= 0) {
    return <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">Out of stock</span>
  }

  if (threshold > 0 && qty <= threshold) {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Low stock</span>
  }

  return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Healthy stock</span>
}

function computeMetrics(products: ProductRow[]): DashboardMetrics {
  return products.reduce<DashboardMetrics>(
    (acc, product) => {
      const qty = Math.max(0, Number(product.inventory_qty ?? 0))
      const active = Boolean(product.is_active)
      const preorder = Boolean(product.allow_preorder)
      const price = Math.max(0, Number(product.price_cents ?? 0))
      const low = isLowStock(product)

      acc.totalProducts += 1
      if (active) acc.activeProducts += 1
      else acc.inactiveProducts += 1
      if (preorder) acc.preorderEnabledProducts += 1
      if (low) acc.lowStockProducts += 1
      if (qty <= 0) acc.outOfStockProducts += 1
      acc.totalUnits += qty
      acc.totalStockValueCents += qty * price
      return acc
    },
    {
      totalProducts: 0,
      activeProducts: 0,
      inactiveProducts: 0,
      preorderEnabledProducts: 0,
      lowStockProducts: 0,
      outOfStockProducts: 0,
      totalUnits: 0,
      totalStockValueCents: 0,
    }
  )
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

  let allProducts: ProductRow[] = []
  let errorMsg: string | null = null

  try {
    allProducts = await loadStoreCatalogRowsCached(category, active, preorder, q)
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const filteredProducts = !errorMsg
    ? allProducts.filter((product) => {
        const qty = Math.max(0, Number(product.inventory_qty ?? 0))
        if (stock === 'in' && qty <= 0) return false
        if (stock === 'out' && qty > 0) return false
        if (stock === 'low' && !isLowStock(product)) return false
        return true
      })
    : []

  const metrics = computeMetrics(allProducts)
  const totalFiltered = filteredProducts.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const pagedProducts = filteredProducts.slice(start, start + pageSize)
  const hasMore = safePage < totalPages

  const baseParams = {
    tab: 'catalog',
    q,
    category: category === 'all' ? '' : category,
    active: active === 'all' ? '' : active,
    stock: stock === 'all' ? '' : stock,
    preorder: preorder === 'all' ? '' : preorder,
    page_size: String(pageSize),
  }

  return (
    <main>
      <PageHeader
        title="Store Admin"
        subtitle="V2 — catalog and stock foundation"
        right={
          <div className="flex flex-wrap items-center gap-2">
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

      <Section className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Link
              prefetch={false}
              href={buildUrl('/admin/store', { tab: 'dashboard' })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50 ${tab === 'dashboard' ? 'bg-gray-50' : ''}`}
            >
              Dashboard
            </Link>
            <Link
              prefetch={false}
              href={buildUrl('/admin/store', { tab: 'catalog' })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50 ${tab === 'catalog' ? 'bg-gray-50' : ''}`}
            >
              Catalog & Stock
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Total products</div>
              <div className="text-2xl font-semibold">{metrics.totalProducts}</div>
              <div className="text-xs text-[hsl(var(--muted))]">
                {metrics.activeProducts} active · {metrics.inactiveProducts} inactive
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Units in stock</div>
              <div className="text-2xl font-semibold">{metrics.totalUnits}</div>
              <div className="text-xs text-[hsl(var(--muted))]">
                {metrics.outOfStockProducts} out of stock
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Low stock products</div>
              <div className="text-2xl font-semibold">{metrics.lowStockProducts}</div>
              <div className="text-xs text-[hsl(var(--muted))]">Threshold-based inventory watch</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <div className="text-xs text-[hsl(var(--muted))]">Stock value</div>
              <div className="text-2xl font-semibold">
                {formatCurrency(metrics.totalStockValueCents, 'en-EG', 'EGP')}
              </div>
              <div className="text-xs text-[hsl(var(--muted))]">
                {metrics.preorderEnabledProducts} preorder-enabled products
              </div>
            </CardContent>
          </Card>
        </div>

        {tab === 'dashboard' ? (
          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Admin scope in this lot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-700">
                <p>
                  This lot focuses only on the Store V2 admin catalog and stock foundation. It keeps the scope narrow to protect
                  stability and avoid broad regressions.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border bg-gray-50 p-4">
                    <div className="font-medium">Included now</div>
                    <ul className="mt-2 space-y-1 text-sm text-gray-600">
                      <li>• catalog search and filters</li>
                      <li>• stock and low-stock visibility</li>
                      <li>• product active/inactive state</li>
                      <li>• preorder eligibility per product</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border bg-gray-50 p-4">
                    <div className="font-medium">Next store lots</div>
                    <ul className="mt-2 space-y-1 text-sm text-gray-600">
                      <li>• supplier orders</li>
                      <li>• customer preorders</li>
                      <li>• sales and debt tracking</li>
                      <li>• store business dashboard expansion</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Inventory watch</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <span className="text-[hsl(var(--muted))]">Low stock products</span>
                  <span className="font-semibold">{metrics.lowStockProducts}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <span className="text-[hsl(var(--muted))]">Out of stock</span>
                  <span className="font-semibold">{metrics.outOfStockProducts}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <span className="text-[hsl(var(--muted))]">Preorder enabled</span>
                  <span className="font-semibold">{metrics.preorderEnabledProducts}</span>
                </div>
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...baseParams, tab: 'catalog', stock: 'low', page: '1' })}
                  className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Review low stock products
                </Link>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <Card>
              <CardContent>
                <form action="/admin/store" method="get" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tab" value="catalog" />

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Search</label>
                    <input
                      name="q"
                      defaultValue={q}
                      className="rounded-xl border px-3 py-2 text-sm bg-white"
                      placeholder="Model, color, size…"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Category</label>
                    <select name="category" defaultValue={category} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {CATEGORIES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Status</label>
                    <select name="active" defaultValue={active} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {ACTIVE_FILTERS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Stock</label>
                    <select name="stock" defaultValue={stock} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {STOCK_FILTERS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Preorder</label>
                    <select name="preorder" defaultValue={preorder} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {PREORDER_FILTERS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Page size</label>
                    <select name="page_size" defaultValue={String(pageSize)} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {[12, 24, 36, 60].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50" type="submit">
                    Apply
                  </button>

                  <Link prefetch={false} href="/admin/store?tab=catalog" className="text-sm underline text-gray-700 hover:text-black">
                    Clear
                  </Link>

                  <div className="ml-auto text-xs text-[hsl(var(--muted))]">
                    {errorMsg ? 'Failed to load catalog.' : `Showing ${totalFiltered === 0 ? 0 : start + 1}–${start + pagedProducts.length} of ${totalFiltered}`}
                  </div>
                </form>
              </CardContent>
            </Card>

            {errorMsg ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-red-600">Failed to load store catalog: {errorMsg}</div>
                </CardContent>
              </Card>
            ) : pagedProducts.length === 0 ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-[hsl(var(--muted))]">No products match your filters.</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {pagedProducts.map((product) => {
                  const price = formatCurrency(product.price_cents ?? 0, 'en-EG', product.currency ?? 'EGP')
                  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
                  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))

                  return (
                    <Card key={product.id}>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="flex-1 min-w-[220px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-lg font-semibold">{product.name}</div>
                              {stockPill(product)}
                              {!product.is_active ? (
                                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">Inactive</span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                              Product ID: <span className="font-mono">{shortId(product.id)}</span> · {product.category}
                              {product.color ? ` · ${product.color}` : ''}
                              {product.size ? ` · ${product.size}` : ''}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-lg font-semibold">{price}</div>
                            <div className="text-xs text-[hsl(var(--muted))]">Created {formatDateTime(product.created_at)}</div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border p-3">
                            <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Stock</div>
                            <div className="mt-1 text-lg font-semibold">{qty}</div>
                          </div>
                          <div className="rounded-xl border p-3">
                            <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Low stock threshold</div>
                            <div className="mt-1 text-lg font-semibold">{threshold}</div>
                          </div>
                          <div className="rounded-xl border p-3">
                            <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Preorder</div>
                            <div className="mt-1 text-lg font-semibold">{product.allow_preorder ? 'Enabled' : 'Disabled'}</div>
                          </div>
                        </div>

                        <AdminProductQuickEdit
                          id={product.id}
                          inventoryQty={qty}
                          isActive={Boolean(product.is_active)}
                          allowPreorder={Boolean(product.allow_preorder)}
                          lowStockThreshold={threshold}
                        />
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            {!errorMsg && (safePage > 1 || hasMore) ? (
              <div className="flex items-center gap-2">
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...baseParams, page: String(Math.max(1, safePage - 1)) })}
                  aria-disabled={safePage <= 1}
                  className={`rounded-xl border px-3 py-2 text-sm ${safePage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}
                >
                  Prev
                </Link>
                <div className="text-sm">
                  Page <b>{safePage}</b> / <b>{totalPages}</b>
                </div>
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...baseParams, page: String(safePage + 1) })}
                  aria-disabled={!hasMore}
                  className={`rounded-xl border px-3 py-2 text-sm ${!hasMore ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}
                >
                  Next
                </Link>
              </div>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Add product to catalog</CardTitle>
              </CardHeader>
              <CardContent>
                <StoreProductForm />
              </CardContent>
            </Card>
          </>
        )}
      </Section>
    </main>
  )
}
