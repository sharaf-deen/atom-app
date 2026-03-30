export type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

type TimeRevenueRow = {
  plan: Plan | null
  amount: number | null
  amount_due?: number | null
  paid_at?: string | null
  start_date?: string | null
  end_date?: string | null
  frozen_from?: string | null
  frozen_until?: string | null
}

function isISODateOnly(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function daysBetween(startDateOnly: string, endDateOnlyExclusive: string) {
  const start = new Date(`${startDateOnly}T00:00:00Z`).getTime()
  const end = new Date(`${endDateOnlyExclusive}T00:00:00Z`).getTime()
  return Math.max(0, Math.floor((end - start) / 86400000))
}

function minDate(a: string, b: string) {
  return a <= b ? a : b
}

function maxDate(a: string, b: string) {
  return a >= b ? a : b
}

function firstOfMonth(dateOnly: string) {
  return `${dateOnly.slice(0, 7)}-01`
}

function firstOfNextMonth(dateOnly: string) {
  const [y, m] = dateOnly.slice(0, 7).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, 1))
  dt.setUTCMonth(dt.getUTCMonth() + 1)
  return dt.toISOString().slice(0, 10)
}

function monthKey(dateOnly: string) {
  return dateOnly.slice(0, 7)
}

function buildMonthMap(from: string, to: string) {
  const map = new Map<string, number>()
  let cursor = firstOfMonth(from)
  const endExclusive = firstOfNextMonth(to)
  while (cursor < endExclusive) {
    map.set(monthKey(cursor), 0)
    cursor = firstOfNextMonth(cursor)
  }
  return map
}

function addToMonthBuckets(
  monthTotals: Map<string, number>,
  fromInclusive: string,
  toExclusive: string,
  amountPerDay: number,
) {
  let cursor = fromInclusive
  while (cursor < toExclusive) {
    const bucketEnd = minDate(firstOfNextMonth(cursor), toExclusive)
    const days = daysBetween(cursor, bucketEnd)
    if (days > 0) {
      const key = monthKey(cursor)
      monthTotals.set(key, (monthTotals.get(key) ?? 0) + amountPerDay * days)
    }
    cursor = bucketEnd
  }
}

function toFixed2(n: number) {
  return Number(n.toFixed(2))
}

function recognizedSegments(row: TimeRevenueRow) {
  if (!isISODateOnly(row.start_date) || !isISODateOnly(row.end_date) || row.start_date >= row.end_date) {
    return [] as Array<{ from: string; to: string }>
  }

  const subStart = row.start_date
  const subEnd = row.end_date
  const freezeFrom = isISODateOnly(row.frozen_from) ? row.frozen_from : null
  const freezeUntil = isISODateOnly(row.frozen_until) ? row.frozen_until : null

  if (!freezeFrom || !freezeUntil || freezeUntil <= freezeFrom || freezeUntil <= subStart || freezeFrom >= subEnd) {
    return [{ from: subStart, to: subEnd }]
  }

  const segments: Array<{ from: string; to: string }> = []
  const cutFrom = maxDate(subStart, freezeFrom)
  const cutTo = minDate(subEnd, freezeUntil)
  if (subStart < cutFrom) segments.push({ from: subStart, to: cutFrom })
  if (cutTo < subEnd) segments.push({ from: cutTo, to: subEnd })
  return segments.filter((seg) => seg.from < seg.to)
}

export function computeRecognizedSubscriptionRevenue(
  rows: TimeRevenueRow[],
  from: string,
  to: string,
) {
  const monthTotals = buildMonthMap(from, to)
  const byPlan: Record<Plan, number> = { '1m': 0, '3m': 0, '6m': 0, '12m': 0, sessions: 0 }
  const rangeEndExclusive = addDays(to, 1)

  for (const row of rows) {
    const plan = row.plan
    if (!plan) continue

    if (plan === 'sessions') {
      const amt = Number(row.amount ?? 0) + Number(row.amount_due ?? 0)
      const paidAt = typeof row.paid_at === 'string' ? row.paid_at.slice(0, 10) : null
      if (!paidAt || !isISODateOnly(paidAt) || paidAt < from || paidAt > to || !Number.isFinite(amt) || amt <= 0) continue
      const key = monthKey(paidAt)
      monthTotals.set(key, (monthTotals.get(key) ?? 0) + amt)
      byPlan.sessions += amt
      continue
    }

    const totalValue = Number(row.amount ?? 0) + Number(row.amount_due ?? 0)
    if (!Number.isFinite(totalValue) || totalValue <= 0) continue

    const segments = recognizedSegments(row)
    const totalActiveDays = segments.reduce((sum, seg) => sum + daysBetween(seg.from, seg.to), 0)
    if (totalActiveDays <= 0) continue

    const amountPerDay = totalValue / totalActiveDays
    for (const seg of segments) {
      const overlapFrom = maxDate(seg.from, from)
      const overlapTo = minDate(seg.to, rangeEndExclusive)
      if (overlapFrom >= overlapTo) continue
      addToMonthBuckets(monthTotals, overlapFrom, overlapTo, amountPerDay)

      let cursor = overlapFrom
      while (cursor < overlapTo) {
        const bucketEnd = minDate(firstOfNextMonth(cursor), overlapTo)
        const days = daysBetween(cursor, bucketEnd)
        if (days > 0) byPlan[plan] += amountPerDay * days
        cursor = bucketEnd
      }
    }
  }

  const monthly = Array.from(monthTotals.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, sum]) => ({ month, sum: toFixed2(sum) }))

  const totalsByPlan = {
    '1m': toFixed2(byPlan['1m']),
    '3m': toFixed2(byPlan['3m']),
    '6m': toFixed2(byPlan['6m']),
    '12m': toFixed2(byPlan['12m']),
    sessions: toFixed2(byPlan.sessions),
  }

  const sum = toFixed2(monthly.reduce((acc, row) => acc + row.sum, 0))
  return { monthly, totalsByPlan, sum }
}
