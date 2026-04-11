export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { canAccessStore, canAccessStoreCatalogAdmin, normalizeRole } from '@/lib/rbac'
import {
  FALLBACK_STORE_PRODUCT_CATEGORIES,
  type StoreProductCategoryRow,
  sortStoreProductCategories,
} from '@/lib/storeCategories'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })
      )
    }
    if (!auth.user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })
      )
    }

    const role = normalizeRole(me?.role)
    if (!canAccessStore(role) && !canAccessStoreCatalogAdmin(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1' && role === 'super_admin'

    let query = supa
      .from('store_product_categories')
      .select('key,label,is_active,sort_order')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })

    if (!includeInactive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) {
      return noStore(
        NextResponse.json({ ok: true, items: FALLBACK_STORE_PRODUCT_CATEGORIES, fallback: true })
      )
    }

    const items = sortStoreProductCategories(
      ((data ?? []) as StoreProductCategoryRow[]).filter((item) => item.key && item.label)
    )

    return noStore(
      NextResponse.json({ ok: true, items: items.length > 0 ? items : FALLBACK_STORE_PRODUCT_CATEGORIES })
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
