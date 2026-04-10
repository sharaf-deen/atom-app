export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

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

    const url = new URL(req.url)
    const saleId = (url.searchParams.get('id') || '').trim()
    if (!saleId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))
    }

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .select('id,status')
      .eq('id', saleId)
      .maybeSingle<{ id: string; status: string }>()
    if (saleErr) {
      return noStore(NextResponse.json({ ok: false, error: 'LOOKUP_FAILED', details: saleErr.message }, { status: 500 }))
    }
    if (!sale) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    if (sale.status !== 'draft' && sale.status !== 'canceled') {
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_BLOCKED', details: 'Only draft or canceled sales can be deleted.' }, { status: 400 }))
    }

    const { data: items, error: itemsErr } = await admin
      .from('store_sale_items')
      .select('id,delivered_stock_applied')
      .eq('sale_id', saleId)
    if (itemsErr) {
      return noStore(NextResponse.json({ ok: false, error: 'ITEMS_LOOKUP_FAILED', details: itemsErr.message }, { status: 500 }))
    }

    if ((items || []).some((item: any) => !!item?.delivered_stock_applied)) {
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_BLOCKED', details: 'This sale cannot be deleted because stock was already applied.' }, { status: 400 }))
    }

    const { error: deleteErr } = await admin.from('store_sales').delete().eq('id', saleId)
    if (deleteErr) {
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: deleteErr.message }, { status: 500 }))
    }

    revalidateTag('store-products')
    try { revalidatePath('/admin/store/sales') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/store') } catch {}

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
