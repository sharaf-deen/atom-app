import { addDaysDateOnly, isISODateOnly } from '@/lib/cairoTime'

export type SubscriptionRevenueSource = {
  id: string
  member_id: string | null
  plan: string | null
  subscription_type: string | null
  status?: string | null
  start_date: string | null
  end_date: string | null
  amount: number | string | null
  amount_due?: number | string | null
  paid_at?: string | null
  payment_method?: string | null
  frozen_from?: string | null
  frozen_until?: string | null
  freezes?: Array<{ frozen_from?: string | null; frozen_until?: string | null }> | null
}

export type MonthlyRecognitionRow = {
  subscription_id: string
  member_id: string | null
  plan: string
  month: string
  recognized_days: number
  total_service_days: number
  recognized_amount: number
  total_subscription_value: number
  start_date: string
  end_date: string
  frozen_from: string | null
  frozen_until: string | null
}

export type RecognizedBucket = { date: string; sum: number }
export type RecognizedMonthBucket = { month: string; sum: number }

type PlanKey = '1m' | '3m' | '6m' | '12m' | 'sessions'
type TotalsByPlan = Record<PlanKey, number>

export type RecognizedSubscriptionRevenueResult = {
  ok: true
  range: { from: string; to: string; days: number }
  totals: {
    sum: number
    by_plan: TotalsByPlan
  }
  // legacy aliases kept for compatibility with existing routes
  sum: number
  totalsByPlan: TotalsByPlan
  daily: RecognizedBucket[]
  monthly: RecognizedMonthBucket[]
  rows: Array<{
    subscription_id: string | null
    member_id: string | null
    plan: string | null
    month: string
    recognized_amount: number
  }>
}

function toCents(v: number) {
  return Math.round((Number.isFinite(v) ? v : 0) * 100)
}

function centsToAmount(cents: number) {
  return Number((cents / 100).toFixed(2))
}

function monthKey(dateOnly: string) {
  return dateOnly.slice(0, 7)
}

function isTimePlan(plan: string | null | undefined) {
  return plan === '1m' || plan === '3m' || plan === '6m' || plan === '12m'
}

function parseDateOnly(v?: string | null): string | null {
  if (!v) return null
  if (isISODateOnly(v)) return v
  const sliced = String(v).slice(0, 10)
  return isISODateOnly(sliced) ? sliced : null
}

function freezeActiveOn(day: string, frozenFrom: string | null, frozenUntil: string | null) {
  if (!frozenUntil || !isISODateOnly(frozenUntil)) return false
  if (frozenFrom && isISODateOnly(frozenFrom)) {
    return day >= frozenFrom && day < frozenUntil
  }
  return day < frozenUntil
}

function freezeActiveOnAny(day: string, row: SubscriptionRevenueSource) {
  const wins = Array.isArray(row.freezes) ? row.freezes : []
  if (wins.length > 0) {
    for (const win of wins) {
      if (freezeActiveOn(day, parseDateOnly(win?.frozen_from), parseDateOnly(win?.frozen_until))) return true
    }
    return false
  }
  return freezeActiveOn(day, parseDateOnly(row.frozen_from), parseDateOnly(row.frozen_until))
}

export function buildMonthlyRecognitionRows(
  rows: SubscriptionRevenueSource[],
  from: string,
  to: string,
): MonthlyRecognitionRow[] {
  const out: MonthlyRecognitionRow[] = []

  for (const row of rows) {
    const plan = String(row.plan ?? '')
    const start = parseDateOnly(row.start_date)
    const end = parseDateOnly(row.end_date)
    if (!isTimePlan(plan) || !start || !end || start > end) continue

    const totalValue = Number(row.amount ?? 0) + Number(row.amount_due ?? 0)
    const totalCents = toCents(totalValue)
    if (totalCents <= 0) continue

    let totalServiceDays = 0
    for (let d = start; d <= end; d = addDaysDateOnly(d, 1)) {
      if (freezeActiveOnAny(d, row)) continue
      totalServiceDays += 1
    }
    if (totalServiceDays <= 0) continue

    const inRangeByMonth = new Map<string, number>()
    const rangeStart = start > from ? start : from
    const rangeEnd = end < to ? end : to
    if (rangeStart > rangeEnd) continue

    for (let d = rangeStart; d <= rangeEnd; d = addDaysDateOnly(d, 1)) {
      if (freezeActiveOnAny(d, row)) continue
      const m = monthKey(d)
      inRangeByMonth.set(m, (inRangeByMonth.get(m) ?? 0) + 1)
    }

    if (inRangeByMonth.size === 0) continue

    const monthKeys = Array.from(inRangeByMonth.keys()).sort()
    const bases = monthKeys.map((m) => {
      const days = inRangeByMonth.get(m) ?? 0
      const exact = (totalCents * days) / totalServiceDays
      const floor = Math.floor(exact)
      return { month: m, recognizedDays: days, floor, remainder: exact - floor }
    })

    let remaining =
      Math.round((totalCents * bases.reduce((sum, item) => sum + item.recognizedDays, 0)) / totalServiceDays) -
      bases.reduce((sum, item) => sum + item.floor, 0)

    const orderedForRemainder = [...bases]
      .map((item, idx) => ({ ...item, idx }))
      .sort((a, b) => (b.remainder === a.remainder ? a.month.localeCompare(b.month) : b.remainder - a.remainder))

    while (remaining > 0 && orderedForRemainder.length > 0) {
      const target = orderedForRemainder[(remaining - 1) % orderedForRemainder.length]
      bases[target.idx].floor += 1
      remaining -= 1
    }

    for (const item of bases) {
      if (item.floor <= 0) continue
      out.push({
        subscription_id: row.id,
        member_id: row.member_id ?? null,
        plan,
        month: item.month,
        recognized_days: item.recognizedDays,
        total_service_days: totalServiceDays,
        recognized_amount: centsToAmount(item.floor),
        total_subscription_value: centsToAmount(totalCents),
        start_date: start,
        end_date: end,
        frozen_from: parseDateOnly(row.frozen_from),
        frozen_until: parseDateOnly(row.frozen_until),
      })
    }
  }

  return out.sort((a, b) =>
    a.month === b.month ? String(a.subscription_id).localeCompare(String(b.subscription_id)) : a.month.localeCompare(b.month),
  )
}

