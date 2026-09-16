export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  normalizeProspectEmail,
  sanitizeProspectText,
  type ProspectSource,
} from '@/lib/prospects'

const MAX_BODY_BYTES = 32 * 1024
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60
const MAX_LIST_ITEMS = 20

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function normalizeList(value: unknown, maxItemLength = 120) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  const items = raw
    .map((item) => sanitizeProspectText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS)

  return Array.from(new Set(items))
}

function isAllowedSource(value: unknown): value is Exclude<ProspectSource, 'unknown'> {
  return value === 'contact_us' || value === 'visitor_information'
}

function safeEqualHex(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function verifySignature(req: NextRequest, rawBody: string) {
  const secret = process.env.ATOM_PROSPECTS_WEBHOOK_SECRET
  if (!secret) return { ok: false as const, status: 503, error: 'WEBHOOK_NOT_CONFIGURED' }

  const timestampRaw = req.headers.get('x-atom-timestamp')?.trim() ?? ''
  const signatureRaw = req.headers.get('x-atom-signature')?.trim() ?? ''
  const eventId = sanitizeProspectText(req.headers.get('x-atom-event-id'), 160)

  if (!eventId || !/^v1=[0-9a-f]{64}$/i.test(signatureRaw)) {
    return { ok: false as const, status: 401, error: 'INVALID_WEBHOOK_SIGNATURE' }
  }

  const timestamp = Number(timestampRaw)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_MAX_AGE_SECONDS) {
    return { ok: false as const, status: 401, error: 'STALE_WEBHOOK_SIGNATURE' }
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestampRaw}.${rawBody}`)
    .digest('hex')
  const actual = signatureRaw.slice(3)

  if (!safeEqualHex(expected, actual)) {
    return { ok: false as const, status: 401, error: 'INVALID_WEBHOOK_SIGNATURE' }
  }

  return { ok: true as const, eventId }
}

function trustedReceivedAt(value: unknown) {
  const fallback = new Date()
  const text = String(value ?? '').trim()
  if (!text) return fallback.toISOString()

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return fallback.toISOString()

  // Website submissions are expected to arrive immediately. Avoid accepting an
  // arbitrary historic/future timestamp even from a correctly signed payload.
  if (Math.abs(fallback.getTime() - parsed.getTime()) > 10 * 60 * 1000) {
    return fallback.toISOString()
  }

  return parsed.toISOString()
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ ok: false, error: 'JSON_REQUIRED' }, 415)
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413)
  }

  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json({ ok: false, error: rawBody ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY' }, rawBody ? 413 : 400)
  }

  const signature = verifySignature(req, rawBody)
  if (!signature.ok) return json({ ok: false, error: signature.error }, signature.status)

  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID')
    body = parsed as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const bodyEventId = sanitizeProspectText(body.event_id, 160)
  if (bodyEventId && bodyEventId !== signature.eventId) {
    return json({ ok: false, error: 'EVENT_ID_MISMATCH' }, 400)
  }

  const source = body.source
  if (!isAllowedSource(source)) {
    return json({ ok: false, error: 'INVALID_SOURCE' }, 400)
  }

  const fullName = sanitizeProspectText(body.full_name, 180)
  const email = normalizeProspectEmail(body.email)
  const phone = sanitizeProspectText(body.phone, 60)
  const requestedClasses = normalizeList(body.requested_classes)
  const level = sanitizeProspectText(body.level, 80)
  const goals = normalizeList(body.goals)
  const message = sanitizeProspectText(body.message, 2000)

  if (!fullName) return json({ ok: false, error: 'NAME_REQUIRED' }, 400)
  if (!email && !phone) return json({ ok: false, error: 'CONTACT_REQUIRED' }, 400)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'INVALID_EMAIL' }, 400)
  }

  if (source === 'visitor_information' && !requestedClasses.length && !level && !goals.length) {
    return json({ ok: false, error: 'VISITOR_DETAILS_REQUIRED' }, 400)
  }

  const receivedAt = trustedReceivedAt(body.submitted_at)

  try {
    const admin = createSupabaseAdminClient() as any
    const { data, error } = await admin.rpc('import_website_prospect_submission', {
      p_event_id: signature.eventId,
      p_full_name: fullName,
      p_email: email || null,
      p_phone: phone || null,
      p_source: source,
      p_received_at: receivedAt,
      p_requested_classes: requestedClasses,
      p_submitted_level: level || null,
      p_goals: goals,
      p_message: message || null,
      p_raw_payload: body,
    })

    if (error) {
      const errorText = String(error.message ?? 'INGEST_FAILED')
      if (errorText.includes('PROSPECT_CONTACT_CONFLICT')) {
        return json({ ok: false, error: 'CONTACT_CONFLICT' }, 409)
      }

      console.error('[Prospects intake] Database ingest failed', {
        eventId: signature.eventId,
        code: error.code ?? null,
      })
      return json({ ok: false, error: 'INGEST_FAILED' }, 500)
    }

    const row = Array.isArray(data) ? data[0] : data
    return json({
      ok: true,
      duplicate_event: Boolean(row?.duplicate_event_out),
      created_prospect: Boolean(row?.created_prospect_out),
      prospect_id: row?.prospect_id_out ?? null,
      submission_id: row?.submission_id_out ?? null,
    })
  } catch (error) {
    console.error('[Prospects intake] Unexpected failure', {
      eventId: signature.eventId,
      error: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return json({ ok: false, error: 'INGEST_FAILED' }, 500)
  }
}
