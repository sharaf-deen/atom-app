export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_ALLOWED_MEMBER_ROLES,
  PRIVATE_COACHING_MANAGER_ROLES,
  formatPrivateCoachingSlotTime,
  isValidPrivateCoachingSlotDate,
  isValidPrivateCoachingSlotTime,
  privateCoachingMemberName,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type BookingRow = {
  id: string
  member_id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  note: string | null
  token_consumed: boolean
  backdated_reason: string | null
}

function json(status: number, body: unknown) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return response
}

function minutes(value: string) {
  const [hours, mins] = value.split(':').map((part) => Number(part))
  return hours * 60 + mins
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function formatSlotDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', {
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
  })
}

function rpcStatus(message?: string | null) {
  const text = String(message ?? '')
  if (text.includes('PRIVATE_COACHING_FORBIDDEN')) return 403
  if (text.includes('PRIVATE_COACHING_MEMBER_NOT_FOUND')) return 404
  if (text.includes('PRIVATE_COACHING_HEAD_COACH_NOT_FOUND')) return 404
  if (text.includes('PRIVATE_COACHING_NO_TOKENS')) return 409
  if (text.includes('PRIVATE_COACHING_COACH_CONFLICT')) return 409
  if (text.includes('PRIVATE_COACHING_MEMBER_CONFLICT')) return 409
  if (text.includes('PRIVATE_COACHING_BACKDATED_FUTURE_DATE')) return 409
  if (text.includes('PRIVATE_COACHING_INVALID_TIME_RANGE')) return 400
  if (text.includes('PRIVATE_COACHING_NOTE_TOO_LONG')) return 400
  if (text.includes('PRIVATE_COACHING_BACKDATED_REASON_REQUIRED')) return 400
  return 500
}

function rpcDetails(message?: string | null) {
  const text = String(message ?? '')
  if (text.includes('PRIVATE_COACHING_NO_TOKENS')) return 'This member has no active private coaching token for the selected coach. Turn off token consumption only if this session must intentionally be recorded without using a package token.'
  if (text.includes('PRIVATE_COACHING_COACH_CONFLICT')) return 'The coach already has a booked or completed private session overlapping this time.'
  if (text.includes('PRIVATE_COACHING_MEMBER_CONFLICT')) return 'The member already has a booked or completed private session overlapping this time.'
  if (text.includes('PRIVATE_COACHING_BACKDATED_FUTURE_DATE')) return 'A backdated completed session cannot be created for a future date.'
  if (text.includes('PRIVATE_COACHING_INVALID_TIME_RANGE')) return 'End time must be after start time.'
  if (text.includes('PRIVATE_COACHING_NOTE_TOO_LONG')) return 'The booking note must be 500 characters or fewer.'
  if (text.includes('PRIVATE_COACHING_BACKDATED_REASON_REQUIRED')) return 'Enter an audit reason between 3 and 500 characters.'
  if (text.includes('PRIVATE_COACHING_FORBIDDEN')) return 'You are not allowed to record this private coaching session.'
  if (text.includes('PRIVATE_COACHING_MEMBER_NOT_FOUND')) return 'Choose a valid ATOM member.'
  if (text.includes('PRIVATE_COACHING_HEAD_COACH_NOT_FOUND')) return 'Choose a valid Head Coach.'
  return message || 'Could not record the completed private coaching session.'
}

