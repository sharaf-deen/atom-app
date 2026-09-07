// src/app/api/kiosk/scan/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { cairoTodayDateOnly } from '@/lib/cairoTime'
import { jsonWithApiRuntime, logApiError, startApiRuntime } from '@/lib/apiRuntime'
import { canAccessScan, hasLifetimeGymAccess, normalizeRole } from '@/lib/rbac'

type ScanBody = { code?: string }

type ScanResponse = {
  ok: boolean
  valid?: boolean
  message?: string
  member_id?: string
  subscription_id?: string | null
  days_remaining?: number | null
  expires_on?: string | null
  expired_days?: number | null
  expired_on?: string | null
  frozen?: boolean
  frozen_until?: string | null
  freeze_days_remaining?: number | null
  staff_checkin?: boolean
  staff_role?: string
  staff_checked_in_at?: string
  staff_already_checked_in?: boolean
  staff_session_match?: 'matched' | 'unlinked' | 'ambiguous'
  staff_training_session_id?: string
  staff_session_name?: string
  staff_session_start_time?: string
  staff_session_mat?: string | null
  staff_assignment_role?: 'primary_coach' | 'assistant_coach'
  staff_arrival_delta_minutes?: number
  staff_match_candidate_count?: number
}

type AttendanceWrite = {
  member_id?: string
  date?: string
  scanned_at?: string
  valid?: boolean | null
  status?: string
  from_sessions?: boolean
  subscription_id?: string | null
  scanned_by?: string | null
  device_tag?: string | null
  source?: string
}

