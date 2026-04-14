// src/app/api/store/products/update/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreCategoryKey } from '@/lib/storeCategories'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isNonEmptyStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export async function PATCH(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

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

    const body = await req.json().catch(() => ({} as any))
    const id = isNonEmptyStr(body?.id) ? body.id.trim() : ''
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    const patch: Record<string, any> = {}

    if (typeof body?.category === 'string') patch.category = normalizeStoreCategoryKey(body.category)
    if (body?.model_id !== undefined) patch.model_id = isNonEmptyStr(body.model_id) ? body.model_id.trim() : null
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

    if (body?.low_stock_threshold !== undefined) {
      const n = Number(body.low_stock_threshold)
      if (!Number.isFinite(n) || n < 0) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_LOW_STOCK_THRESHOLD' }, { status: 400 }))
      }
      patch.low_stock_threshold = Math.floor(n)
    }

    if (body?.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active)
    }

    if (body?.allow_preorder !== undefined) {
      patch.allow_preorder = Boolean(body.allow_preorder)
    }

    if (Object.keys(patch).length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 }))
    }

    let currentProductModelId: string | null = null
    let targetCategory = typeof patch.category === 'string' ? patch.category : null

    if (!targetCategory || patch.model_id !== undefined) {
      const { data: currentProduct, error: currentErr } = await admin
        .from('store_products')
        .select('category,model_id')
        .eq('id', id)
        .maybeSingle<{ category: string | null; model_id: string | null }>()

      if (currentErr) {
        return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_LOOKUP_FAILED', details: currentErr.message }, { status: 500 }))
      }
      targetCategory = targetCategory || String(currentProduct?.category || '').trim() || null
      currentProductModelId = String(currentProduct?.model_id || '').trim() || null
    }

    const resolvedModelId = patch.model_id !== undefined
      ? (isNonEmptyStr(patch.model_id) ? patch.model_id.trim() : null)
      : currentProductModelId

    if (!resolvedModelId) {
      return noStore(NextResponse.json({ ok: false, error: 'MODEL_REQUIRED', details: 'Linked model is required under Store V3 hard enforcement.' }, { status: 400 }))
    }

    patch.model_id = resolvedModelId

    if (typeof patch.category === 'string') {
      const { data: categoryRow, error: categoryErr } = await admin
        .from('store_product_categories')
        .select('key')
        .eq('key', patch.category)
        .maybeSingle<{ key: string }>()

      if (categoryErr) {
        return noStore(NextResponse.json({ ok: false, error: 'CATEGORY_LOOKUP_FAILED', details: categoryErr.message }, { status: 500 }))
      }
      if (!categoryRow?.key) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_CATEGORY', details: 'Selected category was not found.' }, { status: 400 }))
      }
    }

    if (patch.model_id) {
      const { data: modelRow, error: modelErr } = await admin
        .from('store_product_models')
        .select('id,category_key')
        .eq('id', patch.model_id)
        .maybeSingle<{ id: string; category_key: string }>()

      if (modelErr) {
        return noStore(NextResponse.json({ ok: false, error: 'MODEL_LOOKUP_FAILED', details: modelErr.message }, { status: 500 }))
      }
      if (!modelRow?.id) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_MODEL', details: 'Selected model was not found.' }, { status: 400 }))
      }
      if (!targetCategory) {
        return noStore(NextResponse.json({ ok: false, error: 'MODEL_CATEGORY_UNKNOWN', details: 'Could not resolve the product category for this model link.' }, { status: 400 }))
      }
      if (modelRow.category_key !== targetCategory) {
        return noStore(NextResponse.json({ ok: false, error: 'MODEL_CATEGORY_MISMATCH', details: 'Selected model must belong to the same category as the product variant.' }, { status: 400 }))
      }
    }

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

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}
    try { revalidatePath('/admin/store/sales') } catch {}
    try { revalidatePath('/admin/store/models') } catch {}

    return noStore(NextResponse.json({ ok: true, item: data }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
