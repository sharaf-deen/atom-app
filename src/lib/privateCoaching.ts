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
