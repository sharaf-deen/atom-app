/**
 * One authority for classifying subscription editor changes.
 * Values sent unchanged by an older client must never count as real edits.
 * Payment recording, plan upgrades and freeze operations use separate APIs.
 */
export type SubscriptionEditSnapshot = {
 plan: string | null
 start_date: string | null
 end_date: string | null
 status: string | null
 sessions_total: number | null
 amount: number | null
 amount_due: number | null
 payment_method: string | null
}

export function changedSubscriptionFields(
 current: SubscriptionEditSnapshot,
 update: Partial<SubscriptionEditSnapshot>,
): string[] {
 const keys = [
  'plan', 'start_date', 'end_date', 'status', 'sessions_total',
  'amount', 'amount_due', 'payment_method',
 ] as const
 return keys.filter(key => {
  if (update[key] === undefined) return false
  if (key === 'amount' || key === 'amount_due' || key === 'sessions_total') {
   return Number(update[key] ?? 0) !== Number(current[key] ?? 0)
  }
  return (update[key] ?? null) !== (current[key] ?? null)
 })
}

export function classifySubscriptionEdit(fields: readonly string[]) {
 const financial = fields.some(key => ['amount','amount_due','payment_method'].includes(key))
 const contract = fields.some(key => ['plan','start_date','end_date','sessions_total','status'].includes(key))
 return {financial,contract,sensitive:financial || contract}
}

/**
 * No normal Edit may reprice an existing payment, replace an invoice or
 * revalue an upgraded contract. Special correction workflows retain their own audits.
 */
export function subscriptionEditConflict(args: {
 changes: readonly string[]
 hasPayments: boolean
 hasInvoices: boolean
 hasUpgrades: boolean
 hasRefunds: boolean
 hasFreezes: boolean
 hasOpenRenewals: boolean
}): string | null {
 if (!args.changes.length) return null
 if (args.hasUpgrades) return 'UPGRADED_SUBSCRIPTION_IMMUTABLE'
 if (args.hasRefunds) return 'SUBSCRIPTION_REFUND_REQUIRES_REVIEW'
 if (args.hasInvoices) return 'INVOICED_SUBSCRIPTION_REQUIRES_CORRECTION_WORKFLOW'
 if (args.hasPayments) return 'PAYMENT_LEDGER_CORRECTION_REQUIRED'
 if (args.hasFreezes) return 'FREEZE_HISTORY_CONFLICT'
 if (args.hasOpenRenewals) return 'OPEN_RENEWAL_REQUEST_REQUIRES_REVIEW'
 return null
}
