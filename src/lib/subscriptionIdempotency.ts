import { createHash } from 'crypto'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(object).sort()) {
      if (key !== 'idempotency_key' && object[key] !== undefined) result[key] = canonicalize(object[key])
    }
    return result
  }
  return value
}

export function subscriptionRequestFingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex')
}

export function parseSubscriptionRequestKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null
}
