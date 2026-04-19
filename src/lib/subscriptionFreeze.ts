import { addDaysDateOnly, cairoTodayDateOnly, isISODateOnly } from '@/lib/cairoTime'

export type FreezeEligiblePlan = '3m' | '6m' | '12m'
export type FreezeSubscriptionType = 'time' | 'sessions' | null | undefined
export type SubscriptionFreezeActiveState = 'active' | 'scheduled' | null

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
  activeState: SubscriptionFreezeActiveState
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

export function isSubscriptionFreezeDeleted(
  row: Pick<SubscriptionFreezeHistoryRow, 'cleared_at'> | null | undefined,
): boolean {
  return !!row?.cleared_at
}

export function isSubscriptionFreezeOpen(
  row: Pick<SubscriptionFreezeHistoryRow, 'freeze_until' | 'cleared_at'> | null | undefined,
  todayDateOnly = cairoTodayDateOnly(),
): boolean {
  if (!row || isSubscriptionFreezeDeleted(row)) return false
  return !!row.freeze_until && isISODateOnly(row.freeze_until) && row.freeze_until > todayDateOnly
}

export function getSubscriptionFreezeActiveState(
  row: Pick<SubscriptionFreezeHistoryRow, 'freeze_from' | 'freeze_until' | 'cleared_at'> | null | undefined,
  todayDateOnly = cairoTodayDateOnly(),
): SubscriptionFreezeActiveState {
  if (!isSubscriptionFreezeOpen(row, todayDateOnly)) return null
  if (row?.freeze_from && isISODateOnly(row.freeze_from) && row.freeze_from > todayDateOnly) return 'scheduled'
  return 'active'
}

export function getConsumptiveSubscriptionFreezeHistory(
  freezeRows?: SubscriptionFreezeHistoryRow[] | null,
): SubscriptionFreezeHistoryRow[] {
  const rows = Array.isArray(freezeRows) ? [...freezeRows] : []

  return rows
    .filter((row) => !isSubscriptionFreezeDeleted(row))
    .sort((a, b) => {
      const aFrom = a.freeze_from ?? ''
      const bFrom = b.freeze_from ?? ''
      if (aFrom !== bFrom) return bFrom.localeCompare(aFrom)
      const aCreated = a.created_at ?? ''
      const bCreated = b.created_at ?? ''
      return bCreated.localeCompare(aCreated)
    })
}

export function sumConsumptiveSubscriptionFreezeDays(
  freezeRows?: Pick<SubscriptionFreezeHistoryRow, 'days' | 'cleared_at'>[] | null,
): number {
  const rows = Array.isArray(freezeRows) ? freezeRows : []
  return rows.reduce((sum, row) => {
    if (isSubscriptionFreezeDeleted(row)) return sum
    const days = Number(row.days ?? 0)
    return sum + (Number.isFinite(days) && days > 0 ? days : 0)
  }, 0)
}

export function subscriptionFreezeRangesOverlap(
  left: Pick<SubscriptionFreezeHistoryRow, 'freeze_from' | 'freeze_until'>,
  right: Pick<SubscriptionFreezeHistoryRow, 'freeze_from' | 'freeze_until'>,
): boolean {
  if (!isISODateOnly(left.freeze_from) || !isISODateOnly(left.freeze_until)) return false
  if (!isISODateOnly(right.freeze_from) || !isISODateOnly(right.freeze_until)) return false
  return left.freeze_from < right.freeze_until && right.freeze_from < left.freeze_until
}

export function pickSubscriptionSurfaceFreezeRow(
  freezeRows?: SubscriptionFreezeHistoryRow[] | null,
  todayDateOnly = cairoTodayDateOnly(),
): SubscriptionFreezeHistoryRow | null {
  const history = getConsumptiveSubscriptionFreezeHistory(freezeRows)
  const active = history.find((row) => getSubscriptionFreezeActiveState(row, todayDateOnly) === 'active') ?? null
  if (active) return active

  const scheduled = history
    .filter((row) => getSubscriptionFreezeActiveState(row, todayDateOnly) === 'scheduled')
    .sort((a, b) => {
      const aFrom = a.freeze_from ?? ''
      const bFrom = b.freeze_from ?? ''
      if (aFrom !== bFrom) return aFrom.localeCompare(bFrom)
      const aCreated = a.created_at ?? ''
      const bCreated = b.created_at ?? ''
      return aCreated.localeCompare(bCreated)
    })[0] ?? null

  return scheduled
}

export function buildSubscriptionFreezeTokenSummary(args: {
  plan: string | null | undefined
  subscriptionType?: FreezeSubscriptionType
  freezeRows?: SubscriptionFreezeHistoryRow[] | null
  todayDateOnly?: string
}): SubscriptionFreezeTokenSummary {
  const allowed = getFreezeTokenAllowance(args.plan, args.subscriptionType)
  const history = getConsumptiveSubscriptionFreezeHistory(args.freezeRows)
  const todayDateOnly = args.todayDateOnly ?? cairoTodayDateOnly()
  const active = pickSubscriptionSurfaceFreezeRow(history, todayDateOnly)
  const activeState = getSubscriptionFreezeActiveState(active, todayDateOnly)
  const used = history.length
  const remaining = Math.max(allowed - used, 0)

  return {
    eligible: allowed > 0,
    allowed,
    used,
    remaining,
    active,
    activeState,
    history,
  }
}
