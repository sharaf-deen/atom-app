import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/session'
import { canAccessMembersList } from '@/lib/rbac'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type FollowupStatus =
  | 'to_contact'
  | 'contacted'
  | 'will_renew'
  | 'not_interested'
  | 'moved_academy'
  | 'created_by_mistake'
  | 'resolved'

const ALLOWED_STATUSES = new Set<FollowupStatus>([
  'to_contact',
  'contacted',
  'will_renew',
  'not_interested',
  'moved_academy',
  'created_by_mistake',
  'resolved',
])

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sanitizeText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  return text.slice(0, maxLength)
}

function isoOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function gate() {
  const me = await getSessionUser()
  if (!me) return { error: NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }) } as const
  if (!canAccessMembersList(me.role)) return { error: NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }) } as const
  return { me } as const
}

async function addActivity(admin: any, args: { memberId: string; type: string; summary: string; details?: Record<string, unknown>; actorId: string | null }) {
  const { data, error } = await admin
    .from('member_inactive_activities')
    .insert({
      member_id: args.memberId,
      activity_type: args.type,
      summary: args.summary,
      details: args.details ?? {},
      actor_user_id: args.actorId,
      occurred_at: new Date().toISOString(),
    })
    .select('id,member_id,activity_type,summary,details,actor_user_id,occurred_at')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function POST(req: Request) {
  const access = await gate()
  if ('error' in access) return access.error

  let body: any = null
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const memberId = String(body?.member_id ?? '').trim()
  if (!isUuid(memberId)) return NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 })

  const statusRaw = String(body?.status ?? 'to_contact').trim() as FollowupStatus
  const status = ALLOWED_STATUSES.has(statusRaw) ? statusRaw : 'to_contact'
  const note = sanitizeText(body?.note, 2000)

  const assignedRaw = String(body?.assigned_to ?? '').trim()
  const assignedTo = assignedRaw ? assignedRaw : null
  if (assignedTo && !isUuid(assignedTo)) return NextResponse.json({ ok: false, error: 'INVALID_ASSIGNEE' }, { status: 400 })

  const nextFollowUp = status === 'resolved' ? null : isoOrNull(body?.next_follow_up_at)
  if (nextFollowUp === undefined) return NextResponse.json({ ok: false, error: 'INVALID_FOLLOW_UP_DATE' }, { status: 400 })

  const markReviewed = Boolean(body?.mark_reviewed)
  const admin = createSupabaseAdminClient()

  const { data: member, error: memberError } = await admin.from('profiles').select('user_id').eq('user_id', memberId).maybeSingle()
  if (memberError) return NextResponse.json({ ok: false, error: 'MEMBER_LOOKUP_FAILED', details: memberError.message }, { status: 500 })
  if (!member) return NextResponse.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, { status: 404 })

  if (assignedTo) {
    const { data: staff, error: staffError } = await admin.from('profiles').select('user_id,role').eq('user_id', assignedTo).maybeSingle()
    if (staffError) return NextResponse.json({ ok: false, error: 'ASSIGNEE_LOOKUP_FAILED', details: staffError.message }, { status: 500 })
    if (!staff || !['reception', 'admin', 'super_admin'].includes(String(staff.role ?? ''))) {
      return NextResponse.json({ ok: false, error: 'ASSIGNEE_NOT_FRONT_DESK' }, { status: 400 })
    }
  }

  const actorId = String((access.me as any)?.id ?? (access.me as any)?.user_id ?? '') || null
  const now = new Date().toISOString()

  const { data: previous } = await admin
    .from('member_inactive_followups')
    .select('status,note,assigned_to,next_follow_up_at,reviewed_at,last_contacted_at')
    .eq('member_id', memberId)
    .maybeSingle()

  const payload: Record<string, unknown> = {
    member_id: memberId,
    status,
    note,
    assigned_to: assignedTo,
    next_follow_up_at: nextFollowUp,
    updated_by: actorId,
    updated_at: now,
  }

  if (markReviewed) {
    payload.reviewed_at = now
    payload.reviewed_by = actorId
  }

  const { data, error } = await admin
    .from('member_inactive_followups')
    .upsert(payload, { onConflict: 'member_id' })
    .select('member_id,status,note,reviewed_at,reviewed_by,next_follow_up_at,assigned_to,last_contacted_at,updated_at')
    .single()

  if (error) return NextResponse.json({ ok: false, error: 'FOLLOWUP_SAVE_FAILED', details: error.message }, { status: 500 })

  const changes: string[] = []
  if ((previous?.status ?? 'to_contact') !== status) changes.push(`status → ${status.replaceAll('_', ' ')}`)
  if ((previous?.assigned_to ?? null) !== assignedTo) changes.push(assignedTo ? 'assignment updated' : 'assignment cleared')
  if ((previous?.next_follow_up_at ?? null) !== nextFollowUp) changes.push(nextFollowUp ? 'next follow-up updated' : 'follow-up cleared')
  if ((previous?.note ?? null) !== note) changes.push('note updated')
  if (markReviewed) changes.push('marked reviewed')

  let activity = null
  try {
    activity = await addActivity(admin, {
      memberId,
      type: 'workflow_update',
      summary: changes.length ? `Inactive follow-up: ${changes.join(' · ')}` : 'Inactive follow-up saved',
      details: { status, assigned_to: assignedTo, next_follow_up_at: nextFollowUp, reviewed: markReviewed },
      actorId,
    })
  } catch {}

  return NextResponse.json({ ok: true, followup: data, activity })
}

