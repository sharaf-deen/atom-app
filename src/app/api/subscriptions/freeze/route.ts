// src/app/api/subscriptions/freeze/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  return NextResponse.json(body, { status })
}

function isISODateOnly(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10)
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
  // Legacy: add X days from now / extend.
  days?: number
  // Clear any freeze
  clear?: boolean
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })

  // Only admin / super_admin
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', me.data.user.id)
    .maybeSingle<{ role: string | null }>()

  const role = prof?.role ?? 'member'
  if (role !== 'admin' && role !== 'super_admin') {
    return json(403, { ok: false, error: 'Forbidden' })
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

  const today = todayDateOnlyUTC()

  const { data: current, error: readErr } = await admin
    .from('subscriptions')
    .select('id, subscription_type, end_date, frozen_from, frozen_until')
    .eq('id', id)
    .maybeSingle<{
      id: string
      subscription_type: 'time' | 'sessions' | null
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

  const oldFrom = isISODateOnly((current as any).frozen_from) ? (current as any).frozen_from : null
  const oldUntil = isISODateOnly((current as any).frozen_until) ? (current as any).frozen_until : null

  // Old duration (best-effort):
  // - if we have a real range, use it (exclusive end)
  // - if legacy (until only) and still in the future, use remaining days
  // - otherwise 0
  let oldDays = 0
  if (oldFrom && oldUntil && oldUntil > oldFrom) {
    oldDays = Math.max(0, daysBetweenUTC(oldFrom as string, oldUntil as string))
  } else if (!oldFrom && oldUntil && oldUntil > today) {
    oldDays = Math.max(0, daysBetweenUTC(today, oldUntil as string))
  }

  // New freeze
  const clear = !!payload?.clear
  const from = payload?.from
  const to = payload?.to
  const days = payload?.days

  let newFrom: string | null = null
  let newUntil: string | null = null
  let newDays = 0

  if (clear) {
    newFrom = null
    newUntil = null
    newDays = 0
  } else if (isISODateOnly(from) && isISODateOnly(to)) {
    if (from > to) return json(400, { ok: false, error: 'Freeze end date must be after start date.' })
    // store exclusive end (UI 'to' is inclusive)
    const untilExclusive = addDays(to, 1)
    newFrom = from
    newUntil = untilExclusive
    newDays = Math.max(0, daysBetweenUTC(from, untilExclusive))
  } else if (Number.isFinite(Number(days)) && Number(days) > 0) {
    const add = Math.floor(Number(days))
    // Legacy behavior: extend from later of today or current frozen_until (if in the future)
    const baseUntil = oldUntil && oldUntil > today ? oldUntil : today
    const nf = (oldFrom ?? today) as string
    const nu = addDays(baseUntil, add)
    newFrom = nf
    newUntil = nu
    newDays = oldFrom && oldUntil && oldUntil > oldFrom
      ? Math.max(0, daysBetweenUTC(oldFrom as string, nu))
      : Math.max(0, daysBetweenUTC(nf, nu))
  } else {
    return json(400, { ok: false, error: 'Provide either {from,to} or {days} or {clear:true}.' })
  }

  // Adjust end_date by delta days so it can move backwards if freeze shrinks/clears.
  const deltaDays = newDays - oldDays

  let newEndDate: string | null = current.end_date
  if (deltaDays !== 0 && isISODateOnly(current.end_date)) {
    newEndDate = addDays(current.end_date as string, deltaDays)
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
    .select('id, subscription_type, end_date, frozen_from, frozen_until')
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
  })
}