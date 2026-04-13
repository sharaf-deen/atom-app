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
import StoreCatalogModelCard from '@/components/store/StoreCatalogModelCard'
import { canAccessStore, canAccessStoreAdmin } from '@/lib/rbac'
import {
  FALLBACK_STORE_PRODUCT_CATEGORIES,
  buildStoreCategoryOptions,
  storeCategoryLabelMap,
  type StoreProductCategoryRow,
} from '@/lib/storeCategories'

type Category = string

const USER_PREORDER_ROLES = new Set([
  'member',
  'coach',
  'assistant_coach',
  'head_coach',
  'vip',
  'champion',
])

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
  image_path: string | null
  created_at?: string | null
}

type ProductModelGroup = {
  key: string
  category: Category
  name: string
  color: string | null
  image_path: string | null
  priceMinCents: number
  priceMaxCents: number
  currency: string
  created_at: string | null
  variants: ProductRow[]
}

const STORE_PRODUCT_BUCKET = 'store-product-images'
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

function storeProductImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!SUPABASE_URL || !clean) return ''
  const encodedPath = clean.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${SUPABASE_URL}/storage/v1/object/public/${STORE_PRODUCT_BUCKET}/${encodedPath}`
}

const listStoreProductsCached = unstable_cache(
  async (
    isSuperAdmin: boolean,
    showPreorderOnly: boolean,
    category: string,
    q: string
  ) => {
    const supa = getSupabaseAdminClientCached()

    let qry = supa
      .from('store_products')
      .select('id, category, name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, image_path, created_at')
      .order('created_at', { ascending: false })

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

    const { data, error } = await qry.limit(240)
    if (error) throw new Error(error.message)

    return { items: ((data ?? []) as any[]) as ProductRow[] }
  },
  ['store_products_user_preorders_v3'],
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

function normalizeCat(v: string, allowed: Set<string>): 'all' | Category {
  const clean = String(v || '').trim()
  return clean && allowed.has(clean) ? clean : 'all'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}


function categoryLabel(category: Category | 'all', labels: Map<string, string>) {
  if (category === 'all') return 'All'
  return labels.get(category) ?? category
}

function buildModelGroups(items: ProductRow[]) {
  const groups = new Map<string, ProductModelGroup>()

  for (const item of items) {
    const key = [item.category, item.name.trim().toLowerCase(), (item.color ?? '').trim().toLowerCase()].join('::')
    const currency = item.currency ?? 'EGP'
    const createdAt = item.created_at ?? null
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        key,
        category: item.category,
        name: item.name,
        color: item.color,
        image_path: item.image_path,
        priceMinCents: item.price_cents ?? 0,
        priceMaxCents: item.price_cents ?? 0,
        currency,
        created_at: createdAt,
        variants: [item],
      })
      continue
    }

    existing.variants.push(item)
    existing.priceMinCents = Math.min(existing.priceMinCents, item.price_cents ?? 0)
    existing.priceMaxCents = Math.max(existing.priceMaxCents, item.price_cents ?? 0)

    if (!existing.image_path && item.image_path) existing.image_path = item.image_path
    if ((createdAt ?? '') > (existing.created_at ?? '')) existing.created_at = createdAt
  }

  return Array.from(groups.values()).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
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

  let categoryRows: StoreProductCategoryRow[] = []
  try {
    const { data, error } = await getSupabaseAdminClientCached()
      .from('store_product_categories')
      .select('key,label,is_active,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (error) throw error
    categoryRows = ((data ?? []) as StoreProductCategoryRow[]).filter((row) => row.key && row.label)
  } catch {
    categoryRows = FALLBACK_STORE_PRODUCT_CATEGORIES.filter((row) => row.is_active)
  }

  if (categoryRows.length === 0) categoryRows = FALLBACK_STORE_PRODUCT_CATEGORIES.filter((row) => row.is_active)
  const categoryKeys = new Set(categoryRows.map((row) => row.key))
  const categoryOptions = buildStoreCategoryOptions(categoryRows, { includeAll: true, activeOnly: true })
  const categoryLabels = storeCategoryLabelMap(categoryRows)

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = 12
  const category = normalizeCat(strParam(searchParams?.category), categoryKeys)
  const q = strParam(searchParams?.q).trim()

  let items: ProductRow[] = []
  let errorMsg: string | null = null

  try {
    const res = await listStoreProductsCached(isSuperAdmin, canPreorder, category, q)
    items = res.items
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const modelGroups = buildModelGroups(items)
  const totalGroups = modelGroups.length
  const fromRow = totalGroups > 0 ? (page - 1) * pageSize : 0
  const pagedGroups = modelGroups.slice(fromRow, fromRow + pageSize)
  const hasMore = fromRow + pageSize < totalGroups

  const baseParams = {
    category: category === 'all' ? '' : category,
    q,
  }

  const searchLabel = q ? `Search: ${q}` : `Category: ${categoryLabel(category, categoryLabels)}`

  return (
    <main>
      <PageHeader
        title="Store"
        subtitle={
          isSuperAdmin
            ? 'Browse the catalog or open Store Admin.'
            : canPreorder
              ? 'Browse the catalog and send a preorder quickly.'
              : 'Browse the catalog.'
        }
      />

      <Section className="space-y-6">
        {isSuperAdmin ? (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div>
                <div className="font-semibold">Admin management</div>
                <div className="text-sm text-gray-600">Catalog, supplier orders, preorders, sales, and the dashboard are managed from Store Admin.</div>
              </div>
              <Link
                prefetch={false}
                href="/admin/store/dashboard"
                className="ml-auto inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open Store Admin
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {canPreorder ? (
          <Card>
            <CardContent className="space-y-4 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">Pre-order gear</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    Choose your item, send your request, then confirm the rest later with the store admin.
                  </div>
                </div>
                <Link
                  prefetch={false}
                  href="#store-search"
                  className="inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Browse catalog
                </Link>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3">
                  <div className="font-medium">1. Choose</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Pick the product, color and size that suit you.</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3">
                  <div className="font-medium">2. Send request</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Set the quantity and add an optional note.</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3">
                  <div className="font-medium">3. Pay later</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Deposit and final payment stay managed offline.</div>
                </div>
              </div>

              <details className="group rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-4">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">My preorders</div>
                    <div className="text-xs text-[hsl(var(--muted))]">Track status, deposits and pickup readiness.</div>
                  </div>
                  <span className="text-xs font-medium text-[hsl(var(--muted))] transition group-open:rotate-180">⌄</span>
                </summary>
                <div className="pt-4">
                  <StoreMyPreorders />
                </div>
              </details>

              <div className="text-xs text-[hsl(var(--muted))]">
                Need the old archive?{' '}
                <Link prefetch={false} href="/orders" className="underline hover:text-black">
                  Open legacy orders
                </Link>
                .
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Browse catalog</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                  Quick search, clean cards and simple category shortcuts.
                </div>
              </div>
              <div className="rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">
                {searchLabel}
              </div>
            </div>

            <form action="/store" method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="category" value={category} />

              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <label htmlFor="store-search" className="text-xs text-[hsl(var(--muted))]">
                  Search
                </label>
                <input
                  id="store-search"
                  name="q"
                  defaultValue={q}
                  className="rounded-xl border bg-white px-3 py-2 text-sm"
                  placeholder="Search by item, color or size"
                />
              </div>

              <button className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50" type="submit">
                Search
              </button>

              {(q || category !== 'all') ? (
                <Link prefetch={false} href="/store" className="text-sm underline text-gray-700 hover:text-black">
                  Clear
                </Link>
              ) : null}

              <div className="ml-auto text-xs text-[hsl(var(--muted))]">
                {totalGroups > 0 ? (
                  <>
                    Showing <b>{fromRow + 1}</b>–<b>{Math.min(totalGroups, fromRow + pagedGroups.length)}</b> of <b>{totalGroups}</b>
                  </>
                ) : (
                  <>No products.</>
                )}
              </div>
            </form>

            <div className="flex flex-wrap gap-2">
              {categoryOptions.map((item) => {
                const href = buildUrl('/store', {
                  q,
                  category: item.value === 'all' ? '' : item.value,
                })
                const active = category === item.value
                return (
                  <Link
                    key={item.value}
                    prefetch={false}
                    href={href}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-[hsl(var(--border))] bg-white text-black hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {errorMsg ? (
          <Card>
            <CardContent>
              <div className="text-sm text-red-600">Failed to load products: {errorMsg}</div>
            </CardContent>
          </Card>
        ) : pagedGroups.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">
                {canPreorder ? 'No preorderable products match your search right now.' : 'No products match your search right now.'}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pagedGroups.map((model) => (
              <StoreCatalogModelCard
                key={model.key}
                model={{
                  key: model.key,
                  categoryLabel: categoryLabel(model.category, categoryLabels),
                  name: model.name,
                  color: model.color,
                  imageUrl: storeProductImageUrl(model.image_path),
                  priceMinCents: model.priceMinCents,
                  priceMaxCents: model.priceMaxCents,
                  currency: model.currency,
                  variants: model.variants.map((variant) => ({
                    id: variant.id,
                    category: variant.category,
                    name: variant.name,
                    color: variant.color,
                    size: variant.size,
                    price_cents: variant.price_cents,
                    currency: variant.currency,
                    is_active: variant.is_active,
                    allow_preorder: variant.allow_preorder,
                  })),
                }}
              />
            ))}
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
