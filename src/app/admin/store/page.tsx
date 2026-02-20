// src/app/admin/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import type { OrderStatus } from '@/lib/order'
import { humanStatus } from '@/lib/order'
import AdminProductQuickEdit from '@/components/store/AdminProductQuickEdit'

const StoreProductForm = dynamicImport(() => import('@/components/StoreProductForm'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading product form…</div>,
})

const AdminOrderStatusEditor = dynamicImport(() => import('@/components/store/AdminOrderStatusEditor'), {
  ssr: false,
  loading: () => <div className="text-xs text-gray-500">Loading status editor…</div>,
})

const adminListStoreOrdersCached = unstable_cache(
  async (params: {
    _q: string
    _status: string
    _from_date: string | null
    _to_date: string | null
    _page: number
    _page_size: number
  }) => {
    const supa = createSupabaseAdminClient()
    const { data, error } = await supa.rpc('admin_list_store_orders', params as any)
    if (error) throw new Error(error.message)
    return (data ?? []) as any[]
  },
  ['admin_list_store_orders_v2'],
  { revalidate: 20, tags: ['admin-store-orders', 'orders'] }
)

const adminSearchStoreProductsCached = unstable_cache(
  async (params: { _q: string; _category: string | null; _active: string; _page: number; _page_size: number }) => {
    const supa = createSupabaseAdminClient()
    const { data, error } = await supa.rpc('admin_search_store_products', params as any)
    if (error) throw new Error(error.message)
    return (data ?? []) as any[]
  },
  ['admin_search_store_products_v1'],
  { revalidate: 120, tags: ['admin-store-products', 'store-products'] }
)
type OrderItemLite = {
  id: string
  product_id: string
  name: string
  qty: number
  unit_price_cents: number
  currency: string
}

type AdminOrderRow = {
  id: string
  status: OrderStatus
  total_cents: number
  discount_pct: number
  payment: string
  note: string | null
  created_at: string
  buyer_user_id: string | null
  buyer_member_id: string | null
  buyer_email: string | null
  buyer_first_name: string | null
  buyer_last_name: string | null
  items: OrderItemLite[] | any
  total_count: number
}

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
const PRODUCT_CATS: Array<{ v: 'all' | Category; label: string }> = [
  { v: 'all', label: 'All' },
  { v: 'kimono', label: 'Kimono' },
  { v: 'rashguard', label: 'Rashguard' },
  { v: 'short', label: 'Short' },
  { v: 'belt', label: 'Belt' },
]
const PRODUCT_ACTIVE = ['all', 'active', 'inactive'] as const

