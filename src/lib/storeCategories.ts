// src/lib/storeCategories.ts
export const PRODUCT_CATEGORIES = ['kimono', 'rashguard', 'short', 'belt'] as const
export type ProductCategory = typeof PRODUCT_CATEGORIES[number]
