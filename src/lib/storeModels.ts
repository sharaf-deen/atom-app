export type StoreProductModelRow = {
  id: string
  category_key: string
  name: string
  slug: string
  description: string | null
  cover_image_path: string | null
  is_active: boolean
  is_featured: boolean
  sort_order: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export function normalizeStoreModelSlug(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

export function sortStoreModels<T extends Pick<StoreProductModelRow, 'sort_order' | 'name'>>(items: T[]) {
  return [...items].sort((a, b) => {
    const sortDelta = Number(a.sort_order || 0) - Number(b.sort_order || 0)
    if (sortDelta !== 0) return sortDelta
    return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
  })
}
