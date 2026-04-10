export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const STORE_BUCKET = 'store-product-images'

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

    const { data: product, error: lookupErr } = await admin
      .from('store_products')
      .select('id, image_path')
      .eq('id', id)
      .maybeSingle<{ id: string; image_path: string | null }>()

    if (lookupErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'LOOKUP_FAILED', details: lookupErr.message }, { status: 500 })
      )
    }
    if (!product?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    const { error } = await admin.from('store_products').delete().eq('id', id)
    if (error) {
      const details =
        error.code === '23503'
          ? 'This product is linked to store history and cannot be deleted.'
          : error.message
      return noStore(
        NextResponse.json({ ok: false, error: 'DELETE_FAILED', details }, { status: 500 })
      )
    }

    if (product.image_path) {
      await admin.storage.from(STORE_BUCKET).remove([product.image_path]).catch(() => undefined)
    }

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}
    try { revalidatePath('/admin/store/sales') } catch {}

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
