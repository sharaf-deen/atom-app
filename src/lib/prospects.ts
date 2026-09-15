export const PROSPECT_STATUSES = [
  'new',
  'contacted',
  'awaiting_reply',
  'trial_booked',
  'trial_completed',
  'joined',
  'lost',
] as const

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

export const PROSPECT_LOST_REASONS = [
  'no_response',
  'not_interested',
  'invalid',
  'spam',
  'other',
] as const

export type ProspectLostReason = (typeof PROSPECT_LOST_REASONS)[number]

export type ProspectSource = 'contact_us' | 'visitor_information' | 'unknown'

export type GmailBackfillMessage = {
  id?: string
  message_id?: string
  thread_id?: string
  subject?: string
  body?: unknown
  snippet?: string
  email_ts?: string
  from_?: string
  to?: string[] | string
  labels?: string[]
  [key: string]: unknown
}

export type ParsedWebsiteLead = {
  full_name: string
  email: string
  phone: string
  source: ProspectSource
  requested_classes: string[]
  level: string
  goals: string[]
  message: string
}

export function normalizeProspectEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeProspectPhoneDigits(value: unknown) {
  let digits = String(value ?? '').replace(/\D+/g, '')
  if (!digits) return ''

  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `20${digits.slice(1)}`
  }

  return digits
}

export function normalizeProspectWhatsappDigits(value: unknown) {
  return normalizeProspectPhoneDigits(value)
}

export function sanitizeProspectText(value: unknown, max = 500) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max)
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripHtml(value: string) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
}

function extractBody(input: GmailBackfillMessage) {
  const body = input.body
  if (typeof body === 'string' && body.trim()) return stripHtml(body)
  if (body && typeof body === 'object') {
    const candidate = body as Record<string, unknown>
    for (const key of ['text', 'plain', 'content', 'html']) {
      if (typeof candidate[key] === 'string' && String(candidate[key]).trim()) {
        return stripHtml(String(candidate[key]))
      }
    }
  }
  return stripHtml(String(input.snippet ?? ''))
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => sanitizeProspectText(item, 120))
    .filter(Boolean)
}

function extractFields(raw: string) {
  const normalized = raw
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const keys = ['From', 'Email', 'Tel', 'Class', 'Level', 'Goal', 'Message'] as const
  const out: Record<string, string> = {}

  for (const key of keys) {
    const otherKeys = keys.filter((candidate) => candidate !== key).join('|')
    const re = new RegExp(
      `(?:^|\\s)${key}:\\s*(.*?)(?=\\s(?:${otherKeys}):|\\s--\\s|\\sThis e-mail was sent|$)`,
      'i',
    )
    const match = normalized.match(re)
    if (match?.[1]) out[key] = sanitizeProspectText(match[1], key === 'Message' ? 2000 : 500)
  }

  return out
}

export function parseWebsiteFormEmail(input: GmailBackfillMessage): ParsedWebsiteLead | null {
  const raw = extractBody(input)
  if (!raw) return null

  const fields = extractFields(raw)
  const full_name = sanitizeProspectText(fields.From, 180)
  const email = normalizeProspectEmail(fields.Email)
  const phone = sanitizeProspectText(fields.Tel, 60)

  if (!full_name || (!email && !phone)) return null

  const requested_classes = fields.Class ? splitCsv(fields.Class) : []
  const level = sanitizeProspectText(fields.Level, 80)
  const goals = fields.Goal ? splitCsv(fields.Goal) : []
  const message = sanitizeProspectText(fields.Message, 2000)

  const source: ProspectSource =
    requested_classes.length || level || goals.length
      ? 'visitor_information'
      : message
        ? 'contact_us'
        : 'unknown'

  return {
    full_name,
    email,
    phone,
    source,
    requested_classes,
    level,
    goals,
    message,
  }
}

export function isProspectStatus(value: unknown): value is ProspectStatus {
  return typeof value === 'string' && (PROSPECT_STATUSES as readonly string[]).includes(value)
}

export function isProspectLostReason(value: unknown): value is ProspectLostReason {
  return typeof value === 'string' && (PROSPECT_LOST_REASONS as readonly string[]).includes(value)
}
