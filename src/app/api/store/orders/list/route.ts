// src/app/api/store/orders/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

type OrderRow = {
  id: string
  created_by: string | null
  user_id: string | null
  owner_uid: string | null
  member_id: string | null
  status: string
  total_cents: number
  discount_pct: number | null
  preferred_payment: string | null
  note: string | null
  created_at: string
}

type ItemRow = {
  id: string
  order_id: string
  product_id: string
  qty: number
  unit_price_cents: number
  final_price_cents: number
  currency: string | null
  name: string | null
}

export async function GET(req: Request) {
  const t0 = Date.now()
  const url = new URL(req.url)
  const debug = url.searchParams.get('debug') === '1'

  try {
    const supa = createSupabaseRSC()

    // --- Auth
    const a0 = Date.now()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    const authMs = Date.now() - a0
    if (authErr) {
      return noStore(NextResponse.json(
        { ok: false, error: 'AUTH_ERROR', details: authErr.message, __debug: { authMs } },
        { status: 401 }
      ))
    }
    const user = auth.user
    if (!user) {
      return noStore(NextResponse.json(
        { ok: false, error: 'NOT_AUTHENTICATED', __debug: { authMs } },
        { status: 401 }
      ))
    }

    // --- Rôle
    const r0 = Date.now()
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    const roleMs = Date.now() - r0
    if (meErr) {
      return noStore(NextResponse.json(
        { ok: false, error: 'PROFILE_ERROR', details: meErr.message, __debug: { authMs, roleMs } },
        { status: 500 }
      ))
    }
    const isSuperAdmin = (me?.role ?? '') === 'super_admin'

    // --- Params
    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)))
    const view = (url.searchParams.get('view') || '').toLowerCase()
    const from = (page - 1) * limit
    const to = from + limit - 1

    // --- COUNT
    let countQuery = supa.from('store_orders').select('id', { count: 'exact' }).limit(0)
    if (!(isSuperAdmin && view === 'all')) {
      countQuery = countQuery.eq('owner_uid', user.id)
    }
    const { count, error: countErr } = await countQuery
    if (countErr) {
      return noStore(NextResponse.json(
        { ok: false, error: 'COUNT_FAILED', details: countErr.message },
        { status: 500 }
      ))
    }

    // --- ORDERS page
    const o0 = Date.now()
    let ordersQuery = supa
      .from('store_orders')
      .select('id,created_by,user_id,owner_uid,member_id,status,total_cents,discount_pct,preferred_payment,note,created_at')
      .order('created_at', { ascending: false })
      .range(from, to)

    if (!(isSuperAdmin && view === 'all')) {
      ordersQuery = ordersQuery.eq('owner_uid', user.id)
    }

    const { data: ordersRaw, error: ordersErr } = await ordersQuery
    const ordersMs = Date.now() - o0

    if (ordersErr) {
      return noStore(NextResponse.json(
        { ok: false, error: 'QUERY_ORDERS_FAILED', details: ordersErr.message },
        { status: 500 }
      ))
    }

    const rows: OrderRow[] = Array.isArray(ordersRaw) ? (ordersRaw as OrderRow[]) : []
    const orderIds = rows.map(r => r.id)

    // --- ITEMS pour ces commandes (clé de perf ici)
    let items: ItemRow[] = []
    let itemsMs = 0
    if (orderIds.length) {
      const i0 = Date.now()
      const { data: itemsData, error: itemsErr } = await supa
        .from('store_order_items')
        .select('id,order_id,product_id,qty,unit_price_cents,final_price_cents,currency,name')
        .eq('owner_uid', user.id)      // 🔑 pousse l’index (évite le full scan RLS)
        .in('order_id', orderIds)      // 🔑 réduit le set
      itemsMs = Date.now() - i0

      if (itemsErr) {
        return noStore(NextResponse.json(
          { ok: false, error: 'QUERY_ITEMS_FAILED', details: itemsErr.message, __debug: { ordersMs } },
          { status: 500 }
        ))
      }
      items = Array.isArray(itemsData) ? (itemsData as ItemRow[]) : []
    }

    // --- Enrichissement client (created_by ou user_id)
    const uids = new Set<string>()
    for (const o of rows) {
      if (o.created_by) uids.add(o.created_by)
      else if (o.user_id) uids.add(o.user_id)
    }

    const p0 = Date.now()
    let profileMap: Record<string, { email: string | null; first_name: string | null; last_name: string | null }> = {}
    if (uids.size) {
      const { data: profs } = await supa
        .from('profiles')
        .select('user_id,email,first_name,last_name')
        .in('user_id', Array.from(uids))
        .limit(uids.size)
      if (profs) {
        profileMap = Object.fromEntries(
          profs.map(p => [p.user_id, { email: p.email, first_name: p.first_name, last_name: p.last_name }])
        )
      }
    }
    const profilesMs = Date.now() - p0

    // --- assemble
    const itemsByOrder = new Map<string, ItemRow[]>()
    for (const it of items) {
      const arr = itemsByOrder.get(it.order_id) || []
      arr.push(it)
      itemsByOrder.set(it.order_id, arr)
    }

    const out = rows.map(o => {
      const k = o.created_by || o.user_id || ''
      const p = profileMap[k]
      const full = ((p?.first_name ?? '') + ' ' + (p?.last_name ?? '')).trim() || null
      return {
        ...o,
        items: itemsByOrder.get(o.id) ?? [],
        customer_email: p?.email ?? null,
        customer_name: full,
      }
    })

    const totalTimeMs = Date.now() - t0
    const payload: any = {
      ok: true,
      page,
      pageSize: limit,
      total: count ?? out.length,
      items: out,
    }
    if (debug) {
      payload.__debug = {
        totalTimeMs,
        authMs,
        roleMs,
        ordersMs,
        itemsMs,
        profilesMs,
        counts: { orders: rows.length, items: items.length, uids: uids.size },
      }
    }

    return noStore(NextResponse.json(payload))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 })
    )
  }
}
