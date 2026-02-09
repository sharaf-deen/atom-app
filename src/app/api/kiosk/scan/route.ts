// src/app/api/kiosk/scan/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10)
}

function daysBetweenUTC(fromDateOnly: string, toDateOnly: string) {
  const from = new Date(`${fromDateOnly}T00:00:00Z`).getTime()
  const to = new Date(`${toDateOnly}T00:00:00Z`).getTime()
  return Math.floor((to - from) / 86400000)
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function POST(req: Request) {
  const admin = makeAdminClient()
  if (!admin) {
    return json(500, { ok: false, message: 'Server missing service key' })
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

  const today = todayDateOnlyUTC()

  // Try TIME-based subscription first
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
    // Frozen logic (controlled range):
    // - If frozen_from exists: frozen when today >= frozen_from AND today < frozen_until (exclusive end)
    // - Legacy: if only frozen_until exists: frozen when today < frozen_until
    const isFrozen = !!(
      timeSub.frozen_until &&
      (timeSub.frozen_from
        ? today >= timeSub.frozen_from && today < timeSub.frozen_until
        : today < timeSub.frozen_until)
    )
    if (isFrozen) {
      const freezeDays = Math.max(0, daysBetweenUTC(today, timeSub.frozen_until as string))

      // Record attendance as invalid (frozen)
      await admin
        .from('attendance')
        .insert({ member_id: memberId, date: today, valid: false, from_sessions: false, subscription_id: timeSub.id })

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

    // Record attendance valid
    await admin
      .from('attendance')
      .insert({ member_id: memberId, date: today, valid: true, from_sessions: false, subscription_id: timeSub.id })

    return json(200, {
      ok: true,
      valid: true,
      member_id: memberId,
      subscription_id: timeSub.id,
      days_remaining: daysRemaining,
      expires_on: timeSub.end_date,
      message: 'Active subscription',
    })
  }

  // Otherwise check SESSIONS-based subscription
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
      // Decrement sessions_used and record attendance
      await admin
        .from('subscriptions')
        .update({ sessions_used: (sessSub.sessions_used ?? 0) + 1 })
        .eq('id', sessSub.id)

      await admin
        .from('attendance')
        .insert({ member_id: memberId, date: today, valid: true, from_sessions: true, subscription_id: sessSub.id })

      return json(200, {
        ok: true,
        valid: true,
        member_id: memberId,
        subscription_id: sessSub.id,
        days_remaining: null,
        expires_on: null,
        message: `Sessions remaining: ${remaining - 1}`,
      })
    }

    // sessions exhausted
    await admin
      .from('attendance')
      .insert({ member_id: memberId, date: today, valid: false, from_sessions: true, subscription_id: sessSub.id })

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

  // No active subscription found: compute most recent expired info
  const { data: lastSub } = await admin
    .from('subscriptions')
    .select('end_date')
    .eq('member_id', memberId)
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle<{ end_date: string | null }>()

  const expiredOn = lastSub?.end_date || today
  const expiredDays = Math.max(0, daysBetweenUTC(expiredOn, today))

  await admin
    .from('attendance')
    .insert({ member_id: memberId, date: today, valid: false, from_sessions: false, subscription_id: null })

  return json(200, {
    ok: true,
    valid: false,
    member_id: memberId,
    subscription_id: null,
    expired_days: expiredDays,
    expired_on: expiredOn,
    message: 'No active subscription',
  })
}
