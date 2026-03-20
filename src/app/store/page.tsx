// src/app/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
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
  created_at?: string | null
}

const listStoreProductsCached = unstable_cache(
  async (
    isSuperAdmin: boolean,
    category: string,
    q: string,
    fromRow: number,
    toRow: number
  ) => {
    const supa = getSupabaseAdminClientCached()

    let qry = supa
      .from('store_products')
      .select('id, category, name, color, size, price_cents, currency, inventory_qty, is_active, created_at')
      .order('created_at', { ascending: false })
      .range(fromRow, toRow + 1)

    if (!isSuperAdmin) qry = qry.eq('is_active', true)
    if (category && category !== 'all') qry = qry.eq('category', category)

    if (q) {
      if (q.length >= 3) {
        qry = qry.textSearch('search_tsv', q, { type: 'websearch', config: 'simple' })
      } else {
        const safe = q.replace(/,/g, ' ').trim()
        qry = qry.or(
          [
            `name.ilike.%${safe}%`,
            `color.ilike.%${safe}%`,
            `size.ilike.%${safe}%`,
            `category.ilike.%${safe}%`,
          ].join(',')
        )
      }
    }

    const { data, error } = await qry
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as any[]
    const hasMore = rows.length > toRow - fromRow + 1
    const sliced = hasMore ? rows.slice(0, toRow - fromRow + 1) : rows
    return { items: sliced as any, hasMore }
  },
  ['store_products_v2'],
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

export default async function StorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/store')

  const role = me.role
  const isSuperAdmin = canAccessStoreAdmin(role)

  if (!canAccessStore(role)) redirect('/')

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 12, 6, 48)
  const category = normalizeCat(strParam(searchParams?.category))
  const q = strParam(searchParams?.q).trim()

  const fromRow = (page - 1) * pageSize
  const toRow = fromRow + pageSize - 1

  let items: ProductRow[] = []
  let errorMsg: string | null = null
  let hasMore = false

  try {
    const res = await listStoreProductsCached(isSuperAdmin, category, q, fromRow, toRow)
    items = res.items as any
    hasMore = Boolean((res as any).hasMore)
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const baseParams = {
    category: category === 'all' ? '' : category,
    q,
    page_size: String(pageSize),
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
                <div className="text-sm text-gray-600">Catalog & orders management is now in /admin/store.</div>
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

        <Card>
          <CardContent>
            <form action="/store" method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Search</label>
                <input
                  name="q"
                  defaultValue={q}
                  className="rounded-xl border px-3 py-2 text-sm bg-white"
                  placeholder="Name, color, size…"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Category</label>
                <select
                  name="category"
                  defaultValue={category}
                  className="rounded-xl border px-3 py-2 text-sm bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.v} value={c.v}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Page size</label>
                <select
                  name="page_size"
                  defaultValue={String(pageSize)}
                  className="rounded-xl border px-3 py-2 text-sm bg-white"
                >
                  {[12, 24, 48].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <button className="rounded-xl px-4 py-2 text-sm font-medium border hover:bg-gray-50" type="submit">
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
              <div className="text-sm text-[hsl(var(--muted))]">No products match your filters.</div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
              const price = formatCurrency(p.price_cents ?? 0, 'en-EG', p.currency ?? 'EGP')
              const stock = Number(p.inventory_qty ?? 0)

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

                    <div className="flex items-center gap-2">
                      <div className="text-xs text-[hsl(var(--muted))]">
                        Stock: <b>{stock}</b>
                        {!p.is_active ? <span className="ml-2 text-red-600">Inactive</span> : null}
                      </div>
                    </div>
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
              className={`px-2 py-1 rounded border ${page <= 1 ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
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
              className={`px-2 py-1 rounded border ${!hasMore ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
            >
              Next
            </Link>
          </div>
        ) : null}
      </Section>
    </main>
  )
}