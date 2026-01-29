// src/app/api/subscriptions/update/route.ts
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
    const patch = body?.patch ?? {}
    if (!id) return json(400, { ok: false, error: 'MISSING_ID' })

    const update: any = {}

    if (typeof patch?.status === 'string') {
      const s = patch.status.trim()
      if (!s) return json(400, { ok: false, error: 'INVALID_STATUS' })
      update.status = s
    }

    if (patch?.start_date === null || typeof patch?.start_date === 'string') {
      const v = patch.start_date
      if (v !== null && v !== '' && !isISODateOnly(v)) {
        return json(400, { ok: false, error: 'INVALID_START_DATE', details: 'start_date must be YYYY-MM-DD' })
      }
      update.start_date = v === '' ? null : v
    }

    if (patch?.end_date === null || typeof patch?.end_date === 'string') {
      const v = patch.end_date
      if (v !== null && v !== '' && !isISODateOnly(v)) {
        return json(400, { ok: false, error: 'INVALID_END_DATE', details: 'end_date must be YYYY-MM-DD' })
      }
      update.end_date = v === '' ? null : v
    }

    if (typeof patch?.amount !== 'undefined') {
      const n = Number(patch.amount)
      if (!Number.isFinite(n) || n < 0) {
        return json(400, { ok: false, error: 'INVALID_AMOUNT' })
      }
      update.amount = n
    }

    if (typeof patch?.sessions_total !== 'undefined') {
      if (patch.sessions_total === null) {
        update.sessions_total = null
      } else {
        const n = Number(patch.sessions_total)
        if (!Number.isFinite(n) || n < 0) {
          return json(400, { ok: false, error: 'INVALID_SESSIONS_TOTAL' })
        }
        update.sessions_total = Math.floor(n)
      }
    }

    if (Object.keys(update).length === 0) {
      return json(400, { ok: false, error: 'EMPTY_PATCH' })
    }

    const { data, error } = await admin
      .from('subscriptions')
      .update(update)
      .eq('id', id)
      .select('id, member_id, plan, subscription_type, status, start_date, end_date, sessions_total, sessions_used, amount, paid_at')
      .maybeSingle()

    if (error) return json(500, { ok: false, error: 'UPDATE_FAILED', details: error.message })
    if (!data) return json(404, { ok: false, error: 'NOT_FOUND' })

    return json(200, { ok: true, subscription: data })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
