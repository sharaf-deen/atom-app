export const PRIVATE_COACHING_INSTAPAY_NUMBER = '01558667512'

export type PrivateCoachingPackageSessions = 1 | 5 | 10
export type PrivateCoachingPaymentMethod = 'cash' | 'instapay'
export type PrivateCoachingRequestStatus = 'payment_pending' | 'active' | 'cancelled'
export type PrivateCoachingPassStatus = 'active' | 'depleted' | 'cancelled'

export const PRIVATE_COACHING_PACKAGES: Array<{
  sessions: PrivateCoachingPackageSessions
  label: string
  amountCents: number
  highlight?: string
}> = [
  { sessions: 1, label: '1 session', amountCents: 150000 },
  { sessions: 5, label: '5 sessions', amountCents: 650000, highlight: 'Best for steady progress' },
  { sessions: 10, label: '10 sessions', amountCents: 1100000, highlight: 'Best value' },
]

export const PRIVATE_COACHING_ALLOWED_MEMBER_ROLES = ['member', 'champion', 'vip'] as const
export const PRIVATE_COACHING_MANAGER_ROLES = ['head_coach', 'super_admin'] as const

export type PrivateCoachingPromoSnapshot = {
  code: string
  title?: string | null
  discountPercent: number
}

export function isPrivateCoachingPackageSessions(value: unknown): value is PrivateCoachingPackageSessions {
  const n = Number(value)
  return n === 1 || n === 5 || n === 10
}

export function privateCoachingPackageBySessions(sessions: PrivateCoachingPackageSessions) {
  return PRIVATE_COACHING_PACKAGES.find((item) => item.sessions === sessions) ?? PRIVATE_COACHING_PACKAGES[0]
}

export function isPrivateCoachingPaymentMethod(value: unknown): value is PrivateCoachingPaymentMethod {
  return value === 'cash' || value === 'instapay'
}

export function privateCoachingPaymentMethodLabel(value: PrivateCoachingPaymentMethod | string | null | undefined) {
  if (value === 'instapay') return 'Instapay'
  return 'Cash at reception'
}

export function privateCoachingStatusLabel(status: PrivateCoachingRequestStatus | PrivateCoachingPassStatus | string | null | undefined) {
  switch (status) {
    case 'payment_pending':
      return 'Payment pending'
    case 'active':
      return 'Active'
    case 'cancelled':
      return 'Cancelled'
    case 'depleted':
      return 'Depleted'
    default:
      return 'Unknown'
  }
}

export function formatPrivateCoachingMoney(cents: number | null | undefined) {
  const amount = Number(cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(amount)
  } catch {
    return `${amount.toFixed(2)} EGP`
  }
}

export function privateCoachingMemberName(profile: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}) {
  return [profile.first_name ?? '', profile.last_name ?? ''].join(' ').trim() || profile.email || 'Member'
}

export function normalizePrivateCoachingPromoCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

export function normalizePrivateCoachingPromoTitle(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)
}

export function isValidPrivateCoachingPromoCodeFormat(value: unknown) {
  const normalized = normalizePrivateCoachingPromoCode(value)
  return /^[A-Z0-9_-]{2,32}$/.test(normalized)
}

export function normalizePrivateCoachingPromoPercent(value: unknown) {
  const n = Math.round(Number(value ?? 0))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

export function isValidPrivateCoachingPromoPercent(value: unknown) {
  const n = Math.round(Number(value ?? 0))
  return Number.isFinite(n) && n >= 1 && n <= 100
}

export function calculatePrivateCoachingDiscountPricing(amountCents: number, promo?: PrivateCoachingPromoSnapshot | null) {
  const originalAmountCents = Math.max(0, Math.round(Number(amountCents ?? 0)))
  const normalizedCode = normalizePrivateCoachingPromoCode(promo?.code)
  const normalizedTitle = normalizePrivateCoachingPromoTitle(promo?.title)
  const discountPercent = normalizedCode ? normalizePrivateCoachingPromoPercent(promo?.discountPercent) : 0
  const discountAmountCents = normalizedCode && discountPercent > 0
    ? Math.round((originalAmountCents * discountPercent) / 100)
    : 0
  const finalAmountCents = Math.max(0, originalAmountCents - discountAmountCents)

  return {
    originalAmountCents,
    discountCode: normalizedCode || null,
    discountLabel: normalizedTitle || null,
    discountPercent: discountAmountCents > 0 ? discountPercent : 0,
    discountAmountCents,
    finalAmountCents,
  }
}

export function privateCoachingPromoSummary(
  code?: string | null,
  discountPercent?: number | null,
  discountAmountCents?: number | null,
  discountLabel?: string | null,
) {
  const normalized = normalizePrivateCoachingPromoCode(code)
  const label = normalizePrivateCoachingPromoTitle(discountLabel)
  const percent = Number(discountPercent ?? 0)
  const discount = Number(discountAmountCents ?? 0)

  if (!normalized || percent <= 0 || discount <= 0) return 'No promo code'
  return [label || null, normalized, `${percent}% off`, `${formatPrivateCoachingMoney(discount)} discount`]
    .filter(Boolean)
    .join(' · ')
}

export type PrivateCoachingSlotStatus = 'available' | 'booked' | 'cancelled'
export type PrivateCoachingBookingStatus = 'booked' | 'completed' | 'cancelled'

export function privateCoachingSlotStatusLabel(status: PrivateCoachingSlotStatus | string | null | undefined) {
  switch (status) {
    case 'available':
      return 'Available'
    case 'booked':
      return 'Booked'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

export function privateCoachingBookingStatusLabel(status: PrivateCoachingBookingStatus | string | null | undefined) {
  switch (status) {
    case 'booked':
      return 'Booked'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

export function isValidPrivateCoachingSlotDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime())
}

export function isValidPrivateCoachingSlotTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
}

export function formatPrivateCoachingSlotTime(value?: string | null) {
  if (!value) return '—'
  const [hour = '', minute = ''] = String(value).split(':')
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}