export function subscriptionRecognitionNotes(view: 'cash' | 'recognized'): string {
  if (view === 'cash') {
    return 'Cash basis uses paid_at within the selected Cairo date range.'
  }
  return 'Monthly recognition spreads time-plan value across active service days. Freeze days pause recognition and shift value forward.'
}

export function computeRecognizedSubscriptionRevenue(...args: any[]): RecognizedSubscriptionRevenueResult {
  let rows: SubscriptionRevenueSource[] = []
  let from = ''
  let to = ''

  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    rows = Array.isArray(args[0].rows) ? args[0].rows : []
    from = String(args[0].from ?? '')
    to = String(args[0].to ?? '')
  } else {
    rows = Array.isArray(args[0]) ? args[0] : []
    from = String(args[1] ?? '')
    to = String(args[2] ?? '')
  }

  const validFrom = parseDateOnly(from)
  const validTo = parseDateOnly(to)
  const safeTo = validTo ?? new Date().toISOString().slice(0, 10)
  const safeFrom = validFrom && validFrom <= safeTo ? validFrom : addDaysDateOnly(safeTo, -29)

  const monthlyRows = buildMonthlyRecognitionRows(rows, safeFrom, safeTo)
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const dailyMap = new Map<string, number>()
  const monthMap = new Map<string, number>()
  const byPlan: TotalsByPlan = {
    '1m': 0,
    '3m': 0,
    '6m': 0,
    '12m': 0,
    sessions: 0,
  }
  const breakdownRows: RecognizedSubscriptionRevenueResult['rows'] = []

  for (let d = safeFrom; d <= safeTo; d = addDaysDateOnly(d, 1)) dailyMap.set(d, 0)

  for (const row of rows) {
    if (row.plan !== 'sessions') continue
    const paidAt = parseDateOnly(row.paid_at)
    const amount = Number(row.amount ?? 0) + Number(row.amount_due ?? 0)
    if (!paidAt || paidAt < safeFrom || paidAt > safeTo || amount <= 0) continue
    dailyMap.set(paidAt, (dailyMap.get(paidAt) ?? 0) + amount)
    const mk = monthKey(paidAt)
    monthMap.set(mk, (monthMap.get(mk) ?? 0) + amount)
    byPlan.sessions += amount
    breakdownRows.push({
      subscription_id: row.id ?? null,
      member_id: row.member_id ?? null,
      plan: row.plan,
      month: mk,
      recognized_amount: Number(amount.toFixed(2)),
    })
  }

  for (const row of monthlyRows) {
    const sourceRow = rowById.get(row.subscription_id)
    const rangeStart = row.start_date > safeFrom ? row.start_date : safeFrom
    const rangeEnd = row.end_date < safeTo ? row.end_date : safeTo
    for (let d = rangeStart; d <= rangeEnd; d = addDaysDateOnly(d, 1)) {
      if (d.slice(0, 7) !== row.month) continue
      if (sourceRow && freezeActiveOnAny(d, sourceRow)) continue
      const perDay = row.recognized_days > 0 ? row.recognized_amount / row.recognized_days : 0
      dailyMap.set(d, Number(((dailyMap.get(d) ?? 0) + perDay).toFixed(6)))
    }
    monthMap.set(row.month, Number(((monthMap.get(row.month) ?? 0) + row.recognized_amount).toFixed(6)))
    if (row.plan === '1m' || row.plan === '3m' || row.plan === '6m' || row.plan === '12m') {
      byPlan[row.plan] += row.recognized_amount
    }
    breakdownRows.push({
      subscription_id: row.subscription_id,
      member_id: row.member_id ?? null,
      plan: row.plan,
      month: row.month,
      recognized_amount: Number(row.recognized_amount.toFixed(2)),
    })
  }

  const daily = Array.from(dailyMap.entries()).map(([date, sum]) => ({ date, sum: Number(sum.toFixed(2)) }))
  const monthly = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, sum]) => ({ month, sum: Number(sum.toFixed(2)) }))
  const total = Number(monthly.reduce((acc, x) => acc + x.sum, 0).toFixed(2))
  const byPlanRounded: TotalsByPlan = {
    '1m': Number(byPlan['1m'].toFixed(2)),
    '3m': Number(byPlan['3m'].toFixed(2)),
    '6m': Number(byPlan['6m'].toFixed(2)),
    '12m': Number(byPlan['12m'].toFixed(2)),
    sessions: Number(byPlan.sessions.toFixed(2)),
  }

  return {
    ok: true,
    range: { from: safeFrom, to: safeTo, days: daily.length },
    totals: {
      sum: total,
      by_plan: byPlanRounded,
    },
    sum: total,
    totalsByPlan: byPlanRounded,
    daily,
    monthly,
    rows: breakdownRows,
  }
}

export function buildRecognizedSubscriptionDailySeries(...args: any[]) {
  return computeRecognizedSubscriptionRevenue(...args).daily
}

export function buildRecognizedSubscriptionMonthlySeries(...args: any[]) {
  return computeRecognizedSubscriptionRevenue(...args).monthly
}
