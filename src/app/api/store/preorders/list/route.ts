export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const ALLOWED_PREORDER_ROLES = new Set([
  'member',
  'coach',
  'assistant_coach',
  'head_coach',
  'vip',
  'champion',
  'super_admin',
])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function json(status: number, body: any) {
  return noStore(NextResponse.json(body, { status }))
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

function createSupabaseFromRoute(req: NextRequest) {
  const cookieOps: Array<
    | { type: 'set'; name: string; value: string; options: CookieOptions }
    | { type: 'remove'; name: string; options: CookieOptions }
  > = []

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get: (name: string) => req.cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        cookieOps.push({ type: 'set', name, value, options })
      },
      remove: (name: string, options: CookieOptions) => {
        cookieOps.push({ type: 'remove', name, options })
      },
    },
  })

  const applyCookies = (res: NextResponse) => {
    for (const op of cookieOps) {
      if (op.type === 'set') {
        res.cookies.set({ name: op.name, value: op.value, ...op.options })
      } else {
        res.cookies.set({ name: op.name, value: '', ...op.options, maxAge: 0 })
      }
    }
    return res
  }

  return { supabase, applyCookies }
}

export async function GET(req: NextRequest) {
  const { supabase, applyCookies } = createSupabaseFromRoute(req)
  const url = new URL(req.url)

  const mine = url.searchParams.get('mine') === '1'
  if (!mine) {
    return applyCookies(json(400, { ok: false, error: 'MINE_ONLY_SUPPORTED' }))
  }

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr || !auth?.user) {
    return applyCookies(json(401, { ok: false, error: 'AUTH_ERROR', details: authErr?.message || 'Not authenticated' }))
  }

  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  if (meErr) {
    return applyCookies(json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message }))
  }

  const role = (me?.role || 'member').toString()
  if (!ALLOWED_PREORDER_ROLES.has(role)) {
    return applyCookies(json(403, { ok: false, error: 'FORBIDDEN' }))
  }

  const page = clampInt(url.searchParams.get('page'), 1, 9999, 1)
  const limit = clampInt(url.searchParams.get('limit'), 1, 20, 5)
  const from = (page - 1) * limit
  const to = from + limit

  const selectCols = 'id, product_name, product_category, product_color, product_size, qty, unit_price_cents, total_cents, deposit_cents, balance_due_cents, status, note, created_at'

  const dataQuery = supabase
    .from('store_preorders')
    .select(selectCols)
    .eq('buyer_user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .range(from, to)

  const countQuery = supabase
    .from('store_preorders')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_user_id', auth.user.id)

  const [{ data, error: dataErr }, { count, error: countErr }] = await Promise.all([dataQuery, countQuery])

  if (dataErr) {
    return applyCookies(json(500, { ok: false, error: 'QUERY_FAILED', details: dataErr.message }))
  }

  if (countErr) {
    return applyCookies(json(500, { ok: false, error: 'COUNT_FAILED', details: countErr.message }))
  }

  const rows = Array.isArray(data) ? data : []
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return applyCookies(
    json(200, {
      ok: true,
      items,
      total: Number(count ?? 0),
      page,
      pageSize: limit,
      hasMore,
    })
  )
}
