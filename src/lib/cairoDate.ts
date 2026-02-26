// src/lib/cairoDate.ts
// Helpers for date math in Egypt local time (Africa/Cairo)

export const CAIRO_TZ = 'Africa/Cairo'

/**
 * Format a Date into a YYYY-MM-DD string in a given IANA time zone.
 * Uses en-CA to get ISO-like date format.
 */
export function dateInTimeZone(date: Date, timeZone: string = CAIRO_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Today's date in Cairo as YYYY-MM-DD */
export function cairoToday(): string {
  return dateInTimeZone(new Date(), CAIRO_TZ)
}

/** Add calendar days to a YYYY-MM-DD date string (UTC-safe). */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Difference in days between two YYYY-MM-DD date strings (to - from). */
export function diffDays(fromDateStr: string, toDateStr: string): number {
  const a = new Date(`${fromDateStr}T00:00:00Z`).getTime()
  const b = new Date(`${toDateStr}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86400000)
}

/** Clamp number to a safe integer range. */
export function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.trunc(n) : min
  return Math.min(max, Math.max(min, x))
}
