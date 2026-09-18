export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canImportProspects } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'

const CHANNELS = ['whatsapp', 'email'] as const
const TEMPLATE_KEYS = ['first_contact', 'follow_up', 'trial_reminder'] as const
const LANGUAGES = ['en', 'ar'] as const

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

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number])
}

export async function PATCH(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canImportProspects(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  if (!isOneOf(CHANNELS, body?.channel)) return json({ ok: false, error: 'INVALID_CHANNEL' }, 400)
  if (!isOneOf(TEMPLATE_KEYS, body?.template_key)) return json({ ok: false, error: 'INVALID_TEMPLATE_KEY' }, 400)
  if (!isOneOf(LANGUAGES, body?.language)) return json({ ok: false, error: 'INVALID_LANGUAGE' }, 400)

  const label = String(body?.label ?? '').trim().slice(0, 120)
  const subject = String(body?.subject_template ?? '').trim().slice(0, 300)
  const message = String(body?.body_template ?? '').trim().slice(0, 4000)
  if (!label) return json({ ok: false, error: 'LABEL_REQUIRED' }, 400)
  if (!message) return json({ ok: false, error: 'MESSAGE_REQUIRED' }, 400)
  if (body.channel === 'email' && !subject) return json({ ok: false, error: 'SUBJECT_REQUIRED' }, 400)

  try {
    const admin = adminClient()
    const { data, error } = await admin
      .from('prospect_message_templates')
      .update({
        label,
        subject_template: body.channel === 'email' ? subject : null,
        body_template: message,
        updated_by: me.id,
      })
      .eq('channel', body.channel)
      .eq('template_key', body.template_key)
      .eq('language', body.language)
      .select('id,channel,template_key,language,label,subject_template,body_template,is_active,updated_at')
      .single()

    if (error) return json({ ok: false, error: error.message }, 400)
    return json({ ok: true, template: data })
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message ?? error ?? 'UPDATE_FAILED') }, 500)
  }
}
