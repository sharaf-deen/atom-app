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
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type SessionRequestRow = {
  id: string
  member_id: string
  coach_id: string
  requested_date: string
  requested_start_time: string
  requested_end_time: string
  member_note: string | null
  status: string
  proposed_date: string | null
  proposed_start_time: string | null
  proposed_end_time: string | null
  coach_note: string | null
  booking_id: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}


function profileName(profile?: ProfileRow | null) {
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
  return full || profile?.email || 'Member'
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function minutes(value: string) {
  const [hours, mins] = value.split(':').map((part) => Number(part))
  return hours * 60 + mins
}

function formatSlotDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })
}

function sessionLabel(date?: string | null, start?: string | null, end?: string | null) {
  if (!date || !start || !end) return '—'
  return `${formatSlotDate(date)} · ${formatPrivateCoachingSlotTime(start)} - ${formatPrivateCoachingSlotTime(end)}`
}

function rpcStatus(message?: string | null) {
  const text = String(message ?? '')
  if (text.includes('NOT_FOUND')) return 404
  if (text.includes('FORBIDDEN')) return 403
  if (text.includes('NOT_ACTIONABLE')) return 409
  if (text.includes('NO_TOKENS')) return 409
  if (text.includes('CONFLICT')) return 409
  if (text.includes('SLOT_IN_PAST')) return 409
  if (text.includes('INVALID_TIME')) return 400
  if (text.includes('REASON_REQUIRED')) return 400
  return 500
}

