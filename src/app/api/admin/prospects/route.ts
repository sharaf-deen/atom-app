export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canAccessProspects, canManageProspects } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import {
  isProspectLostReason,
  isProspectStatus,
  normalizeProspectEmail,
  sanitizeProspectText,
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

function uuidOrNull(value: unknown) {
  const next = String(value ?? '').trim()
  if (!next) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(next)
    ? next
    : undefined
}

function isoOrNull(value: unknown) {
  const next = String(value ?? '').trim()
  if (!next) return null
  const date = new Date(next)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function gate(write = false) {
  const me = await getSessionUser()
  if (!me) return { error: json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401) } as const
  const allowed = write ? canManageProspects(me.role) : canAccessProspects(me.role)
  if (!allowed) return { error: json({ ok: false, error: 'FORBIDDEN' }, 403) } as const
  return { me } as const
}

export async function PATCH(req: NextRequest) {
  const access = await gate(true)
  if ('error' in access) return access.error

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const id = uuidOrNull(body?.prospect_id)
  if (!id) return json({ ok: false, error: 'INVALID_PROSPECT_ID' }, 400)

  const admin = adminClient()
  const { data: current, error: currentError } = await admin
    .from('prospects')
    .select('id,full_name,email,phone,status,lost_reason,assigned_to,next_follow_up_at,last_contacted_at,updated_at')
    .eq('id', id)
    .maybeSingle()

  if (currentError) return json({ ok: false, error: currentError.message }, 400)
  if (!current) return json({ ok: false, error: 'PROSPECT_NOT_FOUND' }, 404)

  const update: Record<string, unknown> = {
    updated_by: access.me.id,
  }

  if (Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    const fullName = sanitizeProspectText(body.full_name, 180)
    if (!fullName) return json({ ok: false, error: 'NAME_REQUIRED' }, 400)
    update.full_name = fullName
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = normalizeProspectEmail(body.email)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: 'INVALID_EMAIL' }, 400)
    }
    update.email = email || null
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    update.phone = sanitizeProspectText(body.phone, 60) || null
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!isProspectStatus(body.status)) return json({ ok: false, error: 'INVALID_STATUS' }, 400)
    update.status = body.status
  }

  if (Object.prototype.hasOwnProperty.call(body, 'lost_reason')) {
    const lostReason = String(body.lost_reason ?? '').trim()
    if (lostReason && !isProspectLostReason(lostReason)) {
      return json({ ok: false, error: 'INVALID_LOST_REASON' }, 400)
    }
    update.lost_reason = lostReason || null
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assigned_to')) {
    const assignedTo = uuidOrNull(body.assigned_to)
    if (assignedTo === undefined) return json({ ok: false, error: 'INVALID_ASSIGNEE' }, 400)

    if (assignedTo) {
      const { data: staff, error: staffError } = await admin
        .from('profiles')
        .select('user_id,role')
        .eq('user_id', assignedTo)
        .maybeSingle()

      if (staffError) return json({ ok: false, error: staffError.message }, 400)
      if (!staff || !['reception', 'admin', 'super_admin'].includes(String(staff.role ?? ''))) {
        return json({ ok: false, error: 'ASSIGNEE_NOT_FRONT_DESK' }, 400)
      }
    }

    update.assigned_to = assignedTo
  }

  if (Object.prototype.hasOwnProperty.call(body, 'next_follow_up_at')) {
    const followUp = isoOrNull(body.next_follow_up_at)
    if (followUp === undefined) return json({ ok: false, error: 'INVALID_FOLLOW_UP_DATE' }, 400)
    update.next_follow_up_at = followUp
  }

  const effectiveStatus = (update.status ?? current.status) as string
  const effectiveLostReason = Object.prototype.hasOwnProperty.call(update, 'lost_reason')
    ? update.lost_reason
    : current.lost_reason

  if (effectiveStatus === 'lost' && !effectiveLostReason) {
    return json({ ok: false, error: 'LOST_REASON_REQUIRED' }, 400)
  }

  if (effectiveStatus !== 'lost' && Object.prototype.hasOwnProperty.call(body, 'lost_reason')) {
    update.lost_reason = null
  }
  if (
    (effectiveStatus === 'joined' || effectiveStatus === 'lost')
    && (Object.prototype.hasOwnProperty.call(body, 'status') || Object.prototype.hasOwnProperty.call(body, 'next_follow_up_at'))
  ) {
    update.next_follow_up_at = null
  }

  if (Object.keys(update).length === 1) {
    return json({ ok: false, error: 'NO_CHANGES' }, 400)
  }

  try {
    const { data, error } = await admin
      .from('prospects')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      const message = String(error.message ?? '')
      if (message.includes('prospects_email_normalized_uidx') || message.includes('prospects_phone_digits_uidx')) {
        return json({ ok: false, error: 'CONTACT_ALREADY_USED_BY_ANOTHER_PROSPECT' }, 409)
      }
      if (message.includes('PROSPECT_LOST_REASON_REQUIRED') || message.includes('prospects_lost_requires_reason_chk')) {
        return json({ ok: false, error: 'LOST_REASON_REQUIRED' }, 400)
      }
      return json({ ok: false, error: message || 'UPDATE_FAILED' }, 400)
    }

    return json({ ok: true, prospect: data })
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'UPDATE_FAILED' }, 500)
  }
}

export async function POST(req: NextRequest) {
  const access = await gate(true)
  if ('error' in access) return access.error

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const id = uuidOrNull(body?.prospect_id)
  if (!id) return json({ ok: false, error: 'INVALID_PROSPECT_ID' }, 400)

  const action = String(body?.action ?? '').trim()
  const admin = adminClient()

  const { data: prospect, error: prospectError } = await admin
    .from('prospects')
    .select('id,status')
    .eq('id', id)
    .maybeSingle()

  if (prospectError) return json({ ok: false, error: prospectError.message }, 400)
  if (!prospect) return json({ ok: false, error: 'PROSPECT_NOT_FOUND' }, 404)

  if (action === 'note') {
    const note = sanitizeProspectText(body?.note, 2000)
    if (!note) return json({ ok: false, error: 'NOTE_REQUIRED' }, 400)

    const { data, error } = await admin
      .from('prospect_activities')
      .insert({
        prospect_id: id,
        activity_type: 'note',
        summary: note,
        details: {},
        actor_user_id: access.me.id,
        occurred_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) return json({ ok: false, error: error.message }, 400)
    return json({ ok: true, activity: data })
  }

  if (action === 'log_contact') {
    const channel = String(body?.channel ?? '').trim()
    if (!['whatsapp', 'call', 'email'].includes(channel)) {
      return json({ ok: false, error: 'INVALID_CONTACT_CHANNEL' }, 400)
    }

    const { data, error } = await admin.rpc('log_prospect_contact', {
      p_prospect_id: id,
      p_channel: channel,
      p_actor_user_id: access.me.id,
    })

    if (error) {
      const message = String(error.message ?? '')
      if (message.includes('PROSPECT_NOT_FOUND')) return json({ ok: false, error: 'PROSPECT_NOT_FOUND' }, 404)
      if (message.includes('PROSPECT_CONTACT_CHANNEL_INVALID')) {
        return json({ ok: false, error: 'INVALID_CONTACT_CHANNEL' }, 400)
      }
      return json({ ok: false, error: message || 'CONTACT_LOG_FAILED' }, 400)
    }

    if (!data?.prospect || !data?.activity) {
      return json({ ok: false, error: 'CONTACT_LOG_FAILED' }, 500)
    }

    return json({ ok: true, activity: data.activity, prospect: data.prospect })
  }

  return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400)
}
