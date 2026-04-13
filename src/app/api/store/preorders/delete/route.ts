export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function DELETE(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
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
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    }
    if (me?.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const id = (new URL(req.url).searchParams.get('id') || '').trim()
    if (!id) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))
    }

    const admin = createSupabaseAdminClient()

    const { data: existing, error: loadErr } = await admin
      .from('store_preorders')
      .select('id')
      .eq('id', id)
      .maybeSingle<{ id: string }>()
    if (loadErr) {
      return noStore(NextResponse.json({ ok: false, error: 'LOAD_FAILED', details: loadErr.message }, { status: 500 }))
    }
    if (!existing?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    const { error: deleteErr } = await admin.from('store_preorders').delete().eq('id', id)
    if (deleteErr) {
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: deleteErr.message }, { status: 500 }))
    }

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/admin/store/preorders') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
