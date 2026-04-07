export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

const CUSTOMER_ROLES = new Set(['member', 'champion', 'vip', 'assistant_coach', 'coach', 'head_coach'])

export async function GET(req: NextRequest) {
  try {
    const authClient = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await authClient.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })
      )
    }

    const user = auth.user
    if (!user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const { data: me, error: meErr } = await authClient
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })
      )
    }

    const role = String(me?.role || 'member')
    const isSuperAdmin = role === 'super_admin'
    const canUseLegacyArchive = isSuperAdmin || CUSTOMER_ROLES.has(role)

    if (!canUseLegacyArchive) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const url = new URL(req.url)
    const page = clampInt(url.searchParams.get('page'), 1, 1, 9999)
    const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100)
    const from = (page - 1) * limit
    const to = from + limit - 1
    const status = (url.searchParams.get('status') || '').trim()
    const viewAll = url.searchParams.get('view') === 'all'
    const mine = url.searchParams.get('mine') === '1'

    if (viewAll && !isSuperAdmin) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const admin = createSupabaseAdminClient()

    const selectCols = `
      id,
      user_id,
      member_id,
      created_by,
      status,
      total_cents,
      discount_pct,
      preferred_payment,
      note,
      created_at,
      store_order_items (
        id,
        product_id,
        name,
        qty,
        unit_price_cents,
        final_price_cents,
        currency
      )
    `

    let dataQuery = admin
      .from('store_orders')
      .select(selectCols)
      .order('created_at', { ascending: false })
      .range(from, to)

    let countQuery = admin.from('store_orders').select('id', { count: 'exact', head: true })

    if (status) {
      dataQuery = dataQuery.eq('status', status)
      countQuery = countQuery.eq('status', status)
    }

    if (!viewAll || mine) {
      dataQuery = dataQuery.or(`user_id.eq.${user.id},member_id.eq.${user.id}`)
      countQuery = countQuery.or(`user_id.eq.${user.id},member_id.eq.${user.id}`)
    }

    const [{ data, error: dataErr }, { count, error: countErr }] = await Promise.all([dataQuery, countQuery])

    if (dataErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: dataErr.message }, { status: 500 })
      )
    }
    if (countErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'COUNT_FAILED', details: countErr.message }, { status: 500 })
      )
    }

    const rows = Array.isArray(data) ? (data as any[]) : []
    const profileIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row?.user_id, row?.member_id, row?.created_by])
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    )

    let profileMap = new Map<string, { email: string | null; name: string | null; first_name: string | null; last_name: string | null }>()

    if (profileIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('user_id,email,first_name,last_name')
        .in('user_id', profileIds)

      profileMap = new Map(
        (profiles ?? []).map((p: any) => {
          const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || null
          return [
            String(p.user_id),
            {
              email: p?.email ?? null,
              name,
              first_name: p?.first_name ?? null,
              last_name: p?.last_name ?? null,
            },
          ]
        })
      )
    }

    const items = rows.map((row) => {
      const memberKey = (row?.member_id as string | null) || (row?.user_id as string | null)
      const memberProfile = memberKey ? profileMap.get(memberKey) ?? null : null
      const creatorKey = (row?.created_by as string | null) || null
      const creatorProfile = creatorKey ? profileMap.get(creatorKey) ?? null : null

      const orderItems = Array.isArray(row?.store_order_items)
        ? row.store_order_items.map((it: any) => ({
            id: it?.id,
            product_id: it?.product_id,
            name: it?.name ?? null,
            qty: Number(it?.qty ?? 0),
            unit_price_cents: Number(it?.unit_price_cents ?? 0),
            final_price_cents: Number(it?.final_price_cents ?? 0),
            currency: it?.currency ?? null,
          }))
        : []

      return {
        id: row?.id,
        user_id: row?.user_id ?? null,
        member_id: row?.member_id ?? null,
        created_by: row?.created_by ?? null,
        status: row?.status,
        total_cents: Number(row?.total_cents ?? 0),
        discount_pct: row?.discount_pct == null ? null : Number(row.discount_pct),
        preferred_payment: row?.preferred_payment ?? null,
        note: row?.note ?? null,
        created_at: row?.created_at,
        items: orderItems,
        member: memberProfile,
        creator: creatorProfile,
        customer_email: memberProfile?.email ?? null,
        customer_name: memberProfile?.name ?? null,
      }
    })

    return noStore(
      NextResponse.json({
        ok: true,
        items,
        total: Number(count ?? 0),
        page,
        pageSize: limit,
      })
    )
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
