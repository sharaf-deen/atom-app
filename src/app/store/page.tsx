export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import { canAccessStore, canAccessStoreAdmin } from '@/lib/rbac'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

const CATEGORIES: Array<{ v: 'all' | Category; label: string }> = [
  { v: 'all', label: 'All' },
  { v: 'kimono', label: 'Kimono' },
  { v: 'rashguard', label: 'Rashguard' },
  { v: 'short', label: 'Short' },
  { v: 'belt', label: 'Belt' },
]

const USER_PREORDER_ROLES = new Set([
  'member',
  'coach',
  'assistant_coach',
  'head_coach',
  'vip',
  'champion',
])

const StorePreorderAction = dynamicImport(() => import('@/components/store/StorePreorderAction'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading preorder action…</div>,
})

const StoreMyPreorders = dynamicImport(() => import('@/components/store/StoreMyPreorders'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading my preorders…</div>,
})

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
  created_at?: string | null
}

const listStoreProductsCached = unstable_cache(
  async (
    isSuperAdmin: boolean,
    showPreorderOnly: boolean,
    category: string,
    q: string,
    fromRow: number,
    toRow: number
  ) => {
    const supa = getSupabaseAdminClientCached()

    let qry = supa
      .from('store_products')
      .select('id, category, name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, created_at')
      .order('created_at', { ascending: false })
      .range(fromRow, toRow + 1)

    if (!isSuperAdmin) qry = qry.eq('is_active', true)
    if (showPreorderOnly) qry = qry.eq('allow_preorder', true)
    if (category && category !== 'all') qry = qry.eq('category', category)

    if (q) {
      if (q.length >= 3) {
        qry = qry.textSearch('search_tsv', q, { type: 'websearch', config: 'simple' })
      } else {
        const safe = q.replace(/,/g, ' ').trim()
        qry = qry.or([
          `name.ilike.%${safe}%`,
          `color.ilike.%${safe}%`,
          `size.ilike.%${safe}%`,
          `category.ilike.%${safe}%`,
        ].join(','))
      }
    }

    const { data, error } = await qry
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as any[]
    const hasMore = rows.length > toRow - fromRow + 1
    const sliced = hasMore ? rows.slice(0, toRow - fromRow + 1) : rows
    return { items: sliced as ProductRow[], hasMore }
  },
  ['store_products_user_preorders_v2'],
  { revalidate: 120, tags: ['store-products'] }
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

function normalizeCat(v: string): 'all' | Category {
  return v === 'kimono' || v === 'rashguard' || v === 'short' || v === 'belt' ? v : 'all'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

function stockTone(stock: number) {
  if (stock <= 0) return 'text-amber-700'
  if (stock <= 2) return 'text-amber-700'
  return 'text-emerald-700'
}

export default async function StorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/store')

  const role = me.role
  const isSuperAdmin = canAccessStoreAdmin(role)
  const canPreorder = USER_PREORDER_ROLES.has(role)

  if (!canAccessStore(role)) redirect('/')

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = 12
  const category = normalizeCat(strParam(searchParams?.category))
  const q = strParam(searchParams?.q).trim()

  const fromRow = (page - 1) * pageSize
  const toRow = fromRow + pageSize - 1

  let items: ProductRow[] = []
  let errorMsg: string | null = null
  let hasMore = false

  try {
    const res = await listStoreProductsCached(isSuperAdmin, canPreorder, category, q, fromRow, toRow)
    items = res.items
    hasMore = Boolean(res.hasMore)
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const baseParams = {
    category: category === 'all' ? '' : category,
    q,
  }

  return (
    <main>
      <PageHeader title="Store" />

      <Section className="space-y-6">
        {isSuperAdmin ? (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div>
                <div className="font-semibold">Admin management</div>
                <div className="text-sm text-gray-600">Catalog, supplier orders, and store operations are managed from /admin/store.</div>
              </div>
              <Link
                prefetch={false}
                href="/admin/store"
                className="ml-auto inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open /admin/store
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {canPreorder ? (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">Pre-order from the catalog</div>
                  <div className="text-sm text-[hsl(var(--muted))]">
                    Choose a product, set the quantity, and send your request. Deposit and payment are handled later by the store admin.
                  </div>
                </div>
                <Link
                  prefetch={false}
                  href="/orders"
                  className="inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Legacy orders
                </Link>
              </div>
              <StoreMyPreorders />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent>
            <form action="/store" method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Search</label>
                <input
                  name="q"
                  defaultValue={q}
                  className="rounded-xl border bg-white px-3 py-2 text-sm"
                  placeholder="Model, color, size…"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Category</label>
                <select
                  name="category"
                  defaultValue={category}
                  className="rounded-xl border bg-white px-3 py-2 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.v} value={c.v}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <button className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50" type="submit">
                Apply
              </button>

              <Link prefetch={false} href="/store" className="text-sm underline text-gray-700 hover:text-black">
                Clear
              </Link>

              <div className="ml-auto text-xs text-[hsl(var(--muted))]">
                {items.length > 0 ? (
                  <>
                    Showing <b>{fromRow + 1}</b>–<b>{fromRow + items.length}</b>
                  </>
                ) : (
                  <>No products.</>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {errorMsg ? (
          <Card>
            <CardContent>
              <div className="text-sm text-red-600">Failed to load products: {errorMsg}</div>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">
                {canPreorder ? 'No preorderable products match your filters.' : 'No products match your filters.'}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
              const price = formatCurrency(p.price_cents ?? 0, 'en-EG', p.currency ?? 'EGP')
              const stock = Math.max(0, Number(p.inventory_qty ?? 0))

              return (
                <Card key={p.id} hover>
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-[hsl(var(--muted))]">
                          {p.category}
                          {p.color ? ` · ${p.color}` : ''}
                          {p.size ? ` · ${p.size}` : ''}
                        </div>
                      </div>
                      <div className="text-sm font-semibold">{price}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`font-medium ${stockTone(stock)}`}>
                        Current stock: {stock}
                      </span>
                      {p.allow_preorder ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
                          Pre-order available
                        </span>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">
                          Pre-order off
                        </span>
                      )}
                      {!p.is_active ? (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
                          Inactive
                        </span>
                      ) : null}
                    </div>

                    {canPreorder ? (
                      <StorePreorderAction
                        product={{
                          id: p.id,
                          category: p.category,
                          name: p.name,
                          color: p.color,
                          size: p.size,
                          price_cents: p.price_cents,
                          currency: p.currency,
                          is_active: p.is_active,
                          allow_preorder: p.allow_preorder,
                        }}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {!errorMsg && (page > 1 || hasMore) ? (
          <div className="flex items-center gap-2">
            <Link
              prefetch={false}
              href={buildUrl('/store', { ...baseParams, page: String(Math.max(1, page - 1)) })}
              aria-disabled={page <= 1}
              className={`rounded border px-2 py-1 ${page <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}
            >
              Prev
            </Link>
            <div className="text-sm">
              Page <b>{page}</b>
            </div>
            <Link
              prefetch={false}
              href={buildUrl('/store', { ...baseParams, page: String(page + 1) })}
              aria-disabled={!hasMore}
              className={`rounded border px-2 py-1 ${!hasMore ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}
            >
              Next
            </Link>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
