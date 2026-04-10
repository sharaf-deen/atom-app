export const STORE_PRODUCT_IMAGE_BUCKET = 'store-product-images'
export const STORE_PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function normalizeStoreProductFileName(name: string) {
  return (name || 'product-image')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'product-image'
}

export function inferStoreProductImageMime(file: Pick<File, 'type' | 'name'>) {
  const rawType = String(file?.type || '').toLowerCase().trim()
  if (ALLOWED_MIME.has(rawType)) return rawType

  const lower = String(file?.name || '').toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return ''
}

export function buildStoreProductImagePath(productId: string, fileName: string) {
  const safe = normalizeStoreProductFileName(fileName)
  return `products/${productId}/${Date.now()}-${safe}`
}
