// src/app/api/store/products/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  buildStoreProductImagePath,
  inferStoreProductImageMime,
  STORE_PRODUCT_IMAGE_BUCKET,
  STORE_PRODUCT_IMAGE_MAX_BYTES,
} from '@/lib/storeProductImages'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type Body = {
  category: Category
  name: string
  color?: string
  size?: string
  price_cents: number
  inventory_qty?: number
  is_active?: boolean
  currency?: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function str(value: FormDataEntryValue | null | undefined) {
  return typeof value === 'string' ? value : ''
}

export async function POST(req: Request) {
  let uploadedPath: string | null = null
  let createdId: string | null = null

  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
    if (!me || me.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const contentType = req.headers.get('content-type') || ''
    let b: Body
    let imageFile: File | null = null

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      b = {
        category: str(form.get('category')) as Category,
        name: str(form.get('name')),
        color: str(form.get('color')),
        size: str(form.get('size')),
        price_cents: Number(str(form.get('price_cents')) || 0),
        inventory_qty: Number(str(form.get('inventory_qty')) || 0),
        is_active: str(form.get('is_active')) === 'true',
        currency: str(form.get('currency')) || 'EGP',
      }
      const maybeImage = form.get('image')
      imageFile = maybeImage && typeof (maybeImage as File)?.arrayBuffer === 'function' ? (maybeImage as File) : null
    } else {
      b = (await req.json()) as Body
    }

    const payload = {
      category: b.category,
      name: (b.name || '').trim(),
      color: (b.color || '').trim() || null,
      size: (b.size || '').trim() || null,
      price_cents: Math.max(0, Number(b.price_cents || 0)),
      inventory_qty: Math.max(0, Number(b.inventory_qty ?? 0)),
      is_active: b.is_active ?? true,
      currency: b.currency ?? 'EGP',
      created_by: auth.user.id,
    }
    if (!payload.name) return noStore(NextResponse.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 }))

    const { data, error } = await supa.from('store_products').insert(payload).select('id').maybeSingle()
    if (error) return noStore(NextResponse.json({ ok: false, error: error.message }, { status: 500 }))

    createdId = data?.id ?? null

    if (createdId && imageFile && imageFile.size > 0) {
      if (imageFile.size > STORE_PRODUCT_IMAGE_MAX_BYTES) {
        await supa.from('store_products').delete().eq('id', createdId)
        return noStore(
          NextResponse.json({ ok: false, error: 'IMAGE_TOO_LARGE', details: 'Image is too large (max 5MB).' }, { status: 400 })
        )
      }

      const mime = inferStoreProductImageMime(imageFile)
      if (!mime) {
        await supa.from('store_products').delete().eq('id', createdId)
        return noStore(
          NextResponse.json({ ok: false, error: 'INVALID_IMAGE_TYPE', details: 'Image must be JPG, PNG, or WEBP.' }, { status: 400 })
        )
      }

      uploadedPath = buildStoreProductImagePath(createdId, imageFile.name || 'product-image')
      const ab = await imageFile.arrayBuffer()
      const up = await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).upload(uploadedPath, ab, {
        contentType: mime,
        upsert: false,
      })

      if (up.error) {
        await supa.from('store_products').delete().eq('id', createdId)
        return noStore(
          NextResponse.json({ ok: false, error: 'IMAGE_UPLOAD_FAILED', details: up.error.message }, { status: 500 })
        )
      }

      const { error: patchErr } = await supa.from('store_products').update({ image_path: uploadedPath }).eq('id', createdId)
      if (patchErr) {
        await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).remove([uploadedPath])
        await supa.from('store_products').delete().eq('id', createdId)
        return noStore(
          NextResponse.json({ ok: false, error: 'IMAGE_SAVE_FAILED', details: patchErr.message }, { status: 500 })
        )
      }
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/store')
      revalidateTag('admin-store-products')
      revalidateTag('store-products')
    } catch {}

    return noStore(NextResponse.json({ ok: true, id: createdId, image_path: uploadedPath }))
  } catch (e: any) {
    if (uploadedPath) {
      try {
        const admin = createSupabaseAdminClient()
        await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).remove([uploadedPath])
      } catch {}
    }
    if (createdId) {
      try {
        const supa = createSupabaseServerActionClient()
        await supa.from('store_products').delete().eq('id', createdId)
      } catch {}
    }
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
