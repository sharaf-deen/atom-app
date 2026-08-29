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
  member_id?: string | null
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
  confirmed_at: string | null
  declined_at: string | null
  decline_reason: string | null
  cancelled_at: string | null
  created_at: string
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

function sessionLabel(date: string, start: string, end: string) {
  return `${formatSlotDate(date)} · ${formatPrivateCoachingSlotTime(start)} - ${formatPrivateCoachingSlotTime(end)}`
}

export async function GET() {
  try {
    const route = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await route.auth.getUser()
    if (authError) return json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = createSupabaseAdminClient()
    const { data: me, error: meError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email, member_id')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id) return json(403, { ok: false, error: 'FORBIDDEN' })

    const isMember = (PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))
    const isManager = (PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))
    if (!isMember && !isManager) return json(403, { ok: false, error: 'FORBIDDEN' })

    let requestQuery = admin
      .from('private_coaching_session_requests')
      .select('id, member_id, coach_id, requested_date, requested_start_time, requested_end_time, member_note, status, proposed_date, proposed_start_time, proposed_end_time, coach_note, booking_id, confirmed_at, declined_at, decline_reason, cancelled_at, created_at')
      .order('created_at', { ascending: false })
      .limit(60)

    if (isMember && !isManager) requestQuery = requestQuery.eq('member_id', auth.user.id)
    if (me.role === 'head_coach') requestQuery = requestQuery.eq('coach_id', auth.user.id)

    const { data: requests, error: requestsError } = await requestQuery
    if (requestsError) return json(500, { ok: false, error: 'REQUESTS_LOOKUP_FAILED', details: requestsError.message })

    const rows = (requests ?? []) as SessionRequestRow[]
    const profileIds = Array.from(new Set(rows.flatMap((row) => [row.member_id, row.coach_id])))
    const byId = new Map<string, ProfileRow>()

    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('profiles')
        .select('user_id, role, first_name, last_name, email, member_id')
        .in('user_id', profileIds)
        .limit(200)
      if (profilesError) return json(500, { ok: false, error: 'PROFILE_LIST_FAILED', details: profilesError.message })
      for (const profile of (profiles ?? []) as ProfileRow[]) byId.set(profile.user_id, profile)
    }

    let coaches: Array<{ user_id: string; full_name: string; remaining_sessions: number }> = []
    if (isMember && !isManager) {
      const { data: passes, error: passesError } = await admin
        .from('private_coaching_passes')
        .select('coach_id, remaining_sessions')
        .eq('member_id', auth.user.id)
        .eq('status', 'active')
        .gt('remaining_sessions', 0)

      if (passesError) return json(500, { ok: false, error: 'PASS_LOOKUP_FAILED', details: passesError.message })

      const remainingByCoach = new Map<string, number>()
      for (const pass of (passes ?? []) as Array<{ coach_id: string; remaining_sessions: number }>) {
        remainingByCoach.set(pass.coach_id, (remainingByCoach.get(pass.coach_id) ?? 0) + Number(pass.remaining_sessions ?? 0))
      }

      const coachIds = Array.from(remainingByCoach.keys())
      if (coachIds.length > 0) {
        const { data: coachProfiles, error: coachProfilesError } = await admin
          .from('profiles')
          .select('user_id, role, first_name, last_name, email')
          .in('user_id', coachIds)
          .eq('role', 'head_coach')
          .limit(50)
        if (coachProfilesError) return json(500, { ok: false, error: 'COACH_LOOKUP_FAILED', details: coachProfilesError.message })

        coaches = ((coachProfiles ?? []) as ProfileRow[]).map((coach) => ({
          user_id: coach.user_id,
          full_name: privateCoachingMemberName(coach),
          remaining_sessions: remainingByCoach.get(coach.user_id) ?? 0,
        }))
      }
    }

    return json(200, {
      ok: true,
      role: me.role,
      coaches,
      requests: rows.map((row) => ({
        id: row.id,
        member_id: row.member_id,
        member_name: profileName(byId.get(row.member_id)),
        member_meta: byId.get(row.member_id)?.member_id || byId.get(row.member_id)?.email || '',
        coach_id: row.coach_id,
        coach_name: profileName(byId.get(row.coach_id)),
        requested_date: row.requested_date,
        requested_start_time: row.requested_start_time,
        requested_end_time: row.requested_end_time,
        member_note: row.member_note,
        status: row.status,
        proposed_date: row.proposed_date,
        proposed_start_time: row.proposed_start_time,
        proposed_end_time: row.proposed_end_time,
        coach_note: row.coach_note,
        booking_id: row.booking_id,
        confirmed_at: row.confirmed_at,
        declined_at: row.declined_at,
        decline_reason: row.decline_reason,
        cancelled_at: row.cancelled_at,
        created_at: row.created_at,
      })),
    })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
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
      .select('user_id, role, first_name, last_name, email, member_id')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id || !(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const body = await req.json().catch(() => ({} as any))
    const coachId = String(body?.coach_id ?? '').trim()
    const slotDate = String(body?.slot_date ?? '').trim()
    const startTime = String(body?.start_time ?? '').trim()
    const endTime = String(body?.end_time ?? '').trim()
    const note = String(body?.note ?? '').trim()

    if (!coachId) return json(400, { ok: false, error: 'COACH_REQUIRED', details: 'Choose a coach.' })
    if (!isValidPrivateCoachingSlotDate(slotDate) || slotDate < todayInputValue()) {
      return json(400, { ok: false, error: 'INVALID_DATE', details: 'Choose today or a future date.' })
    }
    if (!isValidPrivateCoachingSlotTime(startTime) || !isValidPrivateCoachingSlotTime(endTime)) {
      return json(400, { ok: false, error: 'INVALID_TIME', details: 'Choose a valid start and end time.' })
    }
    if (minutes(endTime) <= minutes(startTime)) {
      return json(400, { ok: false, error: 'INVALID_TIME_RANGE', details: 'End time must be after start time.' })
    }
    if (note.length > 500) return json(400, { ok: false, error: 'NOTE_TOO_LONG', details: 'Keep the note under 500 characters.' })

    const [{ data: coach, error: coachError }, { data: pass, error: passError }, { data: activeRequest, error: activeRequestError }] = await Promise.all([
      admin
        .from('profiles')
        .select('user_id, role, first_name, last_name, email')
        .eq('user_id', coachId)
        .maybeSingle<ProfileRow>(),
      admin
        .from('private_coaching_passes')
        .select('id, remaining_sessions')
        .eq('member_id', auth.user.id)
        .eq('coach_id', coachId)
        .eq('status', 'active')
        .gt('remaining_sessions', 0)
        .limit(1)
        .maybeSingle(),
      admin
        .from('private_coaching_session_requests')
        .select('id, status')
        .eq('member_id', auth.user.id)
        .eq('coach_id', coachId)
        .in('status', ['pending', 'coach_proposed'])
        .limit(1)
        .maybeSingle(),
    ])

    if (coachError) return json(500, { ok: false, error: 'COACH_LOOKUP_FAILED', details: coachError.message })
    if (!coach?.user_id || coach.role !== 'head_coach') {
      return json(400, { ok: false, error: 'INVALID_COACH', details: 'Choose a valid Head Coach.' })
    }
    if (passError) return json(500, { ok: false, error: 'PASS_LOOKUP_FAILED', details: passError.message })
    if (!pass?.id) return json(409, { ok: false, error: 'NO_ACTIVE_TOKEN', details: 'You need an active private coaching token for this coach before requesting a session.' })
    if (activeRequestError) return json(500, { ok: false, error: 'ACTIVE_REQUEST_LOOKUP_FAILED', details: activeRequestError.message })
    if (activeRequest?.id) {
      return json(409, { ok: false, error: 'ACTIVE_REQUEST_EXISTS', details: 'You already have a pending private coaching request with this coach.' })
    }

    const { data: created, error: insertError } = await admin
      .from('private_coaching_session_requests')
      .insert({
        member_id: auth.user.id,
        coach_id: coachId,
        requested_date: slotDate,
        requested_start_time: startTime,
        requested_end_time: endTime,
        member_note: note || null,
        status: 'pending',
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertError) {
      const details = insertError.code === '23505'
        ? 'You already have a pending private coaching request with this coach.'
        : insertError.message
      return json(insertError.code === '23505' ? 409 : 500, { ok: false, error: 'REQUEST_CREATE_FAILED', details })
    }

    await admin.from('notifications').insert({
      user_id: coach.user_id,
      member_id: auth.user.id,
      created_by: auth.user.id,
      kind: 'info',
      title: 'New private coaching session request',
      body: [
        `${privateCoachingMemberName(me)} requested a private coaching session.`,
        `Preferred time: ${sessionLabel(slotDate, startTime, endTime)}`,
        note ? `Note: ${note}` : '',
        'Review it in Private Coaching.',
      ].filter(Boolean).join('\n'),
    })

    return json(200, { ok: true, request_id: created.id })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
