// src/app/api/store/products/delete/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

const STORE_BUCKET = 'store-product-images'

export async function DELETE(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth
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

    // 2) Role check
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

    // 3) Param
    const url = new URL(req.url)
    const id = (url.searchParams.get('id') || '').trim()
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    // 4) Delete
    const admin = createSupabaseAdminClient()

    const { data: product, error: loadErr } = await admin
      .from('store_products')
      .select('image_path,image_path_2,image_path_3')
      .eq('id', id)
      .maybeSingle<{ image_path: string | null; image_path_2: string | null; image_path_3: string | null }>()
    if (loadErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'LOAD_FAILED', details: loadErr.message }, { status: 500 })
      )
    }

    const imagePaths = [product?.image_path, product?.image_path_2, product?.image_path_3].map((item) => String(item ?? '').trim()).filter(Boolean)

    const { error } = await admin.from('store_products').delete().eq('id', id)
    if (error) {
      const raw = String(error.message || '')
      const details = /violates foreign key constraint|foreign key/i.test(raw)
        ? 'This product cannot be deleted because it is already linked to supplier orders, preorders, or sales history.'
        : raw
      return noStore(
        NextResponse.json({ ok: false, error: 'DELETE_FAILED', details }, { status: 500 })
      )
    }

    if (imagePaths.length > 0) {
      await admin.storage.from(STORE_BUCKET).remove(imagePaths)
    }

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