export async function POST(req: Request) {
  try {
    const route = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await route.auth.getUser()
    if (authError) return json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = createSupabaseAdminClient()

    const { data: me, error: meError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const body = await req.json().catch(() => ({} as any))
    const memberId = String(body?.member_id ?? '').trim()
    const requestedCoachId = String(body?.coach_id ?? '').trim()
    const slotDate = String(body?.slot_date ?? '').trim()
    const startTime = String(body?.start_time ?? '').trim()
    const endTime = String(body?.end_time ?? '').trim()
    const note = String(body?.note ?? '').trim()
    const reason = String(body?.reason ?? '').trim()
    const consumeToken = body?.consume_token !== false
    const closeOpenRequest = body?.close_open_request === true

    if (!memberId) return json(400, { ok: false, error: 'MEMBER_REQUIRED', details: 'Choose a member.' })
    if (!isValidPrivateCoachingSlotDate(slotDate)) return json(400, { ok: false, error: 'INVALID_DATE' })
    if (slotDate > todayInputValue()) {
      return json(409, { ok: false, error: 'FUTURE_DATE_NOT_ALLOWED', details: 'Choose today or a past date.' })
    }
    if (!isValidPrivateCoachingSlotTime(startTime)) return json(400, { ok: false, error: 'INVALID_START_TIME' })
    if (!isValidPrivateCoachingSlotTime(endTime)) return json(400, { ok: false, error: 'INVALID_END_TIME' })
    if (minutes(endTime) <= minutes(startTime)) {
      return json(400, { ok: false, error: 'INVALID_TIME_RANGE', details: 'End time must be after start time.' })
    }
    if (note.length > 500) return json(400, { ok: false, error: 'NOTE_TOO_LONG' })
    if (reason.length < 3 || reason.length > 500) {
      return json(400, { ok: false, error: 'REASON_REQUIRED', details: 'Enter an audit reason between 3 and 500 characters.' })
    }

    let coachId = auth.user.id
    if (me.role === 'super_admin') coachId = requestedCoachId || auth.user.id

    const [{ data: member, error: memberError }, { data: coach, error: coachError }] = await Promise.all([
      admin.from('profiles').select('user_id, role, first_name, last_name, email').eq('user_id', memberId).maybeSingle<ProfileRow>(),
      admin.from('profiles').select('user_id, role, first_name, last_name, email').eq('user_id', coachId).maybeSingle<ProfileRow>(),
    ])

    if (memberError) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: memberError.message })
    if (!member?.user_id || !(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(member.role ?? ''))) {
      return json(400, { ok: false, error: 'INVALID_MEMBER', details: 'Choose a valid ATOM member.' })
    }

    if (coachError) return json(500, { ok: false, error: 'COACH_LOOKUP_FAILED', details: coachError.message })
    if (!coach?.user_id || coach.role !== 'head_coach') {
      return json(400, { ok: false, error: 'HEAD_COACH_NOT_FOUND', details: 'Choose a valid Head Coach.' })
    }
    if (me.role === 'head_coach' && coach.user_id !== auth.user.id) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { data: bookingId, error: rpcError } = await admin.rpc('private_coaching_record_backdated_completed', {
      p_member_id: member.user_id,
      p_coach_id: coach.user_id,
      p_slot_date: slotDate,
      p_start_time: startTime,
      p_end_time: endTime,
      p_note: note || null,
      p_reason: reason,
      p_consume_token: consumeToken,
      p_close_open_request: closeOpenRequest,
      p_actor_id: auth.user.id,
    })

    if (rpcError) {
      return json(rpcStatus(rpcError.message), {
        ok: false,
        error: 'BACKDATED_COMPLETED_FAILED',
        details: rpcDetails(rpcError.message),
      })
    }

    const { data: booking } = await admin
      .from('private_coaching_bookings')
      .select('id, member_id, coach_id, slot_date, start_time, end_time, note, token_consumed, backdated_reason')
      .eq('id', bookingId)
      .maybeSingle<BookingRow>()

    if (booking?.id) {
      const sessionLabel = `${formatSlotDate(booking.slot_date)} · ${formatPrivateCoachingSlotTime(booking.start_time)} - ${formatPrivateCoachingSlotTime(booking.end_time)}`
      const coachName = privateCoachingMemberName(coach)

      await admin.from('notifications').insert({
        user_id: member.user_id,
        member_id: member.user_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'Past private coaching session recorded',
        body: [
          `${coachName} recorded a private coaching session that already took place.`,
          `Session: ${sessionLabel}`,
          booking.token_consumed ? '1 private coaching token was used.' : 'No private coaching token was deducted for this correction.',
          closeOpenRequest ? 'Your open session request with this coach was closed to avoid a duplicate.' : '',
          'The completed session is now available in your private coaching history.',
        ].filter(Boolean).join('\n'),
      })
    }

    return json(200, {
      ok: true,
      booking_id: bookingId,
      token_consumed: consumeToken,
      open_request_closed: closeOpenRequest,
    })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
