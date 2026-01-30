// src/app/api/subscriptions/update/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  return NextResponse.json(body, { status })
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function addMonthsSafe(dateOnly: string, months: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const targetMonth = base.getUTCMonth() + months

  // last day of target month
  const tmp = new Date(Date.UTC(y, m - 1, 1))
  tmp.setUTCMonth(targetMonth + 1, 0)
  const lastDay = tmp.getUTCDate()

  const clampedDay = Math.min(d, lastDay)
  const out = new Date(Date.UTC(y, m - 1, clampedDay))
  out.setUTCMonth(targetMonth)
  return out.toISOString().slice(0, 10)
}

function planToMonths(plan: string) {
  switch (plan) {
    case '1m':
      return 1
    case '3m':
      return 3
    case '6m':
      return 6
    case '12m':
      return 12
    default:
      return 0
  }
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
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

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const id = String(body?.id || '')
  const patch = body?.patch ?? null

  if (!id) return json(400, { ok: false, error: 'Missing subscription id' })
  if (!patch || typeof patch !== 'object') return json(400, { ok: false, error: 'Missing patch' })

  // Read current subscription to apply safe rules (plan -> end_date, etc.)
  const { data: current, error: curErr } = await admin
    .from('subscriptions')
    .select('id, subscription_type, start_date, end_date, plan, status, frozen_until, sessions_total')
    .eq('id', id)
    .maybeSingle<{
      id: string
      subscription_type: 'time' | 'sessions' | null
      start_date: string | null
      end_date: string | null
      plan: string | null
      status: string | null
      frozen_until: string | null
      sessions_total: number | null
    }>()

  if (curErr) return json(500, { ok: false, error: curErr.message })
  if (!current) return json(404, { ok: false, error: 'Subscription not found' })

  const update: any = {}

  // Amount
  if (patch.amount !== undefined) {
    const amount = Number(patch.amount)
    if (!Number.isFinite(amount) || amount < 0) return json(400, { ok: false, error: 'Invalid amount' })
    update.amount = amount
  }

  // Status (optional) — only allow existing DB values (prevents "suspended")
  if (patch.status !== undefined) {
    const s = String(patch.status)
    if (!['active', 'expired'].includes(s)) {
      return json(400, {
        ok: false,
        error: `Invalid status: ${s}. Allowed: active, expired`,
      })
    }
    update.status = s
  }

  // Start/end date (optional)
  if (patch.start_date !== undefined) {
    const sd = String(patch.start_date)
    if (!isISODateOnly(sd)) return json(400, { ok: false, error: 'Invalid start_date (YYYY-MM-DD)' })
    update.start_date = sd
  }
  if (patch.end_date !== undefined) {
    const ed = String(patch.end_date)
    if (!isISODateOnly(ed)) return json(400, { ok: false, error: 'Invalid end_date (YYYY-MM-DD)' })
    update.end_date = ed
  }

  // Plan (time subscriptions)
  if (patch.plan !== undefined) {
    const p = String(patch.plan)
    if (!['1m', '3m', '6m', '12m', 'sessions'].includes(p)) {
      return json(400, { ok: false, error: 'Invalid plan' })
    }
    update.plan = p
  }

  // Sessions total (sessions subscriptions)
  if (patch.sessions_total !== undefined) {
    const st = Number(patch.sessions_total)
    if (!Number.isFinite(st) || st < 1) return json(400, { ok: false, error: 'Invalid sessions_total' })
    update.sessions_total = Math.floor(st)
  }

  // If time subscription and start_date/plan were edited (or only one), compute end_date
  if (current.subscription_type === 'time' && (patch.plan !== undefined || patch.start_date !== undefined)) {
    const finalStart = (update.start_date as string | undefined) ?? current.start_date
    const finalPlan = (update.plan as string | undefined) ?? current.plan

    if (!finalStart || !isISODateOnly(finalStart)) {
      return json(400, { ok: false, error: 'Start date is required for time plans' })
    }
    if (!finalPlan || typeof finalPlan !== 'string') {
      return json(400, { ok: false, error: 'Plan is required for time plans' })
    }
    if (finalPlan === 'sessions') {
      return json(400, { ok: false, error: 'Invalid plan for time subscription' })
    }

    const months = planToMonths(finalPlan)
    if (months <= 0) return json(400, { ok: false, error: 'Invalid plan' })

    update.plan = finalPlan
    update.start_date = finalStart
    update.end_date = addMonthsSafe(finalStart, months)
  }

  // For session subscriptions, ignore plan changes silently (UI won’t send it)
  if (current.subscription_type === 'sessions' && patch.plan !== undefined) {
    delete update.plan
  }

  if (Object.keys(update).length === 0) {
    return json(400, { ok: false, error: 'Nothing to update' })
  }

  const { data: updated, error: updErr } = await admin
    .from('subscriptions')
    .update(update)
    .eq('id', id)
    .select('id, subscription_type, plan, status, start_date, end_date, frozen_until, sessions_total, sessions_used, amount')
    .maybeSingle()

  if (updErr) return json(500, { ok: false, error: updErr.message })

  return json(200, { ok: true, subscription: updated })
}
