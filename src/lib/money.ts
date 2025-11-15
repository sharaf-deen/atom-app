// src/lib/money.ts

/** Convert cents -> "123.45" (always two decimals) */
export function toPriceString(cents: number | null | undefined): string {
  const v = Number(cents ?? 0) / 100
  return v.toFixed(2)
}

/** Parse "123.45" or "123,45" -> cents (integer). Invalid -> 0 */
export function parsePriceToCents(input: string): number {
  if (!input) return 0
  const n = Number(String(input).replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Format cents to a currency string (Intl) */
export function formatCurrency(
  cents: number | null | undefined,
  locale = 'en-EG',
  currency: string | null | undefined = 'EGP'
): string {
  const amount = Number(cents ?? 0) / 100
  const cur = currency || 'EGP'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(amount)
  } catch {
    // fallback if currency code is not supported on the runtime
    return `${amount.toFixed(2)} ${cur}`
  }
}
