export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { sortStoreModels, type StoreProductModelRow } from '@/lib/storeModels'
import type { StoreProductCategoryRow } from '@/lib/storeCategories'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET() {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    if (me?.role !== 'super_admin') return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    const [{ data: models, error: modelsErr }, { data: categories, error: categoriesErr }, { data: linkedRows, error: linkedErr }] = await Promise.all([
      admin
        .from('store_product_models')
        .select('id,category_key,name,slug,description,cover_image_path,is_active,is_featured,sort_order,created_at,updated_at,created_by,updated_by')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      admin
        .from('store_product_categories')
        .select('key,label,is_active,sort_order'),
      admin
        .from('store_products')
        .select('model_id')
        .not('model_id', 'is', null)
        .limit(5000),
    ])

    if (modelsErr) return noStore(NextResponse.json({ ok: false, error: 'LIST_FAILED', details: modelsErr.message }, { status: 500 }))
    if (categoriesErr) return noStore(NextResponse.json({ ok: false, error: 'CATEGORIES_FAILED', details: categoriesErr.message }, { status: 500 }))
    if (linkedErr) return noStore(NextResponse.json({ ok: false, error: 'LINKED_COUNT_FAILED', details: linkedErr.message }, { status: 500 }))

    const categoryMap = new Map<string, StoreProductCategoryRow>()
    for (const row of (categories ?? []) as StoreProductCategoryRow[]) {
      categoryMap.set(row.key, row)
    }

    const linkedCounts = new Map<string, number>()
    for (const row of (linkedRows ?? []) as Array<{ model_id: string | null }>) {
      const id = String(row.model_id || '').trim()
      if (!id) continue
      linkedCounts.set(id, (linkedCounts.get(id) || 0) + 1)
    }

    const items = sortStoreModels(
      ((models ?? []) as StoreProductModelRow[]).map((item) => ({
        ...item,
        linked_product_count: linkedCounts.get(item.id) || 0,
        category_label: categoryMap.get(item.category_key)?.label ?? item.category_key,
      }))
    )

    return noStore(NextResponse.json({ ok: true, items }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
