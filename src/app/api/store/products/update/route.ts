// src/app/api/store/products/update/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  buildStoreProductImagePath,
  inferStoreProductImageMime,
  STORE_PRODUCT_IMAGE_BUCKET,
  STORE_PRODUCT_IMAGE_MAX_BYTES,
} from '@/lib/storeProductImages'

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
function str(value: FormDataEntryValue | null | undefined) {
  return typeof value === 'string' ? value : ''
}
function boolFromString(value: string) {
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

export async function PATCH(req: NextRequest) {
  let uploadedPath: string | null = null
  let previousImagePath: string | null = null

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

    const contentType = req.headers.get('content-type') || ''
    let id = ''
    const patch: Record<string, any> = {}
    let imageFile: File | null = null
    let removeImage = false

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      id = isNonEmptyStr(form.get('id')) ? String(form.get('id')).trim() : ''
      const category = str(form.get('category'))
      const name = str(form.get('name'))
      const color = str(form.get('color'))
      const size = str(form.get('size'))
      const currency = str(form.get('currency'))
      const price = str(form.get('price_cents'))
      const inventory = str(form.get('inventory_qty'))
      const isActive = str(form.get('is_active'))
      removeImage = boolFromString(str(form.get('remove_image')))

      if (isCategory(category)) patch.category = category
      if (typeof name === 'string') patch.name = name.trim()
      if (typeof color === 'string') patch.color = color.trim() || null
      if (typeof size === 'string') patch.size = size.trim() || null
      if (typeof currency === 'string' && currency.trim()) patch.currency = currency.trim().toUpperCase()

      if (price !== '') {
        const n = Number(price)
        if (!Number.isFinite(n) || n < 0) {
          return noStore(NextResponse.json({ ok: false, error: 'INVALID_PRICE' }, { status: 400 }))
        }
        patch.price_cents = Math.floor(n)
      }

      if (inventory !== '') {
        const n = Number(inventory)
        if (!Number.isFinite(n) || n < 0) {
          return noStore(NextResponse.json({ ok: false, error: 'INVALID_INVENTORY' }, { status: 400 }))
        }
        patch.inventory_qty = Math.floor(n)
      }

      if (isActive !== '') patch.is_active = boolFromString(isActive)

      const maybeImage = form.get('image')
      imageFile = maybeImage && typeof (maybeImage as File)?.arrayBuffer === 'function' ? (maybeImage as File) : null
    } else {
      const body = await req.json().catch(() => ({} as any))
      id = isNonEmptyStr(body?.id) ? body.id.trim() : ''

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

      if (body?.is_active !== undefined) patch.is_active = Boolean(body.is_active)
      removeImage = Boolean(body?.remove_image)
    }

    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    const { data: current, error: currentErr } = await supa
      .from('store_products')
      .select('id, image_path')
      .eq('id', id)
      .maybeSingle<{ id: string; image_path: string | null }>()

    if (currentErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'LOAD_FAILED', details: currentErr.message }, { status: 500 })
      )
    }
    if (!current?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    previousImagePath = current.image_path ?? null

    if (imageFile && imageFile.size > 0) {
      if (imageFile.size > STORE_PRODUCT_IMAGE_MAX_BYTES) {
        return noStore(
          NextResponse.json({ ok: false, error: 'IMAGE_TOO_LARGE', details: 'Image is too large (max 5MB).' }, { status: 400 })
        )
      }

      const mime = inferStoreProductImageMime(imageFile)
      if (!mime) {
        return noStore(
          NextResponse.json({ ok: false, error: 'INVALID_IMAGE_TYPE', details: 'Image must be JPG, PNG, or WEBP.' }, { status: 400 })
        )
      }

      uploadedPath = buildStoreProductImagePath(id, imageFile.name || 'product-image')
      const ab = await imageFile.arrayBuffer()
      const up = await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).upload(uploadedPath, ab, {
        contentType: mime,
        upsert: false,
      })
      if (up.error) {
        return noStore(
          NextResponse.json({ ok: false, error: 'IMAGE_UPLOAD_FAILED', details: up.error.message }, { status: 500 })
        )
      }
      patch.image_path = uploadedPath
    } else if (removeImage) {
      patch.image_path = null
    }

    if (Object.keys(patch).length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 }))
    }

    const { data, error } = await supa
      .from('store_products')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) {
      if (uploadedPath) {
        try {
          await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).remove([uploadedPath])
        } catch {}
      }
      return noStore(
        NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 })
      )
    }

    const shouldRemovePrevious = Boolean(previousImagePath && previousImagePath !== patch.image_path && (uploadedPath || removeImage))
    if (shouldRemovePrevious) {
      try {
        await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).remove([previousImagePath as string])
      } catch {}
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/store')
      revalidateTag('admin-store-products')
      revalidateTag('store-products')
    } catch {}

    return noStore(NextResponse.json({ ok: true, item: data }))
  } catch (e: any) {
    if (uploadedPath) {
      try {
        const admin = createSupabaseAdminClient()
        await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).remove([uploadedPath])
      } catch {}
    }
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
