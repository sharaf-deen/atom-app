// src/app/api/store/products/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
const CATEGORIES = new Set<Category>(['kimono', 'rashguard', 'short', 'belt'])

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

function normActive(v: string | null): 'all' | '1' | '0' {
  const s = (v || '').trim().toLowerCase()
  if (s === 'all') return 'all'
  if (s === '0' || s === 'false') return '0'
  if (s === '1' || s === 'true') return '1'
  return 'all'
}

function normPreorder(v: string | null): 'all' | '1' | '0' {
  const s = (v || '').trim().toLowerCase()
  if (s === 'all') return 'all'
  if (s === '0' || s === 'false') return '0'
  if (s === '1' || s === 'true') return '1'
  return 'all'
}

function safeSearch(q: string | null) {
  if (!q) return ''
  return q.trim().replace(/,/g, ' ').slice(0, 60)
}

function createSupabaseFromRoute(req: NextRequest, res: NextResponse) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        res.cookies.set({ name, value, ...options })
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set({ name, value: '', ...options, maxAge: 0 })
      },
    },
  })
}

export async function GET(req: NextRequest) {
  const res = NextResponse.next()

  try {
    const supa = createSupabaseFromRoute(req, res)

    const {
      data: { user },
      error: userErr,
    } = await supa.auth.getUser()

    if (userErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: userErr.message })
    if (!user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message })

    const role = (me?.role ?? 'member') as string
    const allowedRoles = new Set([
      'member',
      'reception',
      'coach',
      'assistant_coach',
      'head_coach',
      'admin',
      'super_admin',
      'vip',
      'champion',
    ])
    if (!allowedRoles.has(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const url = new URL(req.url)
    const page = clampInt(url.searchParams.get('page'), 1, 1, 9999)
    const limit = clampInt(url.searchParams.get('limit'), 10, 1, 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const category = (url.searchParams.get('category') || '').trim() as Category | ''
    const all = url.searchParams.get('all') === '1'
    const active = normActive(url.searchParams.get('active'))
    const preorder = normPreorder(url.searchParams.get('preorder'))
    const q = safeSearch(url.searchParams.get('q'))

    if (category && !CATEGORIES.has(category)) {
      return json(400, { ok: false, error: 'INVALID_CATEGORY' })
    }

    const selectCols =
      'id, category, name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, low_stock_threshold, created_at'

    let dataQuery = supa
      .from('store_products')
      .select(selectCols)
      .order('created_at', { ascending: false })
      .range(from, to)

    let countQuery = supa.from('store_products').select('id', { count: 'exact', head: true })

    const isSuperAdmin = role === 'super_admin'
    const shouldShowAll = isSuperAdmin && all

    if (!shouldShowAll) {
      dataQuery = dataQuery.eq('is_active', true)
      countQuery = countQuery.eq('is_active', true)
    } else if (active === '1') {
      dataQuery = dataQuery.eq('is_active', true)
      countQuery = countQuery.eq('is_active', true)
    } else if (active === '0') {
      dataQuery = dataQuery.eq('is_active', false)
      countQuery = countQuery.eq('is_active', false)
    }

    if (preorder === '1') {
      dataQuery = dataQuery.eq('allow_preorder', true)
      countQuery = countQuery.eq('allow_preorder', true)
    }
    if (preorder === '0') {
      dataQuery = dataQuery.eq('allow_preorder', false)
      countQuery = countQuery.eq('allow_preorder', false)
    }

    if (category) {
      dataQuery = dataQuery.eq('category', category)
      countQuery = countQuery.eq('category', category)
    }

    if (q) {
      const like = `%${q}%`
      dataQuery = dataQuery.or(`name.ilike.${like},color.ilike.${like},size.ilike.${like}`)
      countQuery = countQuery.or(`name.ilike.${like},color.ilike.${like},size.ilike.${like}`)
    }

    const [{ data, error: dataErr }, { count, error: countErr }] = await Promise.all([dataQuery, countQuery])

    if (dataErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: dataErr.message })
    if (countErr) return json(500, { ok: false, error: 'COUNT_FAILED', details: countErr.message })

    return noStore(
      NextResponse.json({
        ok: true,
        items: Array.isArray(data) ? data : [],
        total: Number(count ?? 0),
        page,
        pageSize: limit,
      })
    )
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
