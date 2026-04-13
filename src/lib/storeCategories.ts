export type StoreProductCategoryRow = {
  key: string
  label: string
  is_active: boolean
  sort_order: number
  product_count?: number
}

export const FALLBACK_STORE_PRODUCT_CATEGORIES: StoreProductCategoryRow[] = [
  { key: 'kimono', label: 'Kimono', is_active: true, sort_order: 10 },
  { key: 'rashguard', label: 'Rashguard', is_active: true, sort_order: 20 },
  { key: 'short', label: 'Short', is_active: true, sort_order: 30 },
  { key: 'belt', label: 'Belt', is_active: true, sort_order: 40 },
]

export function normalizeStoreCategoryKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

export function sortStoreProductCategories<T extends StoreProductCategoryRow>(items: T[]) {
  return [...items].sort((a, b) => {
    const sortDelta = Number(a.sort_order || 0) - Number(b.sort_order || 0)
    if (sortDelta !== 0) return sortDelta
    return String(a.label || a.key).localeCompare(String(b.label || b.key), 'en', { sensitivity: 'base' })
  })
}

export function buildStoreCategoryOptions(
  items: StoreProductCategoryRow[],
  opts?: { includeAll?: boolean; activeOnly?: boolean }
) {
  const includeAll = opts?.includeAll !== false
  const activeOnly = opts?.activeOnly === true
  const rows = sortStoreProductCategories(items).filter((item) => (activeOnly ? item.is_active : true))
  const mapped = rows.map((item) => ({ value: item.key, label: item.label }))
  return includeAll ? [{ value: 'all', label: 'All' }, ...mapped] : mapped
}

export function storeCategoryLabelMap(items: StoreProductCategoryRow[]) {
  return new Map(items.map((item) => [item.key, item.label]))
}

export function ensureCategoryInList(
  items: StoreProductCategoryRow[],
  key: string | null | undefined,
  label?: string | null
) {
  const clean = String(key || '').trim()
  if (!clean) return items
  if (items.some((item) => item.key === clean)) return items
  return sortStoreProductCategories([
    ...items,
    {
      key: clean,
      label: String(label || clean),
      is_active: true,
      sort_order: 9999,
    },
  ])
}
