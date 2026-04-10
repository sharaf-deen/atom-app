// src/app/api/store/products/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type Body = {
  category: Category
  name: string
  color?: string | null
  size?: string | null
  price_cents: number
  inventory_qty?: number
  is_active?: boolean
  currency?: string | null
}

const IMAGE_BUCKET = 'store-product-images'
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function normalizeFileName(name: string) {
  return (name || 'product-image').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function toBool(v: FormDataEntryValue | null | undefined, fallback: boolean) {
  if (typeof v !== 'string') return fallback
  const s = v.trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return fallback
}

function toNullableString(v: FormDataEntryValue | null | undefined) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s || null
}

async function uploadProductImage(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, file: File | null) {
  if (!file) return null

  const mime = file.type || 'application/octet-stream'
  if (!ALLOWED_IMAGE_TYPES.has(mime)) {
    throw new Error('Photo must be JPG, PNG or WEBP.')
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Photo is too large. Maximum size is 5MB.')
  }

  const ab = await file.arrayBuffer()
  const safeName = normalizeFileName(file.name || 'product-image')
  const path = `${userId}/${Date.now()}-${safeName}`

  const up = await admin.storage.from(IMAGE_BUCKET).upload(path, ab, {
    contentType: mime,
    upsert: false,
    cacheControl: '3600',
  })

  if (up.error) {
    throw new Error(up.error.message || 'Photo upload failed.')
  }

  return path
}

async function removeImageIfAny(admin: ReturnType<typeof createSupabaseAdminClient>, path?: string | null) {
  const safe = String(path || '').trim()
  if (!safe) return
  try {
    await admin.storage.from(IMAGE_BUCKET).remove([safe])
  } catch {
    // noop cleanup best effort
  }
}

async function parseBody(req: Request): Promise<{ payload: Body; photo: File | null }> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const photoValue = formData.get('photo')
    const photo = photoValue && typeof (photoValue as File)?.arrayBuffer === 'function' ? (photoValue as File) : null

    return {
      payload: {
        category: String(formData.get('category') || 'kimono') as Category,
        name: String(formData.get('name') || ''),
        color: toNullableString(formData.get('color')),
        size: toNullableString(formData.get('size')),
        price_cents: Number(formData.get('price_cents') || 0),
        inventory_qty: Number(formData.get('inventory_qty') || 0),
        is_active: toBool(formData.get('is_active'), true),
        currency: toNullableString(formData.get('currency')) ?? 'EGP',
      },
      photo,
    }
  }

  const b = (await req.json()) as Body
  return { payload: b, photo: null }
}

export async function POST(req: Request) {
  let imagePath: string | null = null

  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    // ✅ SEUL super_admin peut créer
    const { data: me } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
    if (!me || me.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const { payload: body, photo } = await parseBody(req)
    const payload = {
      category: body.category,
      name: (body.name || '').trim(),
      color: (body.color || '').trim() || null,
      size: (body.size || '').trim() || null,
      price_cents: Math.max(0, Number(body.price_cents || 0)),
      inventory_qty: Math.max(0, Number(body.inventory_qty ?? 0)),
      is_active: body.is_active ?? true,
      currency: body.currency ?? 'EGP',
      created_by: auth.user.id,
      image_path: null as string | null,
    }
    if (!payload.name) return noStore(NextResponse.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 }))

    imagePath = await uploadProductImage(admin, auth.user.id, photo)
    payload.image_path = imagePath

    const { data, error } = await admin.from('store_products').insert(payload).select('id').maybeSingle()
    if (error) {
      await removeImageIfAny(admin, imagePath)
      return noStore(NextResponse.json({ ok: false, error: error.message }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true, id: data?.id }))
  } catch (e: any) {
    try {
      const admin = createSupabaseAdminClient()
      await removeImageIfAny(admin, imagePath)
    } catch {
      // noop cleanup best effort
    }
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
