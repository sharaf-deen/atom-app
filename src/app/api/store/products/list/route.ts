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

function safeSearch(q: string | null) {
  if (!q) return ''
  // évite les virgules (la syntaxe .or(...) est sensible)
  return q.trim().replace(/,/g, ' ').slice(0, 60)
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

  // --- Auth (et refresh cookies si besoin)
  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr || !auth?.user) {
    return applyCookies(
      json(401, { ok: false, error: 'AUTH_ERROR', details: authErr?.message || 'Not authenticated' })
    )
  }

  // --- Role (pour autoriser l’affichage inactif)
  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()
  if (meErr) {
    return applyCookies(json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message }))
  }

  const role = (me?.role || 'member').toString()
  const isSuperAdmin = role === 'super_admin'

  // --- Params
  const page = clampInt(url.searchParams.get('page'), 1, 9999, 1)
  const limit = clampInt(url.searchParams.get('limit'), 1, 50, 8)
  const from = (page - 1) * limit
  const to = from + limit - 1

  const categoryRaw = (url.searchParams.get('category') || '').trim().toLowerCase()
  const category = (CATEGORIES.has(categoryRaw as Category) ? (categoryRaw as Category) : null)

  const q = safeSearch(url.searchParams.get('q'))
  const allFlag = url.searchParams.get('all') === '1'
  const activeParam = normActive(url.searchParams.get('active'))

  // Règle: seul super_admin + all=1 peut voir inactif / filtrer active=0/all
  const canSeeAll = isSuperAdmin && allFlag

  // --- Base queries
  let countQ = supabase.from('store_products').select('id', { count: 'exact', head: true })
  let dataQ = supabase
    .from('store_products')
    .select('id,category,name,color,size,price_cents,currency,inventory_qty,is_active,created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)

  // --- Filters
  if (category) {
    countQ = countQ.eq('category', category)
    dataQ = dataQ.eq('category', category)
  }

  if (!canSeeAll) {
    // tout le monde voit uniquement actif
    countQ = countQ.eq('is_active', true)
    dataQ = dataQ.eq('is_active', true)
  } else {
    // super_admin + all=1 => active peut être 1/0/all
    if (activeParam === '1') {
      countQ = countQ.eq('is_active', true)
      dataQ = dataQ.eq('is_active', true)
    } else if (activeParam === '0') {
      countQ = countQ.eq('is_active', false)
      dataQ = dataQ.eq('is_active', false)
    }
  }

  if (q) {
    // recherche simple sur name/color/size
    const like = `%${q}%`
    const orExpr = `name.ilike.${like},color.ilike.${like},size.ilike.${like}`
    countQ = countQ.or(orExpr)
    dataQ = dataQ.or(orExpr)
  }

  // --- Count
  const { count, error: countErr } = await countQ
  if (countErr) {
    return applyCookies(json(500, { ok: false, error: 'COUNT_FAILED', details: countErr.message }))
  }

  // --- Data
  const { data, error } = await dataQ
  if (error) {
    return applyCookies(json(500, { ok: false, error: 'QUERY_FAILED', details: error.message }))
  }

  return applyCookies(
    json(200, {
      ok: true,
      items: Array.isArray(data) ? data : [],
      total: count ?? 0,
      page,
      pageSize: limit,
    })
  )
}
