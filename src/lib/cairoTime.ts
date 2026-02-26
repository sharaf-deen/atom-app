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
  // en-CA reliably formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
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
