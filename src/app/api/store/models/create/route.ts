export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreModelSlug } from '@/lib/storeModels'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    if (me?.role !== 'super_admin') return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    const body = await req.json().catch(() => ({} as any))
    const categoryKey = String(body?.category_key || body?.categoryKey || '').trim()
    const name = String(body?.name || '').trim().slice(0, 120)
    const slug = normalizeStoreModelSlug(body?.slug || name)
    const description = String(body?.description || '').trim().slice(0, 1000) || null
    const coverImagePath = String(body?.cover_image_path || body?.coverImagePath || '').trim().slice(0, 500) || null
    const sortOrder = Number.isFinite(Number(body?.sort_order)) ? Math.trunc(Number(body.sort_order)) : 0
    const isActive = body?.is_active === undefined ? true : Boolean(body.is_active)
    const isFeatured = body?.is_featured === undefined ? false : Boolean(body.is_featured)

    if (!categoryKey) return noStore(NextResponse.json({ ok: false, error: 'INVALID_CATEGORY', details: 'Category is required.' }, { status: 400 }))
    if (!name) return noStore(NextResponse.json({ ok: false, error: 'INVALID_NAME', details: 'Model name is required.' }, { status: 400 }))
    if (!slug) return noStore(NextResponse.json({ ok: false, error: 'INVALID_SLUG', details: 'Slug is required.' }, { status: 400 }))

    const { data: category, error: categoryErr } = await admin
      .from('store_product_categories')
      .select('key,label')
      .eq('key', categoryKey)
      .maybeSingle<{ key: string; label: string }>()
    if (categoryErr) return noStore(NextResponse.json({ ok: false, error: 'CATEGORY_LOOKUP_FAILED', details: categoryErr.message }, { status: 500 }))
    if (!category) return noStore(NextResponse.json({ ok: false, error: 'CATEGORY_NOT_FOUND', details: 'Selected category does not exist.' }, { status: 400 }))

    const { data, error } = await admin
      .from('store_product_models')
      .insert({
        category_key: categoryKey,
        name,
        slug,
        description,
        cover_image_path: coverImagePath,
        sort_order: sortOrder,
        is_active: isActive,
        is_featured: isFeatured,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select('id,category_key,name,slug,description,cover_image_path,is_active,is_featured,sort_order,created_at,updated_at,created_by,updated_by')
      .maybeSingle()

    if (error) {
      const status = error.message.toLowerCase().includes('duplicate key') || error.message.toLowerCase().includes('unique') ? 409 : 500
      return noStore(NextResponse.json({ ok: false, error: 'CREATE_FAILED', details: error.message }, { status }))
    }

    return noStore(NextResponse.json({ ok: true, item: { ...data, linked_product_count: 0, category_label: category.label } }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
