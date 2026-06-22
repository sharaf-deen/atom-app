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

function isDateOnly(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  if (!canAccessMembersList(me.role)) {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  let body: any = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const memberId = String(body?.member_id ?? '').trim()
  if (!isUuid(memberId)) {
    return NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 })
  }

  const statusRaw = String(body?.status ?? 'to_contact').trim() as FollowupStatus
  const status = ALLOWED_STATUSES.has(statusRaw) ? statusRaw : 'to_contact'
  const note = sanitizeText(body?.note, 2000)
  const nextFollowUpAtRaw = sanitizeText(body?.next_follow_up_at, 10)
  const nextFollowUpAt = nextFollowUpAtRaw && isDateOnly(nextFollowUpAtRaw) ? nextFollowUpAtRaw : null
  const markReviewed = Boolean(body?.mark_reviewed)

  const admin = createSupabaseAdminClient()

  const { data: member, error: memberError } = await admin
    .from('profiles')
    .select('user_id')
    .eq('user_id', memberId)
    .maybeSingle()

  if (memberError) {
    return NextResponse.json({ ok: false, error: 'MEMBER_LOOKUP_FAILED', details: memberError.message }, { status: 500 })
  }

  if (!member) {
    return NextResponse.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, { status: 404 })
  }

  const actorId = String((me as any)?.id ?? (me as any)?.user_id ?? '') || null
  const now = new Date().toISOString()

  const payload: Record<string, unknown> = {
    member_id: memberId,
    status,
    note,
    next_follow_up_at: nextFollowUpAt,
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
    .select('member_id,status,note,reviewed_at,reviewed_by,next_follow_up_at,updated_at')
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: 'FOLLOWUP_SAVE_FAILED', details: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, followup: data })
}
