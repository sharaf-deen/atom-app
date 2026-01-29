// src/app/api/subscriptions/freeze/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function addDays(dateOnlyStr: string, days: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function dateOnlyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth + admin only
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = me?.role ?? 'member'
    const canManage = ['admin', 'super_admin'].includes(role)
    if (!canManage) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const days = Number(body?.days)
    if (!id) return json(400, { ok: false, error: 'MISSING_ID' })
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return json(400, { ok: false, error: 'INVALID_DAYS', details: 'days must be between 1 and 3650' })
    }

    // Fetch current subscription
    const { data: sub, error: subErr } = await admin
      .from('subscriptions')
      .select('id, status, end_date')
      .eq('id', id)
      .maybeSingle<{ id: string; status: string | null; end_date: string | null }>()

    if (subErr) return json(500, { ok: false, error: 'LOOKUP_FAILED', details: subErr.message })
    if (!sub) return json(404, { ok: false, error: 'NOT_FOUND' })

    const endDate = sub.end_date
    if (endDate && !isISODateOnly(endDate)) {
      return json(400, { ok: false, error: 'INVALID_END_DATE', details: 'end_date is not YYYY-MM-DD' })
    }

    const newEndDate = endDate ? addDays(endDate, Math.floor(days)) : null
    const today = dateOnlyUTC()
    const freezeUntil = addDays(today, Math.floor(days))

    // Use status = suspended for compatibility with existing DB constraints
    const update: any = {
      status: 'suspended',
    }
    if (newEndDate) update.end_date = newEndDate
    // Optional “note” fields don't exist in the schema; we keep freezeUntil only in the response.

    const { data: updated, error: upErr } = await admin
      .from('subscriptions')
      .update(update)
      .eq('id', id)
      .select('id, member_id, plan, subscription_type, status, start_date, end_date, sessions_total, sessions_used, amount, paid_at')
      .maybeSingle()

    if (upErr) return json(500, { ok: false, error: 'FREEZE_FAILED', details: upErr.message })
    if (!updated) return json(500, { ok: false, error: 'FREEZE_FAILED' })

    return json(200, { ok: true, subscription: updated, freeze_until: freezeUntil })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
