// src/app/api/subscriptions/freeze/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cairoTodayDateOnly, isISODateOnly } from '@/lib/cairoTime'
import {
  getConsumptiveSubscriptionFreezeHistory,
  getFreezeTokenAllowance,
  isSubscriptionFreezeOpen,
  pickSubscriptionSurfaceFreezeRow,
  subscriptionFreezeRangesOverlap,
  sumConsumptiveSubscriptionFreezeDays,
  type SubscriptionFreezeHistoryRow,
} from '@/lib/subscriptionFreeze'
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

type FreezeAction = 'create' | 'update' | 'delete'

type FreezePayload = {
  id?: string
  action?: FreezeAction
  freeze_id?: string
  // Controlled range: from/to are date-only strings; `to` is inclusive from the UI perspective.
  from?: string
  to?: string
  // Backward-compatible fallback from earlier lots.
  clear?: boolean
}

function resolveAction(payload: FreezePayload | null): FreezeAction {
  if (payload?.clear) return 'delete'
  if (payload?.action === 'update' || payload?.action === 'delete' || payload?.action === 'create') {
    return payload.action
  }
  return payload?.freeze_id ? 'update' : 'create'
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

  const action = resolveAction(payload)
  const today = cairoTodayDateOnly()

  const { data: current, error: readErr } = await admin
    .from('subscriptions')
    .select('id, subscription_type, plan, status, start_date, end_date, frozen_from, frozen_until')
    .eq('id', id)
    .maybeSingle<{
      id: string
      subscription_type: 'time' | 'sessions' | null
      plan: string | null
      status: string | null
      start_date: string | null
      end_date: string | null
      frozen_from: string | null
      frozen_until: string | null
    }>()

  if (readErr) return json(500, { ok: false, error: readErr.message })
  if (!current) return json(404, { ok: false, error: 'Subscription not found' })

  const stype = (current.subscription_type as any) as 'time' | 'sessions' | null
  const plan = String(current.plan || '')
  const maxFreezeTokens = getFreezeTokenAllowance(plan, stype)

  if (!isISODateOnly(current.end_date)) {
    return json(400, { ok: false, error: 'Subscription end date is invalid.' })
  }

  const currentEndDate = current.end_date

  const { data: freezeRows, error: freezeReadErr } = await admin
    .from('subscription_freezes')
    .select('id, subscription_id, freeze_from, freeze_until, days, created_at, created_by, updated_at, updated_by, cleared_at, cleared_by')
    .eq('subscription_id', id)
    .order('freeze_from', { ascending: false })
    .order('created_at', { ascending: false })

  if (freezeReadErr) return json(500, { ok: false, error: freezeReadErr.message })

  const freezeHistory = getConsumptiveSubscriptionFreezeHistory((freezeRows ?? []) as SubscriptionFreezeHistoryRow[])
  const usedFreezeTokens = freezeHistory.length
  const totalFreezeDays = sumConsumptiveSubscriptionFreezeDays(freezeHistory)
  const baseEndDate = addDays(currentEndDate, -totalFreezeDays)
  const openFreezeRows = freezeHistory.filter((row) => isSubscriptionFreezeOpen(row, today))
  const fallbackOpenFreezeRow = openFreezeRows[0] ?? null

  const targetFreezeId = String(payload?.freeze_id || '')
  const targetRow = action === 'create'
    ? null
    : (targetFreezeId ? freezeHistory.find((row) => row.id === targetFreezeId) ?? null : fallbackOpenFreezeRow)

  if (action !== 'create' && !targetRow) {
    return json(404, { ok: false, error: 'Freeze not found.' })
  }

  if (action === 'create') {
    if (stype !== 'time') {
      return json(400, { ok: false, error: 'Freeze is only available for time subscriptions.' })
    }
    if (maxFreezeTokens < 1) {
      return json(400, { ok: false, error: 'Freeze is only available for 3, 6, or 12 month subscriptions.' })
    }
    if (current.status !== 'active') {
      return json(400, { ok: false, error: 'Freeze is only available for active subscriptions.' })
    }
    if (currentEndDate < today) {
      return json(400, { ok: false, error: 'Freeze is only available for subscriptions that are still active today.' })
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

  const from = payload?.from
  const to = payload?.to

  let nextRow: SubscriptionFreezeHistoryRow | null = null

  if (action === 'create' || action === 'update') {
    if (!isISODateOnly(from) || !isISODateOnly(to)) {
      return json(400, { ok: false, error: 'Provide a valid freeze date range.' })
    }
    if (from > to) {
      return json(400, { ok: false, error: 'Freeze end date must be after start date.' })
    }

    if (action === 'create' && from < today) {
      return json(400, { ok: false, error: 'Freeze start date cannot be in the past.' })
    }

    if (isISODateOnly(current.start_date) && from < current.start_date) {
      return json(400, { ok: false, error: 'Freeze cannot start before the subscription start date.' })
    }
    if (from > currentEndDate) {
      return json(400, { ok: false, error: 'Freeze start date must be within the current subscription coverage.' })
    }

    const untilExclusive = addDays(to, 1)
    const newDays = Math.max(0, daysBetweenUTC(from, untilExclusive))
    if (newDays < 1) {
      return json(400, { ok: false, error: 'Freeze must be at least 1 day.' })
    }
    if (newDays > 30) {
      return json(400, { ok: false, error: 'Each freeze is limited to 30 days maximum.' })
    }

    nextRow = {
      id: targetRow?.id ?? 'pending-create',
      subscription_id: id,
      freeze_from: from,
      freeze_until: untilExclusive,
      days: newDays,
      created_at: targetRow?.created_at ?? null,
      created_by: targetRow?.created_by ?? null,
      updated_at: null,
      updated_by: null,
      cleared_at: null,
      cleared_by: null,
    }
  }

  const projectedFreezeHistory =
    action === 'create'
      ? [...freezeHistory, nextRow!]
      : action === 'update'
        ? freezeHistory.map((row) => (row.id === targetRow!.id ? nextRow! : row))
        : freezeHistory.filter((row) => row.id !== targetRow!.id)

  if (nextRow) {
    const overlapRow = projectedFreezeHistory.find((row) => {
      if (row.id === nextRow?.id) return false
      return subscriptionFreezeRangesOverlap(row, nextRow)
    })
    if (overlapRow) {
      return json(409, { ok: false, error: 'Freeze dates cannot overlap with another freeze on the same subscription.' })
    }
  }

  const projectedTotalDays = sumConsumptiveSubscriptionFreezeDays(projectedFreezeHistory)
  const newEndDate = addDays(baseEndDate, projectedTotalDays)
  const projectedOpenRow = pickSubscriptionSurfaceFreezeRow(projectedFreezeHistory, today)

  const nowIso = new Date().toISOString()

  if (action === 'create') {
    const { error: insertFreezeErr } = await admin
      .from('subscription_freezes')
      .insert({
        subscription_id: id,
        freeze_from: nextRow?.freeze_from,
        freeze_until: nextRow?.freeze_until,
        days: nextRow?.days,
        created_by: me.data.user.id,
        updated_at: nowIso,
        updated_by: me.data.user.id,
      })
    if (insertFreezeErr) return json(500, { ok: false, error: insertFreezeErr.message })
  } else if (action === 'update') {
    const { error: updateFreezeErr } = await admin
      .from('subscription_freezes')
      .update({
        freeze_from: nextRow?.freeze_from,
        freeze_until: nextRow?.freeze_until,
        days: nextRow?.days,
        updated_at: nowIso,
        updated_by: me.data.user.id,
      })
      .eq('id', targetRow!.id)
    if (updateFreezeErr) return json(500, { ok: false, error: updateFreezeErr.message })
  } else {
    const { error: clearFreezeErr } = await admin
      .from('subscription_freezes')
      .update({
        cleared_at: nowIso,
        cleared_by: me.data.user.id,
        updated_at: nowIso,
        updated_by: me.data.user.id,
      })
      .eq('id', targetRow!.id)
    if (clearFreezeErr) return json(500, { ok: false, error: clearFreezeErr.message })
  }

  const patch: any = {
    frozen_from: projectedOpenRow?.freeze_from ?? null,
    frozen_until: projectedOpenRow?.freeze_until ?? null,
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
    action,
    id,
    freeze_id: targetRow?.id ?? null,
    subscription_type: (updated as any)?.subscription_type ?? current.subscription_type ?? 'time',
    frozen_from: (updated as any)?.frozen_from ?? projectedOpenRow?.freeze_from ?? null,
    frozen_until: (updated as any)?.frozen_until ?? projectedOpenRow?.freeze_until ?? null,
    end_date: (updated as any)?.end_date ?? newEndDate,
    freeze_tokens_used: projectedFreezeHistory.length,
    freeze_tokens_allowed: maxFreezeTokens,
  })
}
