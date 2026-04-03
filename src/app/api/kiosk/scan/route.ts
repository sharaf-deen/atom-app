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

    const { data: memberProfile, error: memberProfileErr } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', memberId)
      .maybeSingle<{ role: string | null }>()

    if (memberProfileErr) {
      logApiError(meta, 'member_profile_lookup', memberProfileErr, { actor_id: actorId, member_id: memberId })
      return json(meta, 500, { ok: false, message: memberProfileErr.message })
    }

    if (!memberProfile) {
      return json(meta, 404, { ok: false, message: 'Member not found' })
    }

    const memberRole = normalizeRole(memberProfile.role ?? 'member')
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
