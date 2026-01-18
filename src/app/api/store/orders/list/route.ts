// src/app/api/store/products/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export async function GET(req: NextRequest) {
  try {
    const supa = createSupabaseRSC()

    // 1) Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'AUTH_ERROR', details: authErr.message },
          { status: 401 }
        )
      )
    }
    const user = auth.user
    if (!user) {
      return noStore(
        NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })
      )
    }

    // 2) Role
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PROFILE_ERROR', details: meErr.message },
          { status: 500 }
        )
      )
    }

    const role = (me?.role ?? 'member') as string
    const allowedRoles = new Set([
      'member',
      'reception',
      'coach',
      'assistant_coach',
      'admin',
      'super_admin',
    ])
    if (!allowedRoles.has(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const isSuperAdmin = role === 'super_admin'

    // 3) Params
    const url = new URL(req.url)
    const page = clampInt(url.searchParams.get('page'), 1, 1, 9999)
    const limit = clampInt(url.searchParams.get('limit'), 10, 1, 100)
    const from = (page - 1) * limit
    const to = from + limit - 1

    const category = (url.searchParams.get('category') || '').trim() as Category | ''
    const all = url.searchParams.get('all') === '1'
    const active = (url.searchParams.get('active') || '').trim() // '1' | '0' | ''
    const qRaw = (url.searchParams.get('q') || '').trim()

    // 4) Base queries
    const selectCols =
      'id, category, name, color, size, price_cents, currency, inventory_qty, is_active, created_at'

    let dataQuery = supa
      .from('store_products')
      .select(selectCols)
      .order('created_at', { ascending: false })
      .range(from, to)

    let countQuery = supa.from('store_products').select('id', { count: 'exact', head: true })

    // 5) Visibility rules
    const shouldShowAll = isSuperAdmin && all
    if (!shouldShowAll) {
      dataQuery = dataQuery.eq('is_active', true)
      countQuery = countQuery.eq('is_active', true)
    } else {
      if (active === '1') {
        dataQuery = dataQuery.eq('is_active', true)
        countQuery = countQuery.eq('is_active', true)
      }
      if (active === '0') {
        dataQuery = dataQuery.eq('is_active', false)
        countQuery = countQuery.eq('is_active', false)
      }
    }

    // 6) Filters
    if (category) {
      dataQuery = dataQuery.eq('category', category)
      countQuery = countQuery.eq('category', category)
    }

    if (qRaw) {
      const like = `%${qRaw}%`
      dataQuery = dataQuery.or(`name.ilike.${like},color.ilike.${like},size.ilike.${like}`)
      countQuery = countQuery.or(`name.ilike.${like},color.ilike.${like},size.ilike.${like}`)
    }

    // 7) Execute
    const [{ data, error: dataErr }, { count, error: countErr }] = await Promise.all([
      dataQuery,
      countQuery,
    ])

    if (dataErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'QUERY_FAILED', details: dataErr.message },
          { status: 500 }
        )
      )
    }
    if (countErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'COUNT_FAILED', details: countErr.message },
          { status: 500 }
        )
      )
    }

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
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) },
        { status: 500 }
      )
    )
  }
}
