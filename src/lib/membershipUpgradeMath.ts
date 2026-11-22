/** Pure upgrade math; no monetary transaction or ledger changes. */
export type UpgradePlan = '1w' | '1m' | '3m' | '6m' | '12m'
const ORDER: UpgradePlan[] = ['1w','1m','3m','6m','12m']
export function isUpgradePlan(value: unknown): value is UpgradePlan {
  return typeof value === 'string' && ORDER.includes(value as UpgradePlan)
}
export function isHigherPlan(current: UpgradePlan, target: UpgradePlan): boolean {
  return ORDER.indexOf(target) > ORDER.indexOf(current)
}
export function daysInclusive(start: string, end: string): number {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('INVALID_DATE')
    const timestamp = Date.parse(value + 'T00:00:00Z')
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value) throw new Error('INVALID_DATE')
    return timestamp
  }
  return Math.round((parse(end) - parse(start))/86400000) + 1
}
export function quoteUpgrade(input: {
  startDate: string
  endDate: string
  effectiveDate: string
  capturedPaidEGP: number
  targetPriceEGP: number
}) {
  const {startDate,endDate,effectiveDate,capturedPaidEGP,targetPriceEGP}=input
  if (![capturedPaidEGP,targetPriceEGP].every(n=>Number.isFinite(n) && n>=0)) throw new Error('INVALID_AMOUNT')
  const totalDays=daysInclusive(startDate,endDate)
  const daysRemaining=daysInclusive(effectiveDate,endDate)
  if (totalDays<=0 || daysRemaining<=0 || daysRemaining>totalDays) throw new Error('SUBSCRIPTION_NOT_CURRENT')
  const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100
  const creditEGP=round(capturedPaidEGP*daysRemaining/totalDays)
  if (creditEGP>targetPriceEGP) throw new Error('CREDIT_EXCEEDS_TARGET_PRICE_REVIEW_REQUIRED')
  return {
    totalDays,daysRemaining,
    capturedPaidEGP:round(capturedPaidEGP),
    creditEGP,
    targetPriceEGP:round(targetPriceEGP),
    paymentDueEGP:round(targetPriceEGP-creditEGP),
    effectiveDate,
  }
}