function rpcDetails(message?: string | null) {
  const text = String(message ?? '')
  if (text.includes('PRIVATE_COACHING_NO_TOKENS')) return 'No private coaching token is available anymore for this coach.'
  if (text.includes('PRIVATE_COACHING_COACH_CONFLICT')) return 'The coach already has another booked private session during this time.'
  if (text.includes('PRIVATE_COACHING_MEMBER_CONFLICT')) return 'The member already has another booked private session during this time.'
  if (text.includes('PRIVATE_COACHING_AVAILABILITY_CONFLICT')) return 'This time overlaps an existing availability slot. Use the exact slot or adjust the proposal.'
  if (text.includes('PRIVATE_COACHING_SLOT_IN_PAST')) return 'The selected session time is now in the past.'
  if (text.includes('PRIVATE_COACHING_SESSION_REQUEST_NOT_ACTIONABLE')) return 'This session request has already been processed.'
  if (text.includes('PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN')) return 'You are not allowed to perform this action.'
  if (text.includes('PRIVATE_COACHING_DECLINE_REASON_REQUIRED')) return 'Add a short reason before declining the request.'
  return message || 'Could not update the private coaching request.'
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const requestId = String(params?.id ?? '').trim()
    if (!requestId) return json(400, { ok: false, error: 'MISSING_REQUEST_ID' })

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
    if (!me?.user_id) return json(403, { ok: false, error: 'FORBIDDEN' })

    const { data: sessionRequest, error: requestError } = await admin
      .from('private_coaching_session_requests')
      .select('id, member_id, coach_id, requested_date, requested_start_time, requested_end_time, member_note, status, proposed_date, proposed_start_time, proposed_end_time, coach_note, booking_id')
      .eq('id', requestId)
      .maybeSingle<SessionRequestRow>()

    if (requestError) return json(500, { ok: false, error: 'REQUEST_LOOKUP_FAILED', details: requestError.message })
    if (!sessionRequest?.id) return json(404, { ok: false, error: 'REQUEST_NOT_FOUND' })

    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email')
      .in('user_id', [sessionRequest.member_id, sessionRequest.coach_id])
      .limit(10)

    if (profilesError) return json(500, { ok: false, error: 'PROFILE_LIST_FAILED', details: profilesError.message })
    const byId = new Map<string, ProfileRow>()
    for (const profile of (profiles ?? []) as ProfileRow[]) byId.set(profile.user_id, profile)
    const member = byId.get(sessionRequest.member_id)
    const coach = byId.get(sessionRequest.coach_id)

    const body = await req.json().catch(() => ({} as any))
    const action = String(body?.action ?? '').trim()
    const isManager = (PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))
    const isMember = (PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))

    if (action === 'confirm') {
      if (!isManager || (me.role === 'head_coach' && sessionRequest.coach_id !== auth.user.id)) {
        return json(403, { ok: false, error: 'FORBIDDEN' })
      }

      const { data: bookingId, error: rpcError } = await admin.rpc('private_coaching_confirm_session_request', {
        p_request_id: requestId,
        p_actor_id: auth.user.id,
      })
      if (rpcError) return json(rpcStatus(rpcError.message), { ok: false, error: 'CONFIRM_FAILED', details: rpcDetails(rpcError.message) })

      await admin.from('notifications').insert({
        user_id: sessionRequest.member_id,
        member_id: sessionRequest.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'Private coaching request confirmed',
        body: [
          `${profileName(coach)} confirmed your private coaching session.`,
          `Session: ${sessionLabel(sessionRequest.requested_date, sessionRequest.requested_start_time, sessionRequest.requested_end_time)}`,
          '1 private coaching token was used.',
        ].join('\n'),
      })

      return json(200, { ok: true, booking_id: bookingId })
    }

    if (action === 'propose') {
      if (!isManager || (me.role === 'head_coach' && sessionRequest.coach_id !== auth.user.id)) {
        return json(403, { ok: false, error: 'FORBIDDEN' })
      }

      const slotDate = String(body?.slot_date ?? '').trim()
      const startTime = String(body?.start_time ?? '').trim()
      const endTime = String(body?.end_time ?? '').trim()
      const note = String(body?.note ?? '').trim()

      if (!isValidPrivateCoachingSlotDate(slotDate) || slotDate < todayInputValue()) {
        return json(400, { ok: false, error: 'INVALID_DATE', details: 'Choose today or a future date.' })
      }
      if (!isValidPrivateCoachingSlotTime(startTime) || !isValidPrivateCoachingSlotTime(endTime) || minutes(endTime) <= minutes(startTime)) {
        return json(400, { ok: false, error: 'INVALID_TIME', details: 'Choose a valid time range.' })
      }
      if (note.length > 500) return json(400, { ok: false, error: 'NOTE_TOO_LONG' })

      const { error: rpcError } = await admin.rpc('private_coaching_propose_session_time', {
        p_request_id: requestId,
        p_actor_id: auth.user.id,
        p_slot_date: slotDate,
        p_start_time: startTime,
        p_end_time: endTime,
        p_note: note || null,
      })
      if (rpcError) return json(rpcStatus(rpcError.message), { ok: false, error: 'PROPOSE_FAILED', details: rpcDetails(rpcError.message) })

      await admin.from('notifications').insert({
        user_id: sessionRequest.member_id,
        member_id: sessionRequest.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'New private coaching time proposed',
        body: [
          `${profileName(coach)} proposed another time for your private coaching session.`,
          `Proposed time: ${sessionLabel(slotDate, startTime, endTime)}`,
          note ? `Coach note: ${note}` : '',
          'Open Private Coaching to accept the proposal.',
        ].filter(Boolean).join('\n'),
      })

      return json(200, { ok: true })
    }

    if (action === 'decline') {
      if (!isManager || (me.role === 'head_coach' && sessionRequest.coach_id !== auth.user.id)) {
        return json(403, { ok: false, error: 'FORBIDDEN' })
      }
      const reason = String(body?.reason ?? '').trim()
      if (reason.length < 3 || reason.length > 500) {
        return json(400, { ok: false, error: 'REASON_REQUIRED', details: 'Add a short reason before declining.' })
      }

      const { error: rpcError } = await admin.rpc('private_coaching_decline_session_request', {
        p_request_id: requestId,
        p_actor_id: auth.user.id,
        p_reason: reason,
      })
      if (rpcError) return json(rpcStatus(rpcError.message), { ok: false, error: 'DECLINE_FAILED', details: rpcDetails(rpcError.message) })

      await admin.from('notifications').insert({
        user_id: sessionRequest.member_id,
        member_id: sessionRequest.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'Private coaching request declined',
        body: [
          `${profileName(coach)} could not confirm this private coaching request.`,
          `Requested time: ${sessionLabel(sessionRequest.requested_date, sessionRequest.requested_start_time, sessionRequest.requested_end_time)}`,
          `Reason: ${reason}`,
        ].join('\n'),
      })

      return json(200, { ok: true })
    }

    if (action === 'accept_proposal') {
      if (!isMember || sessionRequest.member_id !== auth.user.id || sessionRequest.status !== 'coach_proposed') {
        return json(403, { ok: false, error: 'FORBIDDEN' })
      }

      const { data: bookingId, error: rpcError } = await admin.rpc('private_coaching_confirm_session_request', {
        p_request_id: requestId,
        p_actor_id: auth.user.id,
      })
      if (rpcError) return json(rpcStatus(rpcError.message), { ok: false, error: 'ACCEPT_FAILED', details: rpcDetails(rpcError.message) })

      await admin.from('notifications').insert({
        user_id: sessionRequest.coach_id,
        member_id: sessionRequest.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'Private coaching proposal accepted',
        body: [
          `${profileName(member)} accepted your proposed private coaching time.`,
          `Session: ${sessionLabel(sessionRequest.proposed_date, sessionRequest.proposed_start_time, sessionRequest.proposed_end_time)}`,
          'The booking is confirmed and 1 member token was used.',
        ].join('\n'),
      })

      return json(200, { ok: true, booking_id: bookingId })
    }

    if (action === 'cancel') {
      if (!isMember || sessionRequest.member_id !== auth.user.id) {
        return json(403, { ok: false, error: 'FORBIDDEN' })
      }

      const { error: rpcError } = await admin.rpc('private_coaching_cancel_session_request', {
        p_request_id: requestId,
        p_actor_id: auth.user.id,
      })
      if (rpcError) return json(rpcStatus(rpcError.message), { ok: false, error: 'CANCEL_FAILED', details: rpcDetails(rpcError.message) })

      await admin.from('notifications').insert({
        user_id: sessionRequest.coach_id,
        member_id: sessionRequest.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'Private coaching request cancelled',
        body: `${profileName(member)} cancelled the pending private coaching session request.`,
      })

      return json(200, { ok: true })
    }

    return json(400, { ok: false, error: 'INVALID_ACTION' })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
