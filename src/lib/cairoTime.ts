// src/lib/cairoTime.ts

export const CAIRO_TZ = 'Africa/Cairo'

export function isISODateOnly(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * Returns today's date in Cairo as YYYY-MM-DD.
 * Uses Intl with a fixed timeZone to avoid server UTC drift.
 */
export function cairoTodayDateOnly(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }

  return `${map.year ?? '1970'}-${map.month ?? '01'}-${map.day ?? '01'}`
}

export function addDaysDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function tzOffsetMillis(utcDate: Date, timeZone: string): number {
  // Convert the *formatted* local time parts back into a UTC timestamp, then compare.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = dtf.formatToParts(utcDate)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }

  const year = Number(map.year)
  const month = Number(map.month)
  const day = Number(map.day)
  const hour = Number(map.hour)
  const minute = Number(map.minute)
  const second = Number(map.second)

  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second)
  return asUTC - utcDate.getTime()
}

/**
 * Convert a Cairo local wall-clock time to the corresponding UTC Date.
 * Uses a small iterative correction to handle DST offset changes.
 */
export function cairoLocalToUTC(args: {
  dateOnly: string
  hour?: number
  minute?: number
  second?: number
}): Date {
  const { dateOnly, hour = 0, minute = 0, second = 0 } = args
  const [y, m, d] = dateOnly.split('-').map(Number)

  const guess = Date.UTC(y, m - 1, d, hour, minute, second)
  let utc = guess - tzOffsetMillis(new Date(guess), CAIRO_TZ)

  const off2 = tzOffsetMillis(new Date(utc), CAIRO_TZ)
  const utc2 = guess - off2
  if (utc2 !== utc) utc = utc2

  return new Date(utc)
}

/**
 * Get UTC ISO bounds [start, end) for a Cairo calendar day.
 */
export function cairoDayBoundsUTC(dateOnly: string): { startISO: string; endISO: string } {
  const start = cairoLocalToUTC({ dateOnly, hour: 0, minute: 0, second: 0 })
  const next = addDaysDateOnly(dateOnly, 1)
  const end = cairoLocalToUTC({ dateOnly: next, hour: 0, minute: 0, second: 0 })
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

/**
 * Get UTC ISO bounds [start, end) for a Cairo date range (inclusive).
 * Example: from=2026-02-01, to=2026-02-07 -> bounds cover 7 Cairo calendar days.
 */
export function cairoRangeBoundsUTC(fromDateOnly: string, toDateOnly: string): { startISO: string; endISO: string } {
  const start = cairoLocalToUTC({ dateOnly: fromDateOnly, hour: 0, minute: 0, second: 0 })
  const afterTo = addDaysDateOnly(toDateOnly, 1)
  const end = cairoLocalToUTC({ dateOnly: afterTo, hour: 0, minute: 0, second: 0 })
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

function dayOfWeekISO(dateOnly: string): number {
  // 1..7 (Mon..Sun)
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  // JS: 0=Sun..6=Sat
  const js = dt.getUTCDay()
  return js === 0 ? 7 : js
}

/**
 * Returns Cairo week bounds (Mon..Sun) for the week containing the given date.
 */
export function cairoWeekBoundsDateOnly(anchorDateOnly: string): { from: string; to: string } {
  const isoDow = dayOfWeekISO(anchorDateOnly) // 1..7
  const deltaToMonday = isoDow - 1
  const from = addDaysDateOnly(anchorDateOnly, -deltaToMonday)
  const to = addDaysDateOnly(from, 6)
  return { from, to }
}

/**
 * Returns Cairo month bounds for the month containing the given date.
 */
export function cairoMonthBoundsDateOnly(anchorDateOnly: string): { from: string; to: string } {
  const ym = anchorDateOnly.slice(0, 7) // YYYY-MM
  const from = `${ym}-01`
  const [y, m] = ym.split('-').map(Number)
  const nextMonthY = m === 12 ? y + 1 : y
  const nextMonthM = m === 12 ? 1 : m + 1
  const nextMonthStart = `${String(nextMonthY).padStart(4, '0')}-${String(nextMonthM).padStart(2, '0')}-01`
  const to = addDaysDateOnly(nextMonthStart, -1)
  return { from, to }
}

export function formatDateTimeInCairo(value?: string | Date | null, fallback = '—'): string {
  if (!value) return fallback

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : fallback
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }

  const year = map.year ?? '0000'
  const month = map.month ?? '00'
  const day = map.day ?? '00'
  const hour = map.hour ?? '00'
  const minute = map.minute ?? '00'
  const second = map.second ?? '00'

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}
