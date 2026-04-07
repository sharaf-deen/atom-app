export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authError } = await supa.auth.getUser()
    if (authError) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authError.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meError } = await supa.from('profiles').select('role').eq('user_id', user.id).maybeSingle<{ role: string | null }>()
    if (meError) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meError.message }, { status: 500 }))
    }
    if (me?.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const body = await req.json().catch(() => ({} as any))
    const itemId = typeof body?.item_id === 'string' ? body.item_id.trim() : ''
    const receivedQty = Math.floor(Number(body?.received_qty || 0))

    if (!itemId) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ITEM_ID' }, { status: 400 }))
    if (!Number.isFinite(receivedQty) || receivedQty < 0) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_RECEIVED_QTY' }, { status: 400 }))
    }

    const { data, error } = await supa.rpc('store_apply_supplier_received_qty', {
      _item_id: itemId,
      _received_qty: receivedQty,
    })

    if (error) {
      return noStore(NextResponse.json({ ok: false, error: 'RECEIVE_APPLY_FAILED', details: error.message }, { status: 500 }))
    }

    const row = Array.isArray(data) ? data[0] : data

    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/store') } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        item: {
          id: row?.item_id ?? itemId,
          supplier_order_id: row?.supplier_order_id ?? null,
          received_qty: row?.new_received_qty ?? receivedQty,
          delta_received_qty: row?.delta_received_qty ?? 0,
          inventory_qty: row?.inventory_qty ?? null,
          line_status: row?.item_status ?? null,
          order_status: row?.order_status ?? null,
        },
      })
    )
  } catch (error: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) }, { status: 500 }))
  }
}
