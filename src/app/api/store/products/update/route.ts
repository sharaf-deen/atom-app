// src/app/api/store/products/update/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
const CATEGORIES: readonly Category[] = ['kimono', 'rashguard', 'short', 'belt'] as const

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isNonEmptyStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
}

export async function PATCH(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })
      )
    }
    const user = auth.user
    if (!user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    // 2) Role check (super_admin only)
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })
      )
    }
    if (me?.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 3) Body
    const body = await req.json().catch(() => ({} as any))
    const id = isNonEmptyStr(body?.id) ? body.id.trim() : ''
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    const patch: Record<string, any> = {}

    if (isCategory(body?.category)) patch.category = body.category
    if (typeof body?.name === 'string') patch.name = body.name.trim()
    if (typeof body?.color === 'string') patch.color = body.color.trim()
    if (typeof body?.size === 'string') patch.size = body.size.trim()
    if (typeof body?.currency === 'string') patch.currency = body.currency.trim().toUpperCase()

    if (body?.price_cents !== undefined) {
      const n = Number(body.price_cents)
      if (!Number.isFinite(n) || n < 0) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_PRICE' }, { status: 400 }))
      }
      patch.price_cents = Math.floor(n)
    }

    if (body?.inventory_qty !== undefined) {
      const n = Number(body.inventory_qty)
      if (!Number.isFinite(n) || n < 0) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_INVENTORY' }, { status: 400 }))
      }
      patch.inventory_qty = Math.floor(n)
    }

    if (body?.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active)
    }

    if (Object.keys(patch).length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 }))
    }

    // 4) Update
    const { data, error } = await supa
      .from('store_products')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) {
      return noStore(
        NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 })
      )
    }

    return noStore(NextResponse.json({ ok: true, item: data }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
