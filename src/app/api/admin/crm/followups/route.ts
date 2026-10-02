export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canAccessCrm } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'

const STATUSES = ['to_contact', 'contacted', 'awaiting_reply', 'follow_up', 'resolved'] as const
const CHANNELS = ['whatsapp', 'call', 'email'] as const

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) throw new Error('SUPABASE_SERVER_ENV_MISSING')
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) as any
}

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number])
}

function isoOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function textOrNull(value: unknown, max: number) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

async function gate() {
  const me = await getSessionUser()
  if (!me) return { error: json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401) } as const
  if (!canAccessCrm(me.role)) return { error: json({ ok: false, error: 'FORBIDDEN' }, 403) } as const
  return { me } as const
}

async function ensureMember(admin: any, memberId: string) {
  const { data, error } = await admin.from('profiles').select('user_id').eq('user_id', memberId).maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

async function insertActivity(admin: any, args: {
  memberId: string
  type: string
  summary: string
  details?: Record<string, unknown>
  actorUserId: string
}) {
  const { data, error } = await admin
    .from('crm_member_activities')
    .insert({
      member_id: args.memberId,
      activity_type: args.type,
      summary: args.summary,
      details: args.details ?? {},
      actor_user_id: args.actorUserId,
      occurred_at: new Date().toISOString(),
    })
    .select('id,member_id,activity_type,summary,details,actor_user_id,occurred_at')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function PATCH(req: NextRequest) {
  const access = await gate()
  if ('error' in access) return access.error

  let body: any
  try { body = await req.json() } catch { return json({ ok: false, error: 'INVALID_BODY' }, 400) }

  const memberId = String(body?.member_id ?? '').trim()
  if (!isUuid(memberId)) return json({ ok: false, error: 'INVALID_MEMBER_ID' }, 400)
  if (!isOneOf(STATUSES, body?.status)) return json({ ok: false, error: 'INVALID_STATUS' }, 400)

  const assignedToRaw = String(body?.assigned_to ?? '').trim()
  const assignedTo = assignedToRaw ? assignedToRaw : null
  if (assignedTo && !isUuid(assignedTo)) return json({ ok: false, error: 'INVALID_ASSIGNEE' }, 400)

  const followUp = body.status === 'resolved' ? null : isoOrNull(body?.next_follow_up_at)
  if (followUp === undefined) return json({ ok: false, error: 'INVALID_FOLLOW_UP_DATE' }, 400)

  try {
    const admin = adminClient()
    if (!(await ensureMember(admin, memberId))) return json({ ok: false, error: 'MEMBER_NOT_FOUND' }, 404)

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

    const { data: previous } = await admin
      .from('crm_member_followups')
      .select('status,assigned_to,next_follow_up_at,last_contacted_at')
      .eq('member_id', memberId)
      .maybeSingle()

    const now = new Date().toISOString()
    const { data: followup, error } = await admin
      .from('crm_member_followups')
      .upsert({
        member_id: memberId,
        status: body.status,
        assigned_to: assignedTo,
        next_follow_up_at: followUp,
        updated_by: access.me.id,
        updated_at: now,
      }, { onConflict: 'member_id' })
      .select('member_id,status,assigned_to,next_follow_up_at,last_contacted_at,updated_at')
      .single()

    if (error) return json({ ok: false, error: 'FOLLOWUP_SAVE_FAILED', details: error.message }, 500)

    const changes: string[] = []
    if ((previous?.status ?? 'to_contact') !== body.status) changes.push(`status → ${body.status.replaceAll('_', ' ')}`)
    if ((previous?.assigned_to ?? null) !== assignedTo) changes.push(assignedTo ? 'assignment updated' : 'assignment cleared')
    if ((previous?.next_follow_up_at ?? null) !== followUp) changes.push(followUp ? 'next follow-up updated' : 'follow-up cleared')

    const activity = await insertActivity(admin, {
      memberId,
      type: 'workflow_update',
      summary: changes.length ? `CRM updated: ${changes.join(' · ')}` : 'CRM follow-up saved',
      details: { status: body.status, assigned_to: assignedTo, next_follow_up_at: followUp },
      actorUserId: access.me.id,
    })

    return json({ ok: true, followup, activity })
  } catch (error: any) {
    return json({ ok: false, error: 'CRM_FOLLOWUP_FAILED', details: String(error?.message ?? error) }, 500)
  }
}

export async function POST(req: NextRequest) {
  const access = await gate()
  if ('error' in access) return access.error

  let body: any
  try { body = await req.json() } catch { return json({ ok: false, error: 'INVALID_BODY' }, 400) }

  const memberId = String(body?.member_id ?? '').trim()
  if (!isUuid(memberId)) return json({ ok: false, error: 'INVALID_MEMBER_ID' }, 400)
  const action = String(body?.action ?? '').trim()

  try {
    const admin = adminClient()
    if (!(await ensureMember(admin, memberId))) return json({ ok: false, error: 'MEMBER_NOT_FOUND' }, 404)

    if (action === 'note') {
      const note = textOrNull(body?.note, 2000)
      if (!note) return json({ ok: false, error: 'NOTE_REQUIRED' }, 400)
      const activity = await insertActivity(admin, {
        memberId,
        type: 'note',
        summary: note,
        actorUserId: access.me.id,
      })
      return json({ ok: true, activity })
    }

    if (action === 'log_contact') {
      if (!isOneOf(CHANNELS, body?.channel)) return json({ ok: false, error: 'INVALID_CONTACT_CHANNEL' }, 400)

      const now = new Date().toISOString()
      const { data: current } = await admin
        .from('crm_member_followups')
        .select('status,assigned_to,next_follow_up_at')
        .eq('member_id', memberId)
        .maybeSingle()

      const nextStatus = !current || current.status === 'to_contact' ? 'contacted' : current.status
      const { data: followup, error } = await admin
        .from('crm_member_followups')
        .upsert({
          member_id: memberId,
          status: nextStatus,
          assigned_to: current?.assigned_to ?? access.me.id,
          next_follow_up_at: current?.next_follow_up_at ?? null,
          last_contacted_at: now,
          updated_by: access.me.id,
          updated_at: now,
        }, { onConflict: 'member_id' })
        .select('member_id,status,assigned_to,next_follow_up_at,last_contacted_at,updated_at')
        .single()

      if (error) return json({ ok: false, error: 'CONTACT_LOG_FAILED', details: error.message }, 500)

      const label = body.channel === 'whatsapp' ? 'WhatsApp' : body.channel === 'call' ? 'Call' : 'Email'
      const activity = await insertActivity(admin, {
        memberId,
        type: 'contact',
        summary: `${label} contact initiated`,
        details: { channel: body.channel },
        actorUserId: access.me.id,
      })
      return json({ ok: true, followup, activity })
    }

    return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400)
  } catch (error: any) {
    return json({ ok: false, error: 'CRM_ACTION_FAILED', details: String(error?.message ?? error) }, 500)
  }
}
