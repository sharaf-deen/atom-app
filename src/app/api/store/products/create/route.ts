export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreCategoryKey } from '@/lib/storeCategories'

type JsonBody = {
  category: string
  name: string
  color?: string | null
  size?: string | null
  price_cents: number
  inventory_qty?: number
  is_active?: boolean
  currency?: string | null
}

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const STORE_BUCKET = 'store-product-images'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function toCleanString(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== 'string') return ''
  return value.trim()
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

async function parsePayload(req: Request): Promise<{ fields: JsonBody; imageFile: File | null }> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const fd = await req.formData()
    const imageValue = fd.get('image')
    const imageFile = imageValue instanceof File && imageValue.size > 0 ? imageValue : null

    return {
      fields: {
        category: normalizeStoreCategoryKey(toCleanString(fd.get('category')) || 'kimono'),
        name: toCleanString(fd.get('name')),
        color: toCleanString(fd.get('color')) || null,
        size: toCleanString(fd.get('size')) || null,
        price_cents: toNonNegativeInt(fd.get('price_cents')),
        inventory_qty: toNonNegativeInt(fd.get('inventory_qty')),
        is_active: toBoolean(fd.get('is_active'), true),
        currency: toCleanString(fd.get('currency')) || 'EGP',
      },
      imageFile,
    }
  }

  const b = (await req.json()) as JsonBody
  return {
    fields: b,
    imageFile: null,
  }
}

export async function POST(req: Request) {
  let uploadedPath: string | null = null

  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
    if (!me || me.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const { fields, imageFile } = await parsePayload(req)

    const payload = {
      category: normalizeStoreCategoryKey(fields.category || 'kimono'),
      name: (fields.name || '').trim(),
      color: (fields.color || '').trim() || null,
      size: (fields.size || '').trim() || null,
      price_cents: Math.max(0, Number(fields.price_cents || 0)),
      inventory_qty: Math.max(0, Number(fields.inventory_qty ?? 0)),
      is_active: fields.is_active ?? true,
      currency: fields.currency ?? 'EGP',
      created_by: auth.user.id,
      image_path: null as string | null,
    }

    if (!payload.name) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_INPUT', details: 'Name is required.' }, { status: 400 }))
    }

    const { data: categoryRow, error: categoryErr } = await admin
      .from('store_product_categories')
      .select('key,is_active')
      .eq('key', payload.category)
      .maybeSingle<{ key: string; is_active: boolean }>()

    if (categoryErr) {
      return noStore(NextResponse.json({ ok: false, error: 'CATEGORY_LOOKUP_FAILED', details: categoryErr.message }, { status: 500 }))
    }
    if (!categoryRow?.key || categoryRow.is_active !== true) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_CATEGORY', details: 'Select an active product category.' }, { status: 400 }))
    }

    if (imageFile) {
      const mime = (imageFile.type || '').toLowerCase()
      if (!ACCEPTED_IMAGE_TYPES.has(mime)) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_IMAGE_TYPE', details: 'Photo must be JPG, PNG or WEBP.' }, { status: 400 }))
      }
      if (imageFile.size > MAX_IMAGE_BYTES) {
        return noStore(NextResponse.json({ ok: false, error: 'IMAGE_TOO_LARGE', details: 'Photo is too large (max 5 MB).' }, { status: 400 }))
      }

      uploadedPath = buildUploadPath(auth.user.id, imageFile.name || 'product-image')
      const buffer = await imageFile.arrayBuffer()
      const up = await admin.storage.from(STORE_BUCKET).upload(uploadedPath, buffer, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      })

      if (up.error) {
        uploadedPath = null
        return noStore(NextResponse.json({ ok: false, error: 'UPLOAD_FAILED', details: up.error.message }, { status: 500 }))
      }

      payload.image_path = uploadedPath
    }

    const { data, error } = await admin.from('store_products').insert(payload).select('id').maybeSingle()
    if (error) {
      if (uploadedPath) {
        await admin.storage.from(STORE_BUCKET).remove([uploadedPath])
      }
      return noStore(NextResponse.json({ ok: false, error: error.message }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true, id: data?.id }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
