export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function DELETE(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    if (me?.role !== 'super_admin') return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    const url = new URL(req.url)
    const id = String(url.searchParams.get('id') || '').trim()
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'INVALID_ID', details: 'Model id is required.' }, { status: 400 }))

    const { count, error: countErr } = await admin
      .from('store_products')
      .select('id', { head: true, count: 'exact' })
      .eq('model_id', id)
    if (countErr) return noStore(NextResponse.json({ ok: false, error: 'COUNT_FAILED', details: countErr.message }, { status: 500 }))
    if ((count || 0) > 0) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'MODEL_IN_USE', details: `Delete blocked. ${count} product(s) are still linked to this model.` },
          { status: 409 }
        )
      )
    }

    const { data, error } = await admin
      .from('store_product_models')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) return noStore(NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: error.message }, { status: 500 }))
    if (!data) return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND', details: 'Model not found.' }, { status: 404 }))

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
