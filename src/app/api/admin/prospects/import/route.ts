export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canImportProspects } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import {
  parseWebsiteFormEmail,
  sanitizeProspectText,
  type GmailBackfillMessage,
} from '@/lib/prospects'

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) throw new Error('SUPABASE_SERVER_ENV_MISSING')
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any
}

function asIso(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return new Date().toISOString()
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function compactRaw(message: GmailBackfillMessage) {
  return {
    id: message.id ?? null,
    message_id: message.message_id ?? null,
    thread_id: message.thread_id ?? null,
    subject: sanitizeProspectText(message.subject, 500),
    body: typeof message.body === 'string' ? String(message.body).slice(0, 12000) : message.body ?? null,
    snippet: sanitizeProspectText(message.snippet, 3000),
    email_ts: message.email_ts ?? null,
    from_: sanitizeProspectText(message.from_, 500),
    to: message.to ?? null,
    labels: Array.isArray(message.labels) ? message.labels.slice(0, 30) : [],
  }
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canImportProspects(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const messages: GmailBackfillMessage[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.messages)
      ? body.messages
      : Array.isArray(body?.emails)
        ? body.emails
        : []

  if (!messages.length) return json({ ok: false, error: 'NO_MESSAGES' }, 400)
  if (messages.length > 1200) return json({ ok: false, error: 'TOO_MANY_MESSAGES' }, 400)

  const admin = adminClient()

  let createdProspects = 0
  let insertedSubmissions = 0
  let duplicateMessages = 0
  let skippedInvalid = 0
  const conflicts: Array<{ message_id: string | null; name: string | null; error: string }> = []

  for (const message of messages) {
    const parsed = parseWebsiteFormEmail(message)
    if (!parsed) {
      skippedInvalid += 1
      continue
    }

    const messageId = String(message.id ?? message.message_id ?? '').trim() || null
    const threadId = String(message.thread_id ?? '').trim() || null
    const receivedAt = asIso(message.email_ts)
    const rawPayload = compactRaw(message)

    try {
      const { data, error } = await admin.rpc('import_prospect_submission', {
        p_full_name: parsed.full_name,
        p_email: parsed.email || null,
        p_phone: parsed.phone || null,
        p_source: parsed.source,
        p_ingest_channel: 'gmail_backfill',
        p_received_at: receivedAt,
        p_gmail_message_id: messageId,
        p_gmail_thread_id: threadId,
        p_requested_classes: parsed.requested_classes,
        p_submitted_level: parsed.level || null,
        p_goals: parsed.goals,
        p_message: parsed.message || null,
        p_raw_payload: rawPayload,
        p_actor_user_id: me.id,
      })

      if (error) {
        const errorText = String(error.message ?? 'IMPORT_FAILED')
        if (errorText.includes('PROSPECT_CONTACT_CONFLICT')) {
          conflicts.push({ message_id: messageId, name: parsed.full_name, error: 'CONTACT_CONFLICT' })
          continue
        }

        conflicts.push({ message_id: messageId, name: parsed.full_name, error: errorText.slice(0, 240) })
        continue
      }

      const row = Array.isArray(data) ? data[0] : data
      if (row?.duplicate_message_out) {
        duplicateMessages += 1
      } else {
        insertedSubmissions += 1
        if (row?.created_prospect_out) createdProspects += 1
      }
    } catch (error: any) {
      conflicts.push({
        message_id: messageId,
        name: parsed.full_name,
        error: String(error?.message ?? 'IMPORT_FAILED').slice(0, 240),
      })
    }
  }

  return json({
    ok: true,
    summary: {
      total_messages: messages.length,
      created_prospects: createdProspects,
      inserted_submissions: insertedSubmissions,
      duplicate_messages: duplicateMessages,
      skipped_invalid: skippedInvalid,
      conflicts: conflicts.length,
    },
    conflicts: conflicts.slice(0, 100),
  })
}
