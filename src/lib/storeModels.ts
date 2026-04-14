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
  linked_product_count?: number
  category_label?: string | null
}

type ModelSuggestionVariantLike = {
  category?: string | null
  name?: string | null
  color?: string | null
  size?: string | null
}

export function normalizeStoreModelSlug(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function normalizeCompactKey(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function tokenizeLooseText(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function countSharedTokens(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  let score = 0
  for (const token of left) {
    if (rightSet.has(token)) score += 1
  }
  return score
}

export function scoreStoreModelSuggestion(model: StoreProductModelRow, variant: ModelSuggestionVariantLike) {
  if (!model?.id) return -1
  if (String(model.category_key || '') !== String(variant.category || '')) return -1

  const modelNameKey = normalizeCompactKey(model.name)
  const modelSlugKey = normalizeCompactKey(model.slug)
  const variantNameKey = normalizeCompactKey(variant.name)
  const variantTokens = tokenizeLooseText([variant.name, variant.color, variant.size].filter(Boolean).join(' '))
  const modelTokens = tokenizeLooseText([model.name, model.slug].filter(Boolean).join(' '))

  let score = 0

  if (!model.is_active) score -= 20
  if (model.is_featured) score += 4

  if (variantNameKey && (variantNameKey === modelNameKey || variantNameKey === modelSlugKey)) {
    score += 120
  }

  if (variantNameKey && modelNameKey && (variantNameKey.includes(modelNameKey) || modelNameKey.includes(variantNameKey))) {
    score += 60
  }

  if (variantNameKey && modelSlugKey && (variantNameKey.includes(modelSlugKey) || modelSlugKey.includes(variantNameKey))) {
    score += 50
  }

  const sharedTokens = countSharedTokens(modelTokens, variantTokens)
  score += sharedTokens * 15

  if (String(model.name || '').trim().length > 0 && String(variant.name || '').trim().length > 0) {
    const left = String(model.name).trim().toLowerCase()
    const right = String(variant.name).trim().toLowerCase()
    if (left === right) score += 80
  }

  return score
}

export function getStoreModelSuggestions(
  models: StoreProductModelRow[],
  variant: ModelSuggestionVariantLike,
  limit = 3
) {
  return [...models]
    .map((model) => ({ model, score: scoreStoreModelSuggestion(model, variant) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (Number(a.model.sort_order || 0) !== Number(b.model.sort_order || 0)) {
        return Number(a.model.sort_order || 0) - Number(b.model.sort_order || 0)
      }
      return String(a.model.name || '').localeCompare(String(b.model.name || ''), 'en', { sensitivity: 'base' })
    })
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.model)
}


export function buildStoreModelOptionLabel(item: Pick<StoreProductModelRow, 'name' | 'slug' | 'is_active'>) {
  const parts = [String(item.name || '').trim()]
  if (item.slug && item.slug !== item.name) parts.push(`(${item.slug})`)
  if (!item.is_active) parts.push('inactive')
  return parts.filter(Boolean).join(' ')
}
export function sortStoreModels<T extends Pick<StoreProductModelRow, 'sort_order' | 'name'>>(items: T[]) {
  return [...items].sort((a, b) => {
    const sortDelta = Number(a.sort_order || 0) - Number(b.sort_order || 0)
    if (sortDelta !== 0) return sortDelta
    return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
  })
}