function sanitizeDeviceTag(value: string | null) {
  return (value || '')
    .replace(/[^a-zA-Z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64) || null
}

function json(meta: ReturnType<typeof startApiRuntime>, status: number, body: ScanResponse) {
  return jsonWithApiRuntime(meta, status, body, 'no-store')
}

function parseMemberIdFromCode(code: string): string | null {
  const t = (code || '').trim()
  if (!t) return null
  const lower = t.toLowerCase()
  if (lower.startsWith('atom:')) {
    const id = t.slice(5).trim()
    if (/^[0-9a-f-]{36}$/i.test(id)) return id
  }
  if (/^[0-9a-f-]{36}$/i.test(t)) return t
  return null
}

function daysBetweenUTC(fromDateOnly: string, toDateOnly: string) {
  const from = new Date(`${fromDateOnly}T00:00:00Z`).getTime()
  const to = new Date(`${toDateOnly}T00:00:00Z`).getTime()
  return Math.floor((to - from) / 86400000)
}

function makeAdminClient() {
  try {
    return createSupabaseAdminClient()
  } catch {
    return null
  }
}

async function persistAttendance(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  existingId: string | null,
  payload: AttendanceWrite,
) {
  const writePayload: AttendanceWrite = {
    ...payload,
    scanned_at: new Date().toISOString(),
    source: 'kiosk',
  }

  if (existingId) {
    const { error } = await admin.from('attendance').update(writePayload).eq('id', existingId)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await admin.from('attendance').insert(writePayload)
  if (error) throw new Error(error.message)
}

export async function POST(req: Request) {
  const meta = startApiRuntime('/api/kiosk/scan')
  const admin = makeAdminClient()
  if (!admin) {
    logApiError(meta, 'env', 'Server missing service key')
    return json(meta, 500, { ok: false, message: 'Server missing service key' })
  }

  const supa = createSupabaseServerActionClient()
  const { data: auth } = await supa.auth.getUser()
  if (!auth.user) {
    return json(meta, 401, { ok: false, message: 'Not authenticated' })
  }

  const actorId = auth.user.id
  const { data: actorProfile, error: actorErr } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', actorId)
    .maybeSingle<{ role: string | null }>()

  if (actorErr) {
    logApiError(meta, 'actor_profile_lookup', actorErr, { actor_id: actorId })
    return json(meta, 500, { ok: false, message: actorErr.message })
  }

  const actorRole = normalizeRole(actorProfile?.role ?? 'member')
  if (!canAccessScan(actorRole)) {
    return json(meta, 403, { ok: false, message: 'Forbidden' })
  }

  let body: ScanBody = {}
  try {
    body = (await req.json()) as ScanBody
  } catch {
    body = {}
  }

  const rawCode = String(body.code ?? '').trim()
  if (rawCode.length > 200) {
    logApiError(meta, 'invalid_code_length', 'QR code too long', { actor_id: actorId, length: rawCode.length })
    return json(meta, 400, { ok: false, message: 'Invalid QR code' })
  }

  const memberId = parseMemberIdFromCode(rawCode)
  if (!memberId) {
    return json(meta, 400, { ok: false, message: 'Invalid QR code' })
  }

  const today = cairoTodayDateOnly()
  const deviceTag = sanitizeDeviceTag(req.headers.get('x-device-tag'))

  try {
    const { data: memberProfile, error: memberProfileErr } = await admin
      .from('profiles')
      .select('role, first_name, last_name, member_id')
      .eq('user_id', memberId)
      .maybeSingle<{
        role: string | null
        first_name: string | null
        last_name: string | null
        member_id: string | null
      }>()

    if (memberProfileErr) {
      logApiError(meta, 'member_profile_lookup', memberProfileErr, { actor_id: actorId, member_id: memberId })
      return json(meta, 500, { ok: false, message: memberProfileErr.message })
    }

    if (!memberProfile) {
      return json(meta, 404, { ok: false, message: 'Member not found' })
    }

    const memberRole = normalizeRole(memberProfile.role ?? 'member')
    const isCoachingStaff =
      memberRole === 'assistant_coach' ||
      memberRole === 'coach' ||
      memberRole === 'head_coach' ||
      memberRole === 'super_admin'

    if (isCoachingStaff) {
      const now = new Date()
      const nowIso = now.toISOString()
      const staffName =
        [memberProfile.first_name ?? '', memberProfile.last_name ?? ''].join(' ').trim() ||
        memberProfile.member_id ||
        'ATOM coaching staff'

      type SessionAssignment = {
        training_session_id: string
        assignment_role: 'primary_coach' | 'assistant_coach'
      }
      type AssignedSession = {
        id: string
        session_date: string
        start_time: string
        end_time: string | null
        name_snapshot: string
        mat_snapshot: string | null
        status: 'scheduled' | 'completed' | 'cancelled'
      }
      type MatchCandidate = AssignedSession & {
        assignment_role: 'primary_coach' | 'assistant_coach'
        delta_minutes: number
      }

      const cairoParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now)
      const cairoHour = Number(cairoParts.find((part) => part.type === 'hour')?.value ?? '0')
      const cairoMinute = Number(cairoParts.find((part) => part.type === 'minute')?.value ?? '0')
      const cairoClockMinutes = cairoHour * 60 + cairoMinute

      function timeToMinutes(value: string) {
        const match = String(value || '').match(/^(\d{2}):(\d{2})/)
        if (!match) return null
        const hours = Number(match[1])
        const minutes = Number(match[2])
        if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          return null
        }
        return hours * 60 + minutes
      }

      const { data: assignmentData, error: assignmentErr } = await admin
        .from('schedule_session_coach_assignments')
        .select('training_session_id,assignment_role')
        .eq('staff_user_id', memberId)
        .eq('is_active', true)

      if (assignmentErr) {
        logApiError(meta, 'staff_session_assignment_lookup', assignmentErr, { actor_id: actorId, staff_user_id: memberId })
        return json(meta, 500, { ok: false, message: assignmentErr.message })
      }

      const assignments = (assignmentData ?? []) as SessionAssignment[]
      const assignmentBySession = new Map(assignments.map((row) => [row.training_session_id, row.assignment_role]))
      const assignedSessionIds = [...assignmentBySession.keys()]
      let candidates: MatchCandidate[] = []

      if (assignedSessionIds.length > 0) {
        const { data: sessionData, error: sessionErr } = await admin
          .from('schedule_training_sessions')
          .select('id,session_date,start_time,end_time,name_snapshot,mat_snapshot,status')
          .in('id', assignedSessionIds)
          .eq('session_date', today)
          .eq('status', 'scheduled')

        if (sessionErr) {
          logApiError(meta, 'staff_assigned_session_lookup', sessionErr, { actor_id: actorId, staff_user_id: memberId })
          return json(meta, 500, { ok: false, message: sessionErr.message })
        }

        candidates = ((sessionData ?? []) as AssignedSession[])
          .map((session) => {
            const startMinutes = timeToMinutes(session.start_time)
            const assignmentRole = assignmentBySession.get(session.id)
            if (startMinutes === null || !assignmentRole) return null
            return {
              ...session,
              assignment_role: assignmentRole,
              delta_minutes: cairoClockMinutes - startMinutes,
            }
          })
          .filter((row): row is MatchCandidate => !!row)
          // Safe automatic window: up to 75 minutes before or 45 minutes after scheduled start.
          .filter((row) => row.delta_minutes >= -75 && row.delta_minutes <= 45)
          .sort((a, b) => Math.abs(a.delta_minutes) - Math.abs(b.delta_minutes))
      }

      let matchedSession: MatchCandidate | null = null
      let matchStatus: 'matched' | 'unlinked' | 'ambiguous' = 'unlinked'

      if (candidates.length === 1) {
        matchedSession = candidates[0]
        matchStatus = 'matched'
      } else if (candidates.length > 1) {
        const nearest = candidates[0]
        const second = candidates[1]
        const nearestDistance = Math.abs(nearest.delta_minutes)
        const secondDistance = Math.abs(second.delta_minutes)

        // Only auto-link when one assignment is clearly closer. Otherwise preserve the scan as ambiguous.
        if (secondDistance - nearestDistance >= 30) {
          matchedSession = nearest
          matchStatus = 'matched'
        } else {
          matchStatus = 'ambiguous'
        }
      }

      if (matchedSession) {
        const { data: existingSessionCheckin, error: existingSessionErr } = await admin
          .from('coach_staff_attendance')
          .select('id,checked_in_at,session_name_snapshot,session_start_time_snapshot,session_mat_snapshot,assignment_role_snapshot,arrival_delta_minutes,session_match_candidate_count')
          .eq('staff_user_id', memberId)
          .eq('training_session_id', matchedSession.id)
          .order('checked_in_at', { ascending: true })
          .limit(1)
          .maybeSingle<{
            id: string
            checked_in_at: string
            session_name_snapshot: string | null
            session_start_time_snapshot: string | null
            session_mat_snapshot: string | null
            assignment_role_snapshot: 'primary_coach' | 'assistant_coach' | null
            arrival_delta_minutes: number | null
            session_match_candidate_count: number
          }>()

        if (existingSessionErr) {
          logApiError(meta, 'staff_session_attendance_lookup', existingSessionErr, {
            actor_id: actorId,
            staff_user_id: memberId,
            training_session_id: matchedSession.id,
          })
          return json(meta, 500, { ok: false, message: existingSessionErr.message })
        }

        if (existingSessionCheckin) {
          return json(meta, 200, {
            ok: true,
            valid: true,
            member_id: memberId,
            staff_checkin: true,
            staff_role: memberRole,
            staff_checked_in_at: existingSessionCheckin.checked_in_at,
            staff_already_checked_in: true,
            staff_session_match: 'matched',
            staff_training_session_id: matchedSession.id,
            staff_session_name: existingSessionCheckin.session_name_snapshot ?? matchedSession.name_snapshot,
            staff_session_start_time: existingSessionCheckin.session_start_time_snapshot ?? matchedSession.start_time,
            staff_session_mat: existingSessionCheckin.session_mat_snapshot ?? matchedSession.mat_snapshot,
            staff_assignment_role: existingSessionCheckin.assignment_role_snapshot ?? matchedSession.assignment_role,
            staff_arrival_delta_minutes: existingSessionCheckin.arrival_delta_minutes ?? matchedSession.delta_minutes,
            staff_match_candidate_count: existingSessionCheckin.session_match_candidate_count,
            message: 'Staff check-in already recorded for this assigned session',
          })
        }
      } else {
        // Preserve Lot 1D's two-hour duplicate protection when this scan cannot be safely linked.
        // A clearly matched DIFFERENT session bypasses this rule above, allowing consecutive classes.
        const { data: lastStaffCheckin, error: lastStaffErr } = await admin
          .from('coach_staff_attendance')
          .select('id,checked_in_at,training_session_id,session_match_status,session_match_candidate_count,session_name_snapshot,session_start_time_snapshot,session_mat_snapshot,assignment_role_snapshot,arrival_delta_minutes')
          .eq('staff_user_id', memberId)
          .eq('attendance_date', today)
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .maybeSingle<{
            id: string
            checked_in_at: string
            training_session_id: string | null
            session_match_status: 'matched' | 'unlinked' | 'ambiguous'
            session_match_candidate_count: number
            session_name_snapshot: string | null
            session_start_time_snapshot: string | null
            session_mat_snapshot: string | null
            assignment_role_snapshot: 'primary_coach' | 'assistant_coach' | null
            arrival_delta_minutes: number | null
          }>()

        if (lastStaffErr) {
          logApiError(meta, 'staff_attendance_lookup', lastStaffErr, { actor_id: actorId, staff_user_id: memberId })
          return json(meta, 500, { ok: false, message: lastStaffErr.message })
        }

        const duplicateWindowMs = 2 * 60 * 60 * 1000
        const lastCheckinMs = lastStaffCheckin?.checked_in_at
          ? new Date(lastStaffCheckin.checked_in_at).getTime()
          : Number.NaN
        const isRecentCheckin =
          Number.isFinite(lastCheckinMs) &&
          Date.now() - lastCheckinMs >= 0 &&
          Date.now() - lastCheckinMs < duplicateWindowMs

        if (isRecentCheckin && lastStaffCheckin) {
          return json(meta, 200, {
            ok: true,
            valid: true,
            member_id: memberId,
            staff_checkin: true,
            staff_role: memberRole,
            staff_checked_in_at: lastStaffCheckin.checked_in_at,
            staff_already_checked_in: true,
            staff_session_match: lastStaffCheckin.session_match_status,
            staff_training_session_id: lastStaffCheckin.training_session_id ?? undefined,
            staff_session_name: lastStaffCheckin.session_name_snapshot ?? undefined,
            staff_session_start_time: lastStaffCheckin.session_start_time_snapshot ?? undefined,
            staff_session_mat: lastStaffCheckin.session_mat_snapshot,
            staff_assignment_role: lastStaffCheckin.assignment_role_snapshot ?? undefined,
            staff_arrival_delta_minutes: lastStaffCheckin.arrival_delta_minutes ?? undefined,
            staff_match_candidate_count: lastStaffCheckin.session_match_candidate_count,
            message:
              lastStaffCheckin.session_match_status === 'matched'
                ? 'Recent staff check-in already recorded for the assigned session'
                : lastStaffCheckin.session_match_status === 'ambiguous'
                  ? 'Recent staff check-in already recorded; assigned session match needs review'
                  : 'Staff check-in already recorded recently; no assigned session matched',
          })
        }
      }

      const attendancePayload = matchedSession
        ? {
            staff_user_id: memberId,
            staff_name_snapshot: staffName,
            staff_member_id_snapshot: memberProfile.member_id,
            staff_role_snapshot: memberRole,
            attendance_date: today,
            checked_in_at: nowIso,
            scanned_by: actorId,
            device_tag: deviceTag,
            source: 'kiosk_qr',
            training_session_id: matchedSession.id,
            session_match_status: 'matched',
            session_match_candidate_count: candidates.length,
            assignment_role_snapshot: matchedSession.assignment_role,
            session_name_snapshot: matchedSession.name_snapshot,
            session_start_time_snapshot: matchedSession.start_time,
            session_end_time_snapshot: matchedSession.end_time,
            session_mat_snapshot: matchedSession.mat_snapshot,
            arrival_delta_minutes: matchedSession.delta_minutes,
          }
        : {
            staff_user_id: memberId,
            staff_name_snapshot: staffName,
            staff_member_id_snapshot: memberProfile.member_id,
            staff_role_snapshot: memberRole,
            attendance_date: today,
            checked_in_at: nowIso,
            scanned_by: actorId,
            device_tag: deviceTag,
            source: 'kiosk_qr',
            training_session_id: null,
            session_match_status: matchStatus,
            session_match_candidate_count: candidates.length,
            assignment_role_snapshot: null,
            session_name_snapshot: null,
            session_start_time_snapshot: null,
            session_end_time_snapshot: null,
            session_mat_snapshot: null,
            arrival_delta_minutes: null,
          }

      const { error: staffInsertErr } = await admin.from('coach_staff_attendance').insert(attendancePayload)

      if (staffInsertErr) {
        // The unique staff/session index is a final guard against concurrent duplicate scans.
        if (matchedSession && staffInsertErr.code === '23505') {
          const { data: existingSessionCheckin } = await admin
            .from('coach_staff_attendance')
            .select('checked_in_at,session_name_snapshot,session_start_time_snapshot,session_mat_snapshot,assignment_role_snapshot,arrival_delta_minutes,session_match_candidate_count')
            .eq('staff_user_id', memberId)
            .eq('training_session_id', matchedSession.id)
            .order('checked_in_at', { ascending: true })
            .limit(1)
            .maybeSingle<{
              checked_in_at: string
              session_name_snapshot: string | null
              session_start_time_snapshot: string | null
              session_mat_snapshot: string | null
              assignment_role_snapshot: 'primary_coach' | 'assistant_coach' | null
              arrival_delta_minutes: number | null
              session_match_candidate_count: number
            }>()

          if (existingSessionCheckin) {
            return json(meta, 200, {
              ok: true,
              valid: true,
              member_id: memberId,
              staff_checkin: true,
              staff_role: memberRole,
              staff_checked_in_at: existingSessionCheckin.checked_in_at,
              staff_already_checked_in: true,
              staff_session_match: 'matched',
              staff_training_session_id: matchedSession.id,
              staff_session_name: existingSessionCheckin.session_name_snapshot ?? matchedSession.name_snapshot,
              staff_session_start_time: existingSessionCheckin.session_start_time_snapshot ?? matchedSession.start_time,
              staff_session_mat: existingSessionCheckin.session_mat_snapshot ?? matchedSession.mat_snapshot,
              staff_assignment_role: existingSessionCheckin.assignment_role_snapshot ?? matchedSession.assignment_role,
              staff_arrival_delta_minutes: existingSessionCheckin.arrival_delta_minutes ?? matchedSession.delta_minutes,
              staff_match_candidate_count: existingSessionCheckin.session_match_candidate_count,
              message: 'Staff check-in already recorded for this assigned session',
            })
          }
        }

        logApiError(meta, 'staff_attendance_insert', staffInsertErr, { actor_id: actorId, staff_user_id: memberId })
        return json(meta, 500, { ok: false, message: staffInsertErr.message })
      }

      return json(meta, 200, {
        ok: true,
        valid: true,
        member_id: memberId,
        staff_checkin: true,
        staff_role: memberRole,
        staff_checked_in_at: nowIso,
        staff_already_checked_in: false,
        staff_session_match: matchStatus,
        staff_training_session_id: matchedSession?.id,
        staff_session_name: matchedSession?.name_snapshot,
        staff_session_start_time: matchedSession?.start_time,
        staff_session_mat: matchedSession?.mat_snapshot ?? null,
        staff_assignment_role: matchedSession?.assignment_role,
        staff_arrival_delta_minutes: matchedSession?.delta_minutes,
        staff_match_candidate_count: candidates.length,
        message: matchedSession
          ? 'Staff check-in linked to assigned scheduled session'
          : matchStatus === 'ambiguous'
            ? 'Staff check-in recorded; multiple assigned sessions were close to the scan time, so no automatic link was made'
            : 'Staff check-in recorded; no assigned scheduled session matched the scan time',
      })
    }

    const { data: existingAttendance, error: existingErr } = await admin
      .from('attendance')
      .select('id, valid, source')
      .eq('member_id', memberId)
      .eq('date', today)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; valid: boolean | null; source: string | null }>()

    if (existingErr) {
      logApiError(meta, 'existing_attendance_lookup', existingErr, { actor_id: actorId, member_id: memberId })
      return json(meta, 500, { ok: false, message: existingErr.message })
    }

    const existingId = existingAttendance?.id ?? null
    const alreadyValidToday = !!existingAttendance?.valid
    if (hasLifetimeGymAccess(memberRole)) {
      await persistAttendance(admin, existingId, {
        member_id: memberId,
        date: today,
        valid: true,
        status: 'ok',
        from_sessions: false,
        subscription_id: null,
        scanned_by: actorId,
        device_tag: deviceTag,
      })

      return json(meta, 200, {
        ok: true,
        valid: true,
        member_id: memberId,
        subscription_id: null,
        days_remaining: null,
        expires_on: null,
        message: alreadyValidToday ? 'Already checked in today' : 'Always active access',
      })
    }

    const { data: timeSub, error: timeErr } = await admin
      .from('subscriptions')
      .select('id, member_id, subscription_type, status, start_date, end_date, plan, frozen_from, frozen_until')
      .eq('member_id', memberId)
      .eq('subscription_type', 'time')
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today)
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string
        member_id: string
        subscription_type: 'time'
        status: 'active'
        start_date: string
        end_date: string
        plan: string | null
        frozen_from: string | null
        frozen_until: string | null
      }>()

    if (timeErr) {
      logApiError(meta, 'time_subscription_lookup', timeErr, { actor_id: actorId, member_id: memberId })
      return json(meta, 500, { ok: false, message: timeErr.message })
    }

    if (timeSub) {
      const isFrozen = !!(
        timeSub.frozen_until &&
        (timeSub.frozen_from ? today >= timeSub.frozen_from && today < timeSub.frozen_until : today < timeSub.frozen_until)
      )

      if (isFrozen) {
        const freezeDays = Math.max(0, daysBetweenUTC(today, timeSub.frozen_until as string))

        await persistAttendance(admin, existingId, {
          member_id: memberId,
          date: today,
          valid: false,
          status: 'frozen',
          from_sessions: false,
          subscription_id: timeSub.id,
          scanned_by: actorId,
          device_tag: deviceTag,
        })

        return json(meta, 200, {
          ok: true,
          valid: false,
          frozen: true,
          frozen_until: timeSub.frozen_until,
          freeze_days_remaining: freezeDays,
          member_id: memberId,
          subscription_id: timeSub.id,
          message: 'Subscription is frozen',
        })
      }

      const daysRemaining = Math.max(0, daysBetweenUTC(today, timeSub.end_date))

      await persistAttendance(admin, existingId, {
        member_id: memberId,
        date: today,
        valid: true,
        status: 'ok',
        from_sessions: false,
        subscription_id: timeSub.id,
        scanned_by: actorId,
        device_tag: deviceTag,
      })

      return json(meta, 200, {
        ok: true,
        valid: true,
        member_id: memberId,
        subscription_id: timeSub.id,
        days_remaining: daysRemaining,
        expires_on: timeSub.end_date,
        message: alreadyValidToday ? 'Already checked in today' : 'Active subscription',
      })
    }

    const { data: sessSub, error: sessErr } = await admin
      .from('subscriptions')
      .select('id, member_id, subscription_type, status, sessions_total, sessions_used')
      .eq('member_id', memberId)
      .eq('subscription_type', 'sessions')
      .eq('status', 'active')
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string
        member_id: string
        subscription_type: 'sessions'
        status: 'active'
        sessions_total: number | null
        sessions_used: number | null
      }>()

    if (sessErr) {
      logApiError(meta, 'sessions_subscription_lookup', sessErr, { actor_id: actorId, member_id: memberId })
      return json(meta, 500, { ok: false, message: sessErr.message })
    }

    if (sessSub) {
      const remaining = Math.max((sessSub.sessions_total ?? 0) - (sessSub.sessions_used ?? 0), 0)

      if (remaining > 0) {
        if (!alreadyValidToday) {
          const { error: subUpdateErr } = await admin
            .from('subscriptions')
            .update({ sessions_used: (sessSub.sessions_used ?? 0) + 1 })
            .eq('id', sessSub.id)

          if (subUpdateErr) {
            logApiError(meta, 'sessions_increment', subUpdateErr, { actor_id: actorId, member_id: memberId, subscription_id: sessSub.id })
            return json(meta, 500, { ok: false, message: subUpdateErr.message })
          }
        }

        await persistAttendance(admin, existingId, {
          member_id: memberId,
          date: today,
          valid: true,
          status: 'ok',
          from_sessions: true,
          subscription_id: sessSub.id,
          scanned_by: actorId,
          device_tag: deviceTag,
        })

        const remainingAfter = alreadyValidToday ? remaining : remaining - 1

        return json(meta, 200, {
          ok: true,
          valid: true,
          member_id: memberId,
          subscription_id: sessSub.id,
          days_remaining: null,
          expires_on: null,
          message: `Sessions remaining: ${remainingAfter}`,
        })
      }

      await persistAttendance(admin, existingId, {
        member_id: memberId,
        date: today,
        valid: false,
        status: 'expired',
        from_sessions: true,
        subscription_id: sessSub.id,
        scanned_by: actorId,
        device_tag: deviceTag,
      })

      return json(meta, 200, {
        ok: true,
        valid: false,
        member_id: memberId,
        subscription_id: sessSub.id,
        expired_days: 0,
        expired_on: today,
        message: 'No sessions left',
      })
    }

    const { data: lastSub, error: lastSubErr } = await admin
      .from('subscriptions')
      .select('end_date')
      .eq('member_id', memberId)
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle<{ end_date: string | null }>()

    if (lastSubErr) {
      logApiError(meta, 'last_subscription_lookup', lastSubErr, { actor_id: actorId, member_id: memberId })
      return json(meta, 500, { ok: false, message: lastSubErr.message })
    }

    const expiredOn = lastSub?.end_date || today
    const expiredDays = Math.max(0, daysBetweenUTC(expiredOn, today))

    await persistAttendance(admin, existingId, {
      member_id: memberId,
      date: today,
      valid: false,
      status: 'expired',
      from_sessions: false,
      subscription_id: null,
      scanned_by: actorId,
      device_tag: deviceTag,
    })

    return json(meta, 200, {
      ok: true,
      valid: false,
      member_id: memberId,
      subscription_id: null,
      expired_days: expiredDays,
      expired_on: expiredOn,
      message: 'No active subscription',
    })
  } catch (e: any) {
    logApiError(meta, 'unexpected', e, { actor_id: actorId, member_id: memberId, device_tag: deviceTag })
    return json(meta, 500, { ok: false, message: String(e?.message || e) })
  }
}
