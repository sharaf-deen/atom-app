export type MembershipPlan = '1w' | '1m' | '3m' | '6m' | '12m' | 'sessions'
export type SellableMembershipPlan = Exclude<MembershipPlan, 'sessions'>

export const SELLABLE_MEMBERSHIP_PLANS: ReadonlyArray<{ value: SellableMembershipPlan; label: string }> = [
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '12m', label: '12 months' },
]

export function membershipPlanLabel(plan?: string | null) {
  switch (plan) {
    case '1w': return '1 week'
    case '1m': return '1 month'
    case '3m': return '3 months'
    case '6m': return '6 months'
    case '12m': return '12 months'
    case 'sessions': return 'Legacy sessions'
    default: return plan ? String(plan) : 'Membership'
  }
}

export function isSellableMembershipPlan(plan?: string | null): plan is SellableMembershipPlan {
  return plan === '1w' || plan === '1m' || plan === '3m' || plan === '6m' || plan === '12m'
}
