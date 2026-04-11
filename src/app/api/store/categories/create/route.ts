export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeStoreCategoryKey } from '@/lib/storeCategories'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    if (me?.role !== 'super_admin') return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    const body = await req.json().catch(() => ({} as any))
    const key = normalizeStoreCategoryKey(body?.key)
    const label = String(body?.label || '').trim().slice(0, 80)
    const sortOrder = Number.isFinite(Number(body?.sort_order)) ? Math.trunc(Number(body.sort_order)) : 0
    const isActive = body?.is_active === undefined ? true : Boolean(body.is_active)

    if (!key) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_KEY', details: 'Key is required. Use letters, numbers, spaces or dashes.' }, { status: 400 }))
    }
    if (!label) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_LABEL', details: 'Label is required.' }, { status: 400 }))
    }

    const { data, error } = await admin
      .from('store_product_categories')
      .insert({
        key,
        label,
        sort_order: sortOrder,
        is_active: isActive,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select('key,label,is_active,sort_order')
      .maybeSingle()

    if (error) {
      return noStore(NextResponse.json({ ok: false, error: 'CREATE_FAILED', details: error.message }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true, item: data }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
