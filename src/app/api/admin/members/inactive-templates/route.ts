export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser } from '@/lib/session'

const CHANNELS = ['whatsapp', 'email'] as const
const TEMPLATE_KEYS = ['general_follow_up', 'renewal', 'no_membership', 'cancelled', 'win_back'] as const
const LANGUAGES = ['en', 'ar'] as const

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number])
}

export async function PATCH(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })
  if (me.role !== 'super_admin') return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 })
  }

  if (!isOneOf(CHANNELS, body?.channel)) return NextResponse.json({ ok: false, error: 'INVALID_CHANNEL' }, { status: 400 })
  if (!isOneOf(TEMPLATE_KEYS, body?.template_key)) return NextResponse.json({ ok: false, error: 'INVALID_TEMPLATE_KEY' }, { status: 400 })
  if (!isOneOf(LANGUAGES, body?.language)) return NextResponse.json({ ok: false, error: 'INVALID_LANGUAGE' }, { status: 400 })

  const label = String(body?.label ?? '').trim().slice(0, 120)
  const subject = String(body?.subject_template ?? '').trim().slice(0, 300)
  const message = String(body?.body_template ?? '').trim().slice(0, 4000)

  if (!label) return NextResponse.json({ ok: false, error: 'LABEL_REQUIRED' }, { status: 400 })
  if (!message) return NextResponse.json({ ok: false, error: 'MESSAGE_REQUIRED' }, { status: 400 })
  if (body.channel === 'email' && !subject) return NextResponse.json({ ok: false, error: 'SUBJECT_REQUIRED' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inactive_message_templates')
    .update({
      label,
      subject_template: body.channel === 'email' ? subject : null,
      body_template: message,
      updated_by: me.id,
      updated_at: new Date().toISOString(),
    })
    .eq('channel', body.channel)
    .eq('template_key', body.template_key)
    .eq('language', body.language)
    .select('id,channel,template_key,language,label,subject_template,body_template,is_active,updated_at')
    .single()

  if (error) return NextResponse.json({ ok: false, error: 'TEMPLATE_UPDATE_FAILED', details: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, template: data })
}
