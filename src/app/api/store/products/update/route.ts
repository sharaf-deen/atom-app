// src/app/api/store/products/update/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreCategoryKey } from '@/lib/storeCategories'

type ParsedBody = {
  id: string
  patch: Record<string, any>
  imageFiles: [File | null, File | null, File | null]
}

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const STORE_BUCKET = 'store-product-images'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isNonEmptyStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function toCleanString(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toNullableString(value: FormDataEntryValue | string | null | undefined) {
  const clean = toCleanString(value)
  return clean || null
}

function toNonNegativeInt(value: FormDataEntryValue | string | number | null | undefined) {
  const raw = typeof value === 'number' ? value : Number(typeof value === 'string' ? value : 0)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.trunc(raw))
}

function toBoolean(value: FormDataEntryValue | string | boolean | null | undefined, fallback = true) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function sanitizeFilename(name: string) {
  return (name || 'image').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function buildUploadPath(userId: string, filename: string) {
  const today = new Date().toISOString().slice(0, 10)
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `products/${userId}/${today}/${uuid}-${sanitizeFilename(filename)}`
}

function readFileSlot(fd: FormData, key: string) {
  const value = fd.get(key)
  return value instanceof File && value.size > 0 ? value : null
}

async function parseBody(req: NextRequest): Promise<ParsedBody> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const fd = await req.formData()
    const id = toCleanString(fd.get('id'))
    const patch: Record<string, any> = {}

    if (fd.has('category')) patch.category = normalizeStoreCategoryKey(toCleanString(fd.get('category')))
    if (fd.has('model_id')) patch.model_id = toNullableString(fd.get('model_id'))
    if (fd.has('name')) patch.name = toCleanString(fd.get('name'))
    if (fd.has('color')) patch.color = toNullableString(fd.get('color'))
    if (fd.has('size')) patch.size = toNullableString(fd.get('size'))
    if (fd.has('currency')) patch.currency = toCleanString(fd.get('currency')).toUpperCase() || null
    if (fd.has('price_cents')) patch.price_cents = toNonNegativeInt(fd.get('price_cents'))
    if (fd.has('inventory_qty')) patch.inventory_qty = toNonNegativeInt(fd.get('inventory_qty'))
    if (fd.has('is_active')) patch.is_active = toBoolean(fd.get('is_active'), true)

    const image1 = readFileSlot(fd, 'image_1') ?? readFileSlot(fd, 'image')
    const image2 = readFileSlot(fd, 'image_2')
    const image3 = readFileSlot(fd, 'image_3')

    return {
      id,
      patch,
      imageFiles: [image1, image2, image3],
    }
  }

  const body = await req.json().catch(() => ({} as any))
  const id = isNonEmptyStr(body?.id) ? body.id.trim() : ''
  const patch: Record<string, any> = {}

  if (typeof body?.category === 'string') patch.category = normalizeStoreCategoryKey(body.category)
  if (body?.model_id !== undefined) patch.model_id = isNonEmptyStr(body.model_id) ? body.model_id.trim() : null
  if (typeof body?.name === 'string') patch.name = body.name.trim()
  if (typeof body?.color === 'string') patch.color = body.color.trim()
  if (typeof body?.size === 'string') patch.size = body.size.trim()
  if (typeof body?.currency === 'string') patch.currency = body.currency.trim().toUpperCase()

  if (body?.price_cents !== undefined) patch.price_cents = body.price_cents
  if (body?.inventory_qty !== undefined) patch.inventory_qty = body.inventory_qty
  if (body?.low_stock_threshold !== undefined) patch.low_stock_threshold = body.low_stock_threshold
  if (body?.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (body?.allow_preorder !== undefined) patch.allow_preorder = Boolean(body.allow_preorder)

  return {
    id,
    patch,
    imageFiles: [null, null, null],
  }
}