const ORDER_STATUSES = ['all', 'pending', 'confirmed', 'ready', 'delivered', 'canceled'] as const
const TABS = ['orders', 'products'] as const

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
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}
function shortId(id: string) {
  return (id || '').slice(0, 8)
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
function displayName(o: AdminOrderRow) {
  const n = `${o.buyer_first_name ?? ''} ${o.buyer_last_name ?? ''}`.trim()
  return n || o.buyer_email || '—'
}
function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

export default async function AdminStorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/store')

  if (me.role !== 'super_admin') {
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

  const tabRaw = strParam(searchParams?.tab)
  const tab = (TABS as readonly string[]).includes(tabRaw) ? (tabRaw as (typeof TABS)[number]) : 'orders'

  const supa = createSupabaseAdminClient()

  // ----- Orders tab params -----
  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 20, 10, 200)
  const statusRaw = strParam(searchParams?.status)
  const status = (ORDER_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : 'all'
  const q = strParam(searchParams?.q).trim()
  const from = strParam(searchParams?.from).trim() // YYYY-MM-DD
  const to = strParam(searchParams?.to).trim() // YYYY-MM-DD

  // ----- Products tab params -----
  const pPage = clampInt(searchParams?.p_page, 1, 1, 9999)
  const pPageSize = clampInt(searchParams?.p_page_size, 12, 6, 100)
  const pQ = strParam(searchParams?.p_q).trim()
  const pCatRaw = strParam(searchParams?.p_category)
  const pCategory = (['all', 'kimono', 'rashguard', 'short', 'belt'] as const).includes(pCatRaw as any) ? (pCatRaw as any) : 'all'
  const pActiveRaw = strParam(searchParams?.p_active)
  const pActive = (PRODUCT_ACTIVE as readonly string[]).includes(pActiveRaw) ? pActiveRaw : 'all'

  // ----- Data -----
  let orders: AdminOrderRow[] = []
  let ordersError: string | null = null
  let ordersTotal = 0
  let ordersTotalPages = 1

  if (tab === 'orders') {
    try {
      const data = await adminListStoreOrdersCached({
        _q: q,
        _status: status,
        _from_date: from || null,
        _to_date: to || null,
        _page: page,
        _page_size: pageSize,
      })

      orders = Array.isArray(data) ? (data as any) : []
      ordersTotal = Number((orders[0] as any)?.total_count ?? 0)
      ordersTotalPages = Math.max(1, Math.ceil(ordersTotal / pageSize))
    } catch (e: any) {
      ordersError = e?.message || String(e)
    }
  }

  type ProductRow = {
    id: string
    category: any
    name: string
    color: string | null
    size: string | null
    price_cents: number
    currency: string | null
    inventory_qty: number
    is_active: boolean
    created_at: string
  }

  let products: ProductRow[] = []
  let productsError: string | null = null
  let productsTotal = 0
  let productsTotalPages = 1

  
if (tab === 'products') {
    try {
      const data = await adminSearchStoreProductsCached({
        _q: pQ,
        _category: pCategory,
        _active: pActive,
        _page: pPage,
        _page_size: pPageSize,
      })

      products = Array.isArray(data) ? (data as any) : []
      productsTotal = Number((products[0] as any)?.total_count ?? 0)
      productsTotalPages = Math.max(1, Math.ceil(productsTotal / pPageSize))
    } catch (e: any) {
      productsError = e?.message || String(e)
    }
  }



  const ordersBaseParams = {
    tab: 'orders',
    q,
    status,
    from,
    to,
    page_size: String(pageSize),
  }

  const productsBaseParams = {
    tab: 'products',
    p_q: pQ,
    p_category: pCategory,
    p_active: pActive,
    p_page_size: String(pPageSize),
  }

  return (
    <main>
      <PageHeader title="Store Admin" subtitle="Server-first (fast) admin + RPC orders list" />

      <Section className="space-y-6">
        {/* Tabs */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Link
              prefetch={false}
              href={buildUrl('/admin/store', { tab: 'orders' })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50 ${tab === 'orders' ? 'bg-gray-50' : ''}`}
            >
              Orders
            </Link>
            <Link
              prefetch={false}
              href={buildUrl('/admin/store', { tab: 'products' })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50 ${tab === 'products' ? 'bg-gray-50' : ''}`}
            >
              Products
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <Link
                prefetch={false}
                href="/store"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open /store
              </Link>
            </div>
          </CardContent>
        </Card>

        {tab === 'orders' ? (
          <section className="space-y-4">
            <Card>
              <CardContent>
                <form action="/admin/store" method="get" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tab" value="orders" />

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Search</label>
                    <input
                      name="q"
                      defaultValue={q}
                      className="rounded-xl border px-3 py-2 text-sm bg-white"
                      placeholder="Buyer / Order / Product (name/email/member code/UUID)"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Status</label>
                    <select name="status" defaultValue={status} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s === 'all' ? 'all' : humanStatus(s as any)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">From</label>
                    <input name="from" type="date" defaultValue={from} className="rounded-xl border px-3 py-2 text-sm bg-white" />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">To</label>
                    <input name="to" type="date" defaultValue={to} className="rounded-xl border px-3 py-2 text-sm bg-white" />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Page size</label>
                    <select name="page_size" defaultValue={String(pageSize)} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {[10, 20, 50, 100, 200].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button className="rounded-xl px-4 py-2 text-sm font-medium border hover:bg-gray-50" type="submit">
                    Apply
                  </button>

                  <Link prefetch={false} href={buildUrl('/admin/store', { tab: 'orders' })} className="text-sm underline text-gray-700 hover:text-black">
                    Clear
                  </Link>

                  <div className="ml-auto text-xs text-[hsl(var(--muted))]">
                    {ordersTotal > 0 ? (
                      <>
                        Page <b>{page}</b> / {ordersTotalPages} · Total <b>{ordersTotal}</b>
                      </>
                    ) : (
                      <>No orders.</>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>

            {ordersError ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-red-600">Failed to load orders: {ordersError}</div>
                </CardContent>
              </Card>
            ) : orders.length === 0 ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-[hsl(var(--muted))]">No orders found.</div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {orders.map((o) => {
                  const items: OrderItemLite[] = Array.isArray(o.items) ? (o.items as any) : []
                  const totalTxt = formatCurrency(o.total_cents ?? 0, 'en-EG', 'EGP')
                  const discount = Number(o.discount_pct ?? 0)

                  return (
                    <Card key={o.id} hover={true}>
                      <CardContent className="py-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="font-semibold">#{shortId(o.id)}</div>
                          <div className="text-sm text-gray-600">
                            Status: <b>{humanStatus(o.status)}</b>
                          </div>
                          <div className="text-sm text-gray-600">
                            Total: <b>{totalTxt}</b>
                            {discount ? ` (−${discount}%)` : ''}
                          </div>
                          <div className="text-sm text-gray-600">Payment: {o.payment || 'cash'}</div>
                          <div className="ml-auto text-xs text-[hsl(var(--muted))]">{fmtDateTime(o.created_at)}</div>
                        </div>

                        <div className="text-sm">
                          <span className="font-medium">Buyer:</span> {displayName(o)}
                          {o.buyer_member_id ? <span className="text-xs text-[hsl(var(--muted))]"> · {o.buyer_member_id}</span> : null}
                        </div>

                        {/* Status editor (tiny client component) */}
                        <AdminOrderStatusEditor orderId={o.id} currentStatus={o.status} currentNote={o.note || ''} />

                        {o.note ? <div className="text-sm">Note: {o.note}</div> : null}

                        {items.length ? (
                          <div className="text-sm">
                            <div className="font-medium mb-1">Items</div>
                            <ul className="list-disc ml-5 space-y-1">
                              {items.map((it) => (
                                <li key={it.id}>
                                  {it.name || 'Item'} × {it.qty} — {formatCurrency(it.unit_price_cents, 'en-EG', it.currency || 'EGP')}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">No items.</div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Pagination */}
            {!ordersError && ordersTotal > 0 && ordersTotalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...ordersBaseParams, page: String(Math.max(1, page - 1)) })}
                  aria-disabled={page <= 1}
                  className={`px-2 py-1 rounded border ${page <= 1 ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
                >
                  Prev
                </Link>
                <div className="text-sm">
                  Page <b>{page}</b> / {ordersTotalPages}
                </div>
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...ordersBaseParams, page: String(Math.min(ordersTotalPages, page + 1)) })}
                  aria-disabled={page >= ordersTotalPages}
                  className={`px-2 py-1 rounded border ${page >= ordersTotalPages ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'products' ? (
          <section className="space-y-4">
            <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Add product</h2>
                    <p className="text-sm text-gray-600">Client form is lazy-loaded. Listing below is server-first.</p>
                  </div>
                </div>
                <StoreProductForm />
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <form action="/admin/store" method="get" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tab" value="products" />

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Search</label>
                    <input
                      name="p_q"
                      defaultValue={pQ}
                      className="rounded-xl border px-3 py-2 text-sm bg-white"
                      placeholder="Name, color, size or UUID"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Category</label>
                    <select name="p_category" defaultValue={pCategory} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {PRODUCT_CATS.map((c) => (
                        <option key={c.v} value={c.v}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Active</label>
                    <select name="p_active" defaultValue={pActive} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {PRODUCT_ACTIVE.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[hsl(var(--muted))]">Page size</label>
                    <select name="p_page_size" defaultValue={String(pPageSize)} className="rounded-xl border px-3 py-2 text-sm bg-white">
                      {[12, 24, 48, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button className="rounded-xl px-4 py-2 text-sm font-medium border hover:bg-gray-50" type="submit">
                    Apply
                  </button>

                  <Link prefetch={false} href={buildUrl('/admin/store', { tab: 'products' })} className="text-sm underline text-gray-700 hover:text-black">
                    Clear
                  </Link>

                  <div className="ml-auto text-xs text-[hsl(var(--muted))]">
                    {productsTotal > 0 ? (
                      <>
                        Page <b>{pPage}</b> / {productsTotalPages} · Total <b>{productsTotal}</b>
                      </>
                    ) : (
                      <>No products.</>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>

            {productsError ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-red-600">Failed to load products: {productsError}</div>
                </CardContent>
              </Card>
            ) : products.length === 0 ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-[hsl(var(--muted))]">No products found.</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {products.map((p) => {
                  const price = formatCurrency(p.price_cents ?? 0, 'en-EG', p.currency ?? 'EGP')
                  return (
                    <Card key={p.id} hover>
                      <CardContent className="py-4 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <div className="font-semibold">{p.name}</div>
                            <div className="text-xs text-[hsl(var(--muted))]">
                              {p.category}
                              {p.color ? ` · ${p.color}` : ''}
                              {p.size ? ` · ${p.size}` : ''}
                            </div>
                          </div>
                          <div className="text-sm font-semibold">{price}</div>
                        </div>

                        <div className="text-xs text-[hsl(var(--muted))]">
                          Created: {fmtDateTime(p.created_at)} · ID: {shortId(p.id)}
                        </div>

                        <AdminProductQuickEdit id={p.id} inventoryQty={p.inventory_qty ?? 0} isActive={!!p.is_active} />
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Pagination */}
            {!productsError && productsTotal > 0 && productsTotalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...productsBaseParams, p_page: String(Math.max(1, pPage - 1)) })}
                  aria-disabled={pPage <= 1}
                  className={`px-2 py-1 rounded border ${pPage <= 1 ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
                >
                  Prev
                </Link>
                <div className="text-sm">
                  Page <b>{pPage}</b> / {productsTotalPages}
                </div>
                <Link
                  prefetch={false}
                  href={buildUrl('/admin/store', { ...productsBaseParams, p_page: String(Math.min(productsTotalPages, pPage + 1)) })}
                  aria-disabled={pPage >= productsTotalPages}
                  className={`px-2 py-1 rounded border ${pPage >= productsTotalPages ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </section>
        ) : null}
      </Section>
    </main>
  )
}
