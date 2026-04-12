export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreCategoryKey } from '@/lib/storeCategories'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function DELETE(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    if (me?.role !== 'super_admin') return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    const key = normalizeStoreCategoryKey(req.nextUrl.searchParams.get('key') || '')
    if (!key) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_KEY', details: 'Category key is required.' }, { status: 400 }))
    }

    const { count, error: countErr } = await admin
      .from('store_products')
      .select('id', { count: 'exact', head: true })
      .eq('category', key)

    if (countErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_USAGE_LOOKUP_FAILED', details: countErr.message }, { status: 500 }))
    }

    if ((count || 0) > 0) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'CATEGORY_IN_USE', details: `Delete blocked. ${count} product(s) still use this category.` },
          { status: 409 }
        )
      )
    }

    const { error } = await admin.from('store_product_categories').delete().eq('key', key)
    if (error) {
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: error.message }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
