// src/app/api/kiosk/scan/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

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
  scanned_at?: string | null
  valid?: boolean | null
  status?: string
  from_sessions?: boolean
  subscription_id?: string | null
  scanned_by?: string | null
  device_tag?: string | null
  source?: string
}

function json(status: number, body: ScanResponse) {
  return NextResponse.json(body, { status })
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

const CAIRO_TZ = 'Africa/Cairo'

function todayDateOnlyCairo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
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
  if (existingId) {
    const { error } = await admin.from('attendance').update(payload).eq('id', existingId)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await admin.from('attendance').insert(payload)
  if (error) throw new Error(error.message)
}

export async function POST(req: Request) {
  const admin = makeAdminClient()
  if (!admin) {
    return json(500, { ok: false, message: 'Server missing service key' })
  }

  const supa = createSupabaseServerActionClient()
  const { data: auth } = await supa.auth.getUser()
  if (!auth.user) {
    return json(401, { ok: false, message: 'Not authenticated' })
  }

  const actorId = auth.user.id
  const { data: actorProfile, error: actorErr } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', actorId)
    .maybeSingle<{ role: string | null }>()

  if (actorErr) {
    return json(500, { ok: false, message: actorErr.message })
  }

  const actorRole = actorProfile?.role ?? 'member'
  const isStaff = actorRole === 'reception' || actorRole === 'admin' || actorRole === 'super_admin'
  if (!isStaff) {
    return json(403, { ok: false, message: 'Forbidden' })
  }

  let body: ScanBody = {}
  try {
    body = (await req.json()) as ScanBody
  } catch {
    body = {}
  }

  const memberId = parseMemberIdFromCode(body.code || '')
  if (!memberId) {
    return json(400, { ok: false, message: 'Invalid QR code' })
  }

  const today = todayDateOnlyCairo()
  const scannedAt = new Date().toISOString()
  const deviceTag = (req.headers.get('x-device-tag') || '').slice(0, 64) || null

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
      return json(500, { ok: false, message: existingErr.message })
    }

    const existingId = existingAttendance?.id ?? null
    const alreadyValidToday = !!existingAttendance?.valid

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
      return json(500, { ok: false, message: timeErr.message })
    }

    if (timeSub) {
      const isFrozen = !!(
        timeSub.frozen_until &&
        (timeSub.frozen_from
          ? today >= timeSub.frozen_from && today < timeSub.frozen_until
          : today < timeSub.frozen_until)
      )

      if (isFrozen) {
        const freezeDays = Math.max(0, daysBetweenUTC(today, timeSub.frozen_until as string))

        await persistAttendance(admin, existingId, {
          member_id: memberId,
          date: today,
          scanned_at: scannedAt,
          valid: false,
          status: 'frozen',
          from_sessions: false,
          subscription_id: timeSub.id,
          scanned_by: actorId,
          device_tag: deviceTag,
          source: 'kiosk',
        })

        return json(200, {
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

      // Important fix:
      // even if already valid today, rewrite scanner context so scan_audit sees source='kiosk'
      await persistAttendance(admin, existingId, {
        member_id: memberId,
        date: today,
        scanned_at: scannedAt,
        valid: true,
        status: 'ok',
        from_sessions: false,
        subscription_id: timeSub.id,
        scanned_by: actorId,
        device_tag: deviceTag,
        source: 'kiosk',
      })

      return json(200, {
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
      return json(500, { ok: false, message: sessErr.message })
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
            return json(500, { ok: false, message: subUpdateErr.message })
          }
        }

        // Important fix:
        // also rewrite existing valid attendance row to keep source='kiosk'
        await persistAttendance(admin, existingId, {
          member_id: memberId,
          date: today,
          scanned_at: scannedAt,
          valid: true,
          status: 'ok',
          from_sessions: true,
          subscription_id: sessSub.id,
          scanned_by: actorId,
          device_tag: deviceTag,
          source: 'kiosk',
        })

        const remainingAfter = alreadyValidToday ? remaining : remaining - 1

        return json(200, {
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
        scanned_at: scannedAt,
        valid: false,
        status: 'expired',
        from_sessions: true,
        subscription_id: sessSub.id,
        scanned_by: actorId,
        device_tag: deviceTag,
        source: 'kiosk',
      })

      return json(200, {
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
      return json(500, { ok: false, message: lastSubErr.message })
    }

    const expiredOn = lastSub?.end_date || today
    const expiredDays = Math.max(0, daysBetweenUTC(expiredOn, today))

    await persistAttendance(admin, existingId, {
      member_id: memberId,
      date: today,
      scanned_at: scannedAt,
      valid: false,
      status: 'expired',
      from_sessions: false,
      subscription_id: null,
      scanned_by: actorId,
      device_tag: deviceTag,
      source: 'kiosk',
    })

    return json(200, {
      ok: true,
      valid: false,
      member_id: memberId,
      subscription_id: null,
      expired_days: expiredDays,
      expired_on: expiredOn,
      message: 'No active subscription',
    })
  } catch (e: any) {
    return json(500, { ok: false, message: String(e?.message || e) })
  }
}