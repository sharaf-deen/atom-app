export type RangePreset = 'today' | '7d' | 'month' | 'custom'

export type ExpenseFilterState = {
  preset: RangePreset
  from: string
  to: string
  category: string
  payment_method: string
  qRaw: string
  qText: string
  page: number
}

export function parsePositiveInt(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function toISODate(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(d: Date, days: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function parsePreset(v: unknown): RangePreset {
  return v === 'today' || v === '7d' || v === 'month' || v === 'custom' ? v : 'month'
}

export function safeStr(v: unknown) {
  return typeof v === 'string' ? v : ''
}

export function sanitizeExpenseSearch(v: string) {
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildQS(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) sp.set(k, String(v))
  }
  return sp.toString()
}

export function parseExpenseFilters(searchParams: Record<string, string | string[] | undefined>, now = new Date()): ExpenseFilterState {
  const preset = parsePreset(typeof searchParams.preset === 'string' ? searchParams.preset : 'month')

  let from = safeStr(searchParams.from)
  let to = safeStr(searchParams.to)

  if (preset === 'today') {
    from = toISODate(now)
    to = from
  } else if (preset === '7d') {
    to = toISODate(now)
    from = toISODate(addDays(now, -6))
  } else if (preset === 'month') {
    from = toISODate(startOfMonth(now))
    to = toISODate(endOfMonth(now))
  } else {
    if (!from) from = toISODate(startOfMonth(now))
    if (!to) to = toISODate(endOfMonth(now))
  }

  const category = typeof searchParams.category === 'string' ? searchParams.category : 'all'
  const payment_method = typeof searchParams.payment_method === 'string' ? searchParams.payment_method : 'all'
  const qRaw = typeof searchParams.q === 'string' ? searchParams.q : ''
  const qText = sanitizeExpenseSearch(qRaw)
  const page = parsePositiveInt(searchParams.page, 1)

  return { preset, from, to, category, payment_method, qRaw, qText, page }
}

export function expensePresetLabel(preset: RangePreset) {
  if (preset === 'today') return 'Today'
  if (preset === '7d') return 'Last 7 days'
  if (preset === 'month') return 'This month'
  return 'Custom'
}

export function expensePaymentLabel(v: string) {
  if (v === 'cash') return 'Cash'
  if (v === 'visa') return 'Visa card'
  if (v === 'instapay') return 'Instapay'
  if (v === 'bank_transfer') return 'Bank transfer'
  return 'All payments'
}