export async function PATCH(req: NextRequest) {
  const newUploadedPaths: string[] = []

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

    const { id, patch, imageFiles } = await parseBody(req)
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    if (patch?.price_cents !== undefined) {
      const n = Number(patch.price_cents)
      if (!Number.isFinite(n) || n < 0) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_PRICE' }, { status: 400 }))
      }
      patch.price_cents = Math.floor(n)
    }

    if (patch?.inventory_qty !== undefined) {
      const n = Number(patch.inventory_qty)
      if (!Number.isFinite(n) || n < 0) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_INVENTORY' }, { status: 400 }))
      }
      patch.inventory_qty = Math.floor(n)
    }

    if (patch?.low_stock_threshold !== undefined) {
      const n = Number(patch.low_stock_threshold)
      if (!Number.isFinite(n) || n < 0) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_LOW_STOCK_THRESHOLD' }, { status: 400 }))
      }
      patch.low_stock_threshold = Math.floor(n)
    }

    const hasImageUpdate = imageFiles.some(Boolean)
    if (Object.keys(patch).length === 0 && !hasImageUpdate) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 }))
    }

    const { data: currentProduct, error: currentErr } = await admin
      .from('store_products')
      .select('category,model_id,image_path,image_path_2,image_path_3')
      .eq('id', id)
      .maybeSingle<{
        category: string | null
        model_id: string | null
        image_path: string | null
        image_path_2: string | null
        image_path_3: string | null
      }>()

    if (currentErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_LOOKUP_FAILED', details: currentErr.message }, { status: 500 }))
    }
    if (!currentProduct) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_NOT_FOUND' }, { status: 404 }))
    }

    let targetCategory = typeof patch.category === 'string' ? patch.category : String(currentProduct.category || '').trim() || null
    const resolvedModelId = patch.model_id !== undefined
      ? (isNonEmptyStr(patch.model_id) ? patch.model_id.trim() : null)
      : String(currentProduct.model_id || '').trim() || null

    if (!resolvedModelId) {
      return noStore(NextResponse.json({ ok: false, error: 'MODEL_REQUIRED', details: 'Linked model is required.' }, { status: 400 }))
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
      targetCategory = patch.category
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

    const oldPathsToDelete: string[] = []

    for (const [index, imageFile] of imageFiles.entries()) {
      if (!imageFile) continue

      const mime = (imageFile.type || '').toLowerCase()
      if (!ACCEPTED_IMAGE_TYPES.has(mime)) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_IMAGE_TYPE', details: `Photo ${index + 1} must be JPG, PNG or WEBP.` }, { status: 400 }))
      }
      if (imageFile.size > MAX_IMAGE_BYTES) {
        return noStore(NextResponse.json({ ok: false, error: 'IMAGE_TOO_LARGE', details: `Photo ${index + 1} is too large (max 5 MB).` }, { status: 400 }))
      }
    }

    for (const [index, imageFile] of imageFiles.entries()) {
      if (!imageFile) continue

      const mime = (imageFile.type || '').toLowerCase()
      const uploadedPath = buildUploadPath(user.id, imageFile.name || `product-image-${index + 1}`)
      const buffer = await imageFile.arrayBuffer()
      const up = await admin.storage.from(STORE_BUCKET).upload(uploadedPath, buffer, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      })

      if (up.error) {
        if (newUploadedPaths.length > 0) {
          await admin.storage.from(STORE_BUCKET).remove(newUploadedPaths)
        }
        return noStore(NextResponse.json({ ok: false, error: 'UPLOAD_FAILED', details: up.error.message }, { status: 500 }))
      }

      newUploadedPaths.push(uploadedPath)

      const fieldName = index === 0 ? 'image_path' : index === 1 ? 'image_path_2' : 'image_path_3'
      const previousPath = String(currentProduct[fieldName as keyof typeof currentProduct] || '').trim()
      patch[fieldName] = uploadedPath
      if (previousPath) oldPathsToDelete.push(previousPath)
    }

    const { data, error } = await supa
      .from('store_products')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) {
      if (newUploadedPaths.length > 0) {
        await admin.storage.from(STORE_BUCKET).remove(newUploadedPaths)
      }
      return noStore(
        NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 })
      )
    }

    if (oldPathsToDelete.length > 0) {
      await admin.storage.from(STORE_BUCKET).remove(oldPathsToDelete)
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
