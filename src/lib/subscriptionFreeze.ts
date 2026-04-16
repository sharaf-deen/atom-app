import { addDaysDateOnly, isISODateOnly } from '@/lib/cairoTime'

export type FreezeEligiblePlan = '3m' | '6m' | '12m'
export type FreezeSubscriptionType = 'time' | 'sessions' | null | undefined

export type SubscriptionFreezeHistoryRow = {
  id: string
  subscription_id?: string | null
  freeze_from: string | null
  freeze_until: string | null
  days: number | null
  created_at?: string | null
  created_by?: string | null
  updated_at?: string | null
  updated_by?: string | null
  cleared_at?: string | null
  cleared_by?: string | null
}

export type SubscriptionFreezeTokenSummary = {
  eligible: boolean
  allowed: number
  used: number
  remaining: number
  active: SubscriptionFreezeHistoryRow | null
  history: SubscriptionFreezeHistoryRow[]
}

const FREEZE_TOKENS_BY_PLAN: Record<FreezeEligiblePlan, number> = {
  '3m': 1,
  '6m': 2,
  '12m': 3,
}

export function getFreezeTokenAllowance(plan: string | null | undefined, subscriptionType?: FreezeSubscriptionType): number {
  if (subscriptionType && subscriptionType !== 'time') return 0
  if (plan === '3m' || plan === '6m' || plan === '12m') return FREEZE_TOKENS_BY_PLAN[plan]
  return 0
}

export function canUseFreezePlan(plan: string | null | undefined, subscriptionType?: FreezeSubscriptionType): boolean {
  return getFreezeTokenAllowance(plan, subscriptionType) > 0
}

export function freezePlanSummaryLabel(plan: string | null | undefined, subscriptionType?: FreezeSubscriptionType): string {
  const allowed = getFreezeTokenAllowance(plan, subscriptionType)
  if (allowed <= 0) return 'Not eligible for freeze'
  if (plan === '3m') return '3 months: 1 freeze token'
  if (plan === '6m') return '6 months: 2 freeze tokens'
  return '12 months: 3 freeze tokens'
}

export function toInclusiveFreezeEnd(exclusiveEndDateOnly: string | null | undefined): string | null {
  if (!exclusiveEndDateOnly || !isISODateOnly(exclusiveEndDateOnly)) return null
  return addDaysDateOnly(exclusiveEndDateOnly, -1)
}

export function buildSubscriptionFreezeTokenSummary(args: {
  plan: string | null | undefined
  subscriptionType?: FreezeSubscriptionType
  freezeRows?: SubscriptionFreezeHistoryRow[] | null
}): SubscriptionFreezeTokenSummary {
  const allowed = getFreezeTokenAllowance(args.plan, args.subscriptionType)
  const history = Array.isArray(args.freezeRows) ? [...args.freezeRows] : []
  const active = history.find((row) => row && !row.cleared_at) ?? null
  const used = history.length
  const remaining = Math.max(allowed - used, 0)

  return {
    eligible: allowed > 0,
    allowed,
    used,
    remaining,
    active,
    history,
  }
}