export async function PATCH(req: Request) {
  const access = await gate()
  if ('error' in access) return access.error

  let body: any = null
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const memberId = String(body?.member_id ?? '').trim()
  if (!isUuid(memberId)) return NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 })

  const action = String(body?.action ?? '').trim()
  const actorId = String((access.me as any)?.id ?? (access.me as any)?.user_id ?? '') || null
  const admin = createSupabaseAdminClient()

  if (action === 'note') {
    const note = sanitizeText(body?.note, 2000)
    if (!note) return NextResponse.json({ ok: false, error: 'NOTE_REQUIRED' }, { status: 400 })

    try {
      const activity = await addActivity(admin, { memberId, type: 'note', summary: note, actorId })
      return NextResponse.json({ ok: true, activity })
    } catch (error: any) {
      return NextResponse.json({ ok: false, error: 'ACTIVITY_SAVE_FAILED', details: String(error?.message ?? error) }, { status: 500 })
    }
  }

  if (action === 'log_contact') {
    const channel = String(body?.channel ?? '').trim()
    if (!['whatsapp', 'call', 'email'].includes(channel)) {
      return NextResponse.json({ ok: false, error: 'INVALID_CONTACT_CHANNEL' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: current } = await admin
      .from('member_inactive_followups')
      .select('status,note,assigned_to,next_follow_up_at,reviewed_at,reviewed_by')
      .eq('member_id', memberId)
      .maybeSingle()

    const nextStatus = !current || current.status === 'to_contact' ? 'contacted' : current.status

    const { data, error } = await admin
      .from('member_inactive_followups')
      .upsert({
        member_id: memberId,
        status: nextStatus,
        note: current?.note ?? null,
        assigned_to: current?.assigned_to ?? actorId,
        next_follow_up_at: current?.next_follow_up_at ?? null,
        reviewed_at: current?.reviewed_at ?? null,
        reviewed_by: current?.reviewed_by ?? null,
        last_contacted_at: now,
        updated_by: actorId,
        updated_at: now,
      }, { onConflict: 'member_id' })
      .select('member_id,status,note,reviewed_at,reviewed_by,next_follow_up_at,assigned_to,last_contacted_at,updated_at')
      .single()

    if (error) return NextResponse.json({ ok: false, error: 'CONTACT_LOG_FAILED', details: error.message }, { status: 500 })

    let activity = null
    try {
      const label = channel === 'whatsapp' ? 'WhatsApp' : channel === 'call' ? 'Call' : 'Email'
      activity = await addActivity(admin, {
        memberId,
        type: 'contact',
        summary: `${label} contact initiated`,
        details: { channel },
        actorId,
      })
    } catch {}

    return NextResponse.json({ ok: true, followup: data, activity })
  }

  return NextResponse.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 })
}
