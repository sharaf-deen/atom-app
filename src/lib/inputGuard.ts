export function clampInt(raw: unknown, def: number, min: number, max: number) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function isISODateOnly(value?: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function sanitizeText(raw: unknown, opts?: { max?: number; allowNewlines?: boolean }) {
  const max = Math.max(1, Math.floor(opts?.max ?? 120))
  const allowNewlines = !!opts?.allowNewlines
  const base = String(raw ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, ' ')

  const normalized = allowNewlines
    ? base
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : base.replace(/\s+/g, ' ').trim()

  return normalized.slice(0, max)
}

export function sanitizeSearch(raw: unknown, opts?: { max?: number }) {
  return sanitizeText(raw, { max: opts?.max ?? 80, allowNewlines: false }).replace(/[,]/g, ' ').trim()
}

export function normalizeEmail(raw: unknown) {
  return sanitizeText(raw, { max: 254, allowNewlines: false }).toLowerCase()
}

export function sanitizePhone(raw: unknown, max = 32) {
  return sanitizeText(raw, { max, allowNewlines: false }).replace(/[^0-9+()\-\s]/g, '').trim()
}

export function isSimpleKey(value: string, max = 64) {
  return /^[a-z0-9_\-]+$/i.test(value) && value.length > 0 && value.length <= max
}
