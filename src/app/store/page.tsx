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
import { canAccessStore, canAccessStoreAdmin } from '@/lib/rbac'
import {
  FALLBACK_STORE_PRODUCT_CATEGORIES,
  buildStoreCategoryOptions,
  storeCategoryLabelMap,
  type StoreProductCategoryRow,
} from '@/lib/storeCategories'
import StoreCatalogModelCard from '@/components/store/StoreCatalogModelCard'

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

type ProductModelRef = {
  id: string
  name: string
  slug: string | null
  description: string | null
  cover_image_path: string | null
  sort_order: number | null
  category_key: string | null
  is_active: boolean | null
}

type ProductRow = {
  id: string
  category: Category
  model_id: string | null
  model: ProductModelRef | null
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

type ProductQueryRow = Omit<ProductRow, 'model'> & {
  model: ProductRow['model'] | Array<NonNullable<ProductRow['model']>> | null
}

const STORE_PRODUCT_BUCKET = 'store-product-images'
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

function storeProductImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!SUPABASE_URL || !clean) return ''
  const encodedPath = clean.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${SUPABASE_URL}/storage/v1/object/public/${STORE_PRODUCT_BUCKET}/${encodedPath}`
}

function resolveStoreCatalogImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!clean) return null
  if (/^https?:\/\//i.test(clean)) return clean
  return storeProductImageUrl(clean) || null
}

function normalizeProductRow(row: ProductQueryRow): ProductRow {
  const model = Array.isArray(row.model) ? row.model[0] ?? null : row.model ?? null
  return {
    ...row,
    model,
  }
}

const listStoreProductsCached = unstable_cache(
  async (isStoreAdmin: boolean, showPreorderOnly: boolean, category: string) => {
    const supa = getSupabaseAdminClientCached()

    let qry = supa
      .from('store_products')
      .select('id, category, model_id, name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, image_path, created_at, model:store_product_models(id,name,slug,description,cover_image_path,sort_order,category_key,is_active)')
      .order('created_at', { ascending: false })

    if (!isStoreAdmin) qry = qry.eq('is_active', true)
    if (showPreorderOnly) qry = qry.eq('allow_preorder', true)
    qry = qry.not('model_id', 'is', null)
    if (category && category !== 'all') qry = qry.eq('category', category)

    const { data, error } = await qry
    if (error) throw new Error(error.message)

    const items = (Array.isArray(data) ? data : []).map((row) => normalizeProductRow(row as ProductQueryRow))
    return { items }
  },
  ['store_products_user_catalog_v4'],
  { revalidate: 120, tags: ['store-products', 'store-models'] }
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

type StoreModelVariant = {
  id: string
  category: Category
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  is_active: boolean
  allow_preorder: boolean
  image_url: string | null
}

type StoreModelCard = {
  key: string
  category: Category
  categoryLabel: string
  name: string
  description: string | null
  priceFromCents: number
  priceToCents: number
  currency: string
  colorGroups: Array<{
    key: string
    label: string
    image_url: string | null
    variants: StoreModelVariant[]
  }>
  previewImageUrl: string | null
  sortOrder: number
}

function normalizeKeyPart(value: string | null | undefined, fallback: string) {
  const clean = String(value ?? '').trim().toLowerCase()
  return clean || fallback
}

function labelOrFallback(value: string | null | undefined, fallback: string) {
  const clean = String(value ?? '').trim()
  return clean || fallback
}

function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesStoreSearch(item: ProductRow, q: string, categoryLabels: Map<string, string>) {
  const needle = normalizeSearchText(q)
  if (!needle) return true

  const haystack = normalizeSearchText(
    [
      item.model?.name,
      item.model?.slug,
      item.model?.description,
      item.name,
      item.color,
      item.size,
      item.category,
      categoryLabels.get(item.category),
    ].filter(Boolean).join(' ')
  )

  return haystack.includes(needle)
}

function buildStoreModelCards(items: ProductRow[], categoryLabels: Map<string, string>) {
  const grouped = new Map<string, {
    category: Category
    categoryLabel: string
    name: string
    description: string | null
    sortOrder: number
    coverImageUrl: string | null
    variants: StoreModelVariant[]
  }>()

  for (const item of items) {
    const linkedModel = item.model_id && item.model?.id ? item.model : null
    if (!linkedModel) continue

    const key = `model:${linkedModel.id}`
    const modelCategory = String(linkedModel.category_key ?? item.category).trim() || item.category

    const current = grouped.get(key) ?? {
      category: modelCategory,
      categoryLabel: categoryLabel(modelCategory, categoryLabels),
      name: String(linkedModel.name || '').trim(),
      description: String(linkedModel.description ?? '').trim() || null,
      sortOrder: Number(linkedModel.sort_order ?? 0),
      coverImageUrl: resolveStoreCatalogImageUrl(linkedModel.cover_image_path),
      variants: [],
    }

    current.variants.push({
      id: item.id,
      category: item.category,
      name: item.name,
      color: item.color,
      size: item.size,
      price_cents: Number(item.price_cents ?? 0),
      currency: item.currency ?? 'EGP',
      is_active: Boolean(item.is_active),
      allow_preorder: Boolean(item.allow_preorder),
      image_url: resolveStoreCatalogImageUrl(item.image_path),
    })

    if (!current.coverImageUrl) {
      current.coverImageUrl = resolveStoreCatalogImageUrl(linkedModel.cover_image_path)
    }

    grouped.set(key, current)
  }

  return Array.from(grouped.entries())
    .map(([key, model]) => {
      const colorMap = new Map<string, { key: string; label: string; image_url: string | null; variants: StoreModelVariant[] }>()

      for (const variant of model.variants) {
        const colorKey = normalizeKeyPart(variant.color, '__default')
        const colorLabel = labelOrFallback(variant.color, 'Standard')
        const bucket = colorMap.get(colorKey) ?? {
          key: colorKey,
          label: colorLabel,
          image_url: variant.image_url,
          variants: [],
        }
        bucket.variants.push(variant)
        if (!bucket.image_url && variant.image_url) bucket.image_url = variant.image_url
        colorMap.set(colorKey, bucket)
      }

      const colorGroups = Array.from(colorMap.values())
        .map((group) => ({
          ...group,
          variants: [...group.variants].sort((a, b) =>
            labelOrFallback(a.size, 'One size').localeCompare(labelOrFallback(b.size, 'One size'), undefined, {
              numeric: true,
              sensitivity: 'base',
            })
          ),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }))

      const prices = model.variants.map((variant) => Number(variant.price_cents ?? 0))
      const fallbackCurrency = model.variants.find((variant) => variant.currency)?.currency ?? 'EGP'

      return {
        key,
        category: model.category,
        categoryLabel: model.categoryLabel,
        name: model.name,
        description: model.description,
        priceFromCents: prices.length ? Math.min(...prices) : 0,
        priceToCents: prices.length ? Math.max(...prices) : 0,
        currency: fallbackCurrency,
        colorGroups,
        previewImageUrl: model.coverImageUrl || colorGroups.find((group) => group.image_url)?.image_url || null,
        sortOrder: model.sortOrder,
      } satisfies StoreModelCard
    })
    .sort((a, b) => {
      const sortDelta = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)
      if (sortDelta !== 0) return sortDelta
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
}

export default async function StorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/store')

  const role = me.role
  const isStoreAdmin = canAccessStoreAdmin(role)
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

  const fromRow = (page - 1) * pageSize
  const toRow = fromRow + pageSize - 1

  let items: ProductRow[] = []
  let errorMsg: string | null = null

  try {
    const res = await listStoreProductsCached(isStoreAdmin, canPreorder, category)
    items = res.items
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  items = items.filter((item) => item.model_id && item.model?.id)

  if (!isStoreAdmin) {
    items = items.filter((item) => item.model?.is_active !== false)
  }
  if (q) {
    items = items.filter((item) => matchesStoreSearch(item, q, categoryLabels))
  }

  const modelCards = buildStoreModelCards(items, categoryLabels)
  const pagedModels = modelCards.slice(fromRow, toRow + 1)
  const hasMore = modelCards.length > toRow + 1

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
          isStoreAdmin
            ? 'Browse the model catalog or open Store Admin.'
            : canPreorder
              ? 'Browse by model, pick the exact variant, then send your preorder quickly.'
              : 'Browse the model catalog.'
        }
      />

      <Section className="space-y-6">
        {isStoreAdmin ? (
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
                    Choose your model, then confirm the exact color and size before sending the request.
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
                  <div className="font-medium">1. Choose model</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Open the model you want from the selected category.</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3">
                  <div className="font-medium">2. Choose color / size</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Pick the exact color first, then the right size.</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3">
                  <div className="font-medium">3. Send request</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Confirm quantity, add an optional note, then pay later offline.</div>
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

            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Browse catalog</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                  Model-first browsing by category, then exact color and size selection.
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
                  placeholder="Search by model, color or size"
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
                {modelCards.length > 0 ? (
                  <>
                    Showing <b>{fromRow + 1}</b>–<b>{Math.min(fromRow + pagedModels.length, modelCards.length)}</b> model{modelCards.length > 1 ? 's' : ''}
                  </>
                ) : (
                  <>No models.</>
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
        ) : modelCards.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">
                {canPreorder ? 'No preorderable models match your search right now.' : 'No models match your search right now.'}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pagedModels.map((model) => (
              <StoreCatalogModelCard key={model.key} model={model} canPreorder={canPreorder} />
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
