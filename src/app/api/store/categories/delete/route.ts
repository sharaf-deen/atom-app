export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreCategoryKey } from '@/lib/storeCategories'

type DbErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

function isCategoryInUseDbError(error: DbErrorLike | null | undefined) {
  const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(' | ').toLowerCase()
  return error?.code === '23503' || details.includes('foreign key constraint') || details.includes('still referenced')
}

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

    const { data: deleted, error } = await admin
      .from('store_product_categories')
      .delete()
      .eq('key', key)
      .select('key')
      .maybeSingle<{ key: string }>()

    if (error) {
      if (isCategoryInUseDbError(error)) {
        const { count: fallbackCount } = await admin
          .from('store_products')
          .select('id', { count: 'exact', head: true })
          .eq('category', key)

        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'CATEGORY_IN_USE',
              details: `Delete blocked. ${(fallbackCount || count || 0)} product(s) still use this category.`,
            },
            { status: 409 }
          )
        )
      }

      const details = [error.message, error.details, error.hint].filter(Boolean).join(' | ')
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_FAILED', details }, { status: 500 }))
    }

    if (!deleted?.key) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND', details: 'Category not found.' }, { status: 404 }))
    }

    return noStore(NextResponse.json({ ok: true, deleted_key: deleted.key }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
