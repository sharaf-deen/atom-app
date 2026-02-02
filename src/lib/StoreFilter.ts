// src/lib/storeFilter.ts
export type StockFilter = 'all' | 'in' | 'out'
export type ActiveFilter = 'all' | 'active' | 'inactive'

export type ProductLike = {
  name?: string | null
  category?: string | null
  color?: string | null
  size?: string | null
  inventory_qty?: number | null
  is_active?: boolean | null
}

export type ProductFilters = {
  q?: string
  category?: string | null
  stock?: StockFilter
  active?: ActiveFilter
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function filterProducts<T extends ProductLike>(products: T[], filters: ProductFilters) {
  const q = norm(filters.q ?? '')
  const category = (filters.category ?? '').trim()
  const stock = filters.stock ?? 'all'
  const active = filters.active ?? 'all'

  return products.filter((p) => {
    // category
    if (category && (p.category ?? '') !== category) return false

    // stock
    const qty = Number(p.inventory_qty ?? 0)
    if (stock === 'in' && qty <= 0) return false
    if (stock === 'out' && qty > 0) return false

    // active
    const isActive = Boolean(p.is_active ?? true)
    if (active === 'active' && !isActive) return false
    if (active === 'inactive' && isActive) return false

    // search
    if (q) {
      const hay = norm(
        [
          p.name ?? '',
          p.category ?? '',
          p.color ?? '',
          p.size ?? '',
          qty > 0 ? 'in stock' : 'out of stock',
        ].join(' ')
      )
      if (!hay.includes(q)) return false
    }

    return true
  })
}