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

type SaleRow = {
  status: 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'
}

type SaleItemRow = {
  delivered_stock_applied: boolean | null
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

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .select('status')
      .eq('id', id)
      .maybeSingle<SaleRow>()
    if (saleErr) {
      return noStore(NextResponse.json({ ok: false, error: 'LOAD_FAILED', details: saleErr.message }, { status: 500 }))
    }
    if (!sale) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }
    if (sale.status !== 'draft' && sale.status !== 'canceled') {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'DELETE_NOT_ALLOWED', details: 'Only draft or canceled sales can be deleted.' },
          { status: 400 }
        )
      )
    }

    const { data: items, error: itemsErr } = await admin
      .from('store_sale_items')
      .select('delivered_stock_applied')
      .eq('sale_id', id)
    if (itemsErr) {
      return noStore(NextResponse.json({ ok: false, error: 'ITEMS_LOAD_FAILED', details: itemsErr.message }, { status: 500 }))
    }

    const stockApplied = (Array.isArray(items) ? (items as SaleItemRow[]) : []).some((item) => !!item.delivered_stock_applied)
    if (stockApplied) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'DELETE_NOT_ALLOWED', details: 'This sale cannot be deleted because stock was already applied.' },
          { status: 400 }
        )
      )
    }

    const { error: deleteErr } = await admin.from('store_sales').delete().eq('id', id)
    if (deleteErr) {
      return noStore(NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: deleteErr.message }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
