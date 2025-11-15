// lib/pricing.ts
import type { Role } from './session'

export function roleDiscountPercent(role: Role): number {
  if (role === 'coach') return 30
  if (role === 'assistant_coach') return 20
  return 0
}

export function priceAfterDiscount(baseCents: number, role: Role): number {
  const d = roleDiscountPercent(role)
  return Math.round(baseCents * (100 - d) / 100)
}
