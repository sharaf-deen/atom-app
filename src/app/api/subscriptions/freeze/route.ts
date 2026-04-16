// src/app/api/subscriptions/freeze/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cairoTodayDateOnly, isISODateOnly } from '@/lib/cairoTime'
import { getFreezeTokenAllowance, isSubscriptionFreezeOpen } from '@/lib/subscriptionFreeze'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  return NextResponse.json(body, { status })
}

function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
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

type FreezePayload = {
  id?: string
  // Controlled range: from/to are date-only strings; `to` is inclusive from the UI perspective.
  from?: string
  to?: string
  // Clear any freeze (existing fallback path; not exposed as part of Freeze B create flow)
  clear?: boolean
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })

  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', me.data.user.id)
    .maybeSingle<{ role: string | null }>()

  const role = prof?.role ?? 'member'
  if (role !== 'super_admin') {
    return json(403, { ok: false, error: 'Only super admins can manage subscription freezes.' })
  }

  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })

  let payload: FreezePayload | null = null
  try {
    payload = (await req.json()) as FreezePayload
  } catch {
    payload = null
  }

  const id = String(payload?.id || '')
  if (!id) return json(400, { ok: false, error: 'Missing subscription id' })

  const today = cairoTodayDateOnly()

  const { data: current, error: readErr } = await admin
    .from('subscriptions')
    .select('id, subscription_type, plan, status, end_date, frozen_from, frozen_until')
    .eq('id', id)
    .maybeSingle<{
      id: string
      subscription_type: 'time' | 'sessions' | null
      plan: string | null
      status: string | null
      end_date: string | null
      frozen_from: string | null
      frozen_until: string | null
    }>()

  if (readErr) return json(500, { ok: false, error: readErr.message })
  if (!current) return json(404, { ok: false, error: 'Subscription not found' })

  const stype = (current.subscription_type as any) as 'time' | 'sessions' | null
  if (stype !== 'time') {
    return json(400, { ok: false, error: 'Freeze is only available for time subscriptions.' })
  }

  const plan = String(current.plan || '')
  const maxFreezeTokens = getFreezeTokenAllowance(plan, stype)
  if (maxFreezeTokens < 1) {
    return json(400, { ok: false, error: 'Freeze is only available for 3, 6, or 12 month subscriptions.' })
  }

  if (current.status !== 'active') {
    return json(400, { ok: false, error: 'Freeze is only available for active subscriptions.' })
  }

  if (!isISODateOnly(current.end_date) || current.end_date < today) {
    return json(400, { ok: false, error: 'Freeze is only available for subscriptions that are still active today.' })
  }

  const currentEndDate = current.end_date

  const { data: freezeRows, error: freezeReadErr } = await admin
    .from('subscription_freezes')
    .select('id, freeze_from, freeze_until, days, cleared_at')
    .eq('subscription_id', id)
    .order('created_at', { ascending: false })

  if (freezeReadErr) return json(500, { ok: false, error: freezeReadErr.message })

  const freezeHistory = Array.isArray(freezeRows) ? freezeRows : []
  const openFreezeRow = freezeHistory.find((row: any) => isSubscriptionFreezeOpen(row, today)) ?? null
  const usedFreezeTokens = freezeHistory.length

  const oldFrom = isISODateOnly(current.frozen_from) && current.frozen_until && current.frozen_until > today ? current.frozen_from : null
  const oldUntil = isISODateOnly(current.frozen_until) && current.frozen_until > today ? current.frozen_until : null

  let oldDays = 0
  if (oldFrom && oldUntil && oldUntil > oldFrom) {
    oldDays = Math.max(0, daysBetweenUTC(oldFrom, oldUntil))
  } else if (!oldFrom && oldUntil && oldUntil > today) {
    oldDays = Math.max(0, daysBetweenUTC(today, oldUntil))
  }

  const clear = !!payload?.clear
  const from = payload?.from
  const to = payload?.to

  let newFrom: string | null = null
  let newUntil: string | null = null
  let newDays = 0

  if (clear) {
    if (!openFreezeRow) {
      return json(400, { ok: false, error: 'No active or scheduled freeze found for this subscription.' })
    }
    newFrom = null
    newUntil = null
    newDays = 0
  } else if (isISODateOnly(from) && isISODateOnly(to)) {
    if (from < today) {
      return json(400, { ok: false, error: 'Freeze start date cannot be in the past.' })
    }
    if (from > to) return json(400, { ok: false, error: 'Freeze end date must be after start date.' })
    if (from > currentEndDate) {
      return json(400, { ok: false, error: 'Freeze start date must be within the current subscription coverage.' })
    }

    const untilExclusive = addDays(to, 1)
    newFrom = from
    newUntil = untilExclusive
    newDays = Math.max(0, daysBetweenUTC(from, untilExclusive))

    if (newDays < 1) {
      return json(400, { ok: false, error: 'Freeze must be at least 1 day.' })
    }
    if (newDays > 30) {
      return json(400, { ok: false, error: 'Each freeze is limited to 30 days maximum.' })
    }
  } else {
    return json(400, { ok: false, error: 'Provide a valid freeze date range.' })
  }

  const deltaDays = newDays - oldDays

  let newEndDate: string | null = currentEndDate
  if (deltaDays !== 0) {
    newEndDate = addDays(currentEndDate, deltaDays)
  }

  if (!clear) {
    if (openFreezeRow) {
      return json(409, { ok: false, error: 'A freeze is already active or scheduled for this subscription.' })
    }
    if (usedFreezeTokens >= maxFreezeTokens) {
      return json(400, {
        ok: false,
        error:
          maxFreezeTokens === 1
            ? 'This subscription has already used its only freeze token.'
            : `This subscription has already used all ${maxFreezeTokens} freeze tokens.`,
      })
    }
  }

  const nowIso = new Date().toISOString()

  if (clear && openFreezeRow) {
    const { error: clearFreezeErr } = await admin
      .from('subscription_freezes')
      .update({
        cleared_at: nowIso,
        cleared_by: me.data.user.id,
        updated_at: nowIso,
        updated_by: me.data.user.id,
      })
      .eq('id', (openFreezeRow as any).id)
    if (clearFreezeErr) return json(500, { ok: false, error: clearFreezeErr.message })
  } else if (!clear) {
    const { error: insertFreezeErr } = await admin
      .from('subscription_freezes')
      .insert({
        subscription_id: id,
        freeze_from: newFrom,
        freeze_until: newUntil,
        days: newDays,
        created_by: me.data.user.id,
        updated_at: nowIso,
        updated_by: me.data.user.id,
      })
    if (insertFreezeErr) return json(500, { ok: false, error: insertFreezeErr.message })
  }

  const patch: any = {
    frozen_from: newFrom,
    frozen_until: newUntil,
    end_date: newEndDate,
  }

  const { data: updated, error: updErr } = await admin
    .from('subscriptions')
    .update(patch)
    .eq('id', id)
    .select('id, subscription_type, plan, status, end_date, frozen_from, frozen_until')
    .maybeSingle()

  if (updErr) return json(500, { ok: false, error: updErr.message })

  return json(200, {
    ok: true,
    id,
    subscription_type: (updated as any)?.subscription_type ?? 'time',
    frozen_from: (updated as any)?.frozen_from ?? newFrom,
    frozen_until: (updated as any)?.frozen_until ?? newUntil,
    end_date: (updated as any)?.end_date ?? newEndDate,
    delta_days: deltaDays,
    freeze_tokens_used: clear ? usedFreezeTokens : usedFreezeTokens + 1,
    freeze_tokens_allowed: maxFreezeTokens,
  })
}
