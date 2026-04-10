// src/app/api/store/products/delete/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { STORE_PRODUCT_IMAGE_BUCKET } from '@/lib/storeProductImages'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function DELETE(req: NextRequest) {
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

    const url = new URL(req.url)
    const id = (url.searchParams.get('id') || '').trim()
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    const { data: current, error: loadErr } = await supa
      .from('store_products')
      .select('id, image_path')
      .eq('id', id)
      .maybeSingle<{ id: string; image_path: string | null }>()
    if (loadErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'LOAD_FAILED', details: loadErr.message }, { status: 500 })
      )
    }

    const imagePath = current?.image_path ?? null

    const { error } = await supa.from('store_products').delete().eq('id', id)
    if (error) {
      return noStore(
        NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: error.message }, { status: 500 })
      )
    }

    if (imagePath) {
      try {
        await admin.storage.from(STORE_PRODUCT_IMAGE_BUCKET).remove([imagePath])
      } catch {
        // best effort only
      }
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/store')
      revalidateTag('admin-store-products')
      revalidateTag('store-products')
    } catch {}

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
