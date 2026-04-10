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

    if ((me?.role || '') !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const url = new URL(req.url)
    const id = (url.searchParams.get('id') || '').trim()
    if (!id) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))
    }

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .select('id, status')
      .eq('id', id)
      .maybeSingle<{ id: string; status: string }>()

    if (saleErr) {
      return noStore(NextResponse.json({ ok: false, error: 'LOOKUP_FAILED', details: saleErr.message }, { status: 500 }))
    }
    if (!sale?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_NOT_FOUND' }, { status: 404 }))
    }

    if (sale.status !== 'draft' && sale.status !== 'canceled') {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'DELETE_NOT_ALLOWED', details: 'Only draft or canceled sales can be deleted.' },
          { status: 400 }
        )
      )
    }

    const { data: deliveredLines, error: linesErr } = await admin
      .from('store_sale_items')
      .select('sale_id')
      .eq('sale_id', id)
      .eq('delivered_stock_applied', true)
      .limit(1)

    if (linesErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'LINE_LOOKUP_FAILED', details: linesErr.message }, { status: 500 })
      )
    }
    if (Array.isArray(deliveredLines) && deliveredLines.length > 0) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'DELETE_NOT_ALLOWED', details: 'This sale already applied stock and cannot be deleted.' },
          { status: 400 }
        )
      )
    }

    const { error: deleteItemsErr } = await admin.from('store_sale_items').delete().eq('sale_id', id)
    if (deleteItemsErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'DELETE_ITEMS_FAILED', details: deleteItemsErr.message }, { status: 500 })
      )
    }

    const { error: deleteSaleErr } = await admin.from('store_sales').delete().eq('id', id)
    if (deleteSaleErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'DELETE_SALE_FAILED', details: deleteSaleErr.message }, { status: 500 })
      )
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
