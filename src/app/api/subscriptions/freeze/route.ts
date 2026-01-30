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

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
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

  let payload: any = null
  try {
    payload = await req.json()
  } catch {
    payload = null
  }

  const id = String(payload?.id || '')
  const days = Number(payload?.days)

  if (!id) return json(400, { ok: false, error: 'Missing subscription id' })
  if (!Number.isFinite(days) || days <= 0) {
    return json(400, { ok: false, error: 'Invalid days' })
  }

  const { data: current, error: readErr } = await admin
    .from('subscriptions')
    .select('id, end_date, frozen_until')
    .eq('id', id)
    .maybeSingle<{ id: string; end_date: string | null; frozen_until: string | null }>()

  if (readErr) return json(500, { ok: false, error: readErr.message })
  if (!current) return json(404, { ok: false, error: 'Subscription not found' })

  const today = todayDateOnlyUTC()
  const base = current.frozen_until && isISODateOnly(current.frozen_until) && current.frozen_until > today ? current.frozen_until : today
  const newFrozenUntil = addDays(base, Math.floor(days))

  const newEndDate =
    current.end_date && isISODateOnly(current.end_date)
      ? addDays(current.end_date, Math.floor(days))
      : current.end_date

  const { data: updated, error: updErr } = await admin
    .from('subscriptions')
    .update({
      frozen_until: newFrozenUntil,
      end_date: newEndDate,
    })
    .eq('id', id)
    .select('id, end_date, frozen_until')
    .maybeSingle()

  if (updErr) return json(500, { ok: false, error: updErr.message })

  return json(200, {
    ok: true,
    frozen_until: (updated as any)?.frozen_until ?? newFrozenUntil,
    end_date: (updated as any)?.end_date ?? newEndDate,
  })
}
