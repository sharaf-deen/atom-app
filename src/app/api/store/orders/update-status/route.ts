// src/app/api/store/orders/update-status/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'
import { isOrderStatus, type OrderStatus } from '@/lib/order'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

type Body = {
  order_id: string
  status: OrderStatus | string
  note?: string
}

const NOTIFY_ON: OrderStatus[] = ['confirmed', 'delivered', 'canceled']

function normalizeStatusLocal(input: string | null | undefined): OrderStatus | null {
  const v = String(input || '').trim().toLowerCase()
  const alias: Record<string, OrderStatus> = {
    delivere: 'delivered',
    deliverd: 'delivered',
    confirme: 'confirmed',
    confirmer: 'confirmed',
    pendingg: 'pending',
    cancel: 'canceled',
    cancelled: 'canceled',
  }
  const candidate = alias[v] ?? (v as OrderStatus)
  return isOrderStatus(candidate) ? candidate : null
}

export async function PATCH(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth + role
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
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    }
    if (me?.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 2) Payload
    const b = (await req.json()) as Body
    const order_id = (b?.order_id || '').trim()
    const status = normalizeStatusLocal(b?.status)
    const note = (b?.note || '').trim() || null

    if (!order_id) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_ORDER_ID' }, { status: 400 }))
    }
    if (!status) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_STATUS' }, { status: 400 }))
    }

    // 3) Load order
    const { data: ord, error: getErr } = await supa
      .from('store_orders')
      .select('id, member_id, user_id, status')
      .eq('id', order_id)
      .maybeSingle<{ id: string; member_id: string | null; user_id: string | null; status: OrderStatus }>()
    if (getErr || !ord) {
      return noStore(NextResponse.json({ ok: false, error: 'ORDER_NOT_FOUND', details: getErr?.message }, { status: 404 }))
    }

    const memberId = ord.member_id || ord.user_id
    if (!memberId) {
      return noStore(NextResponse.json({ ok: false, error: 'ORDER_MISSING_MEMBER' }, { status: 500 }))
    }

    // 4) Update
    const { error: updErr } = await supa
      .from('store_orders')
      .update({ status, note })
      .eq('id', order_id)
    if (updErr) {
      return noStore(NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: updErr.message }, { status: 500 }))
    }

    // 5) Notify (non-blocking)
    if (NOTIFY_ON.includes(status)) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const service = process.env.SUPABASE_SERVICE_ROLE_KEY
      const client =
        url && service
          ? createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
          : supa

      const title = `Order ${status}`
      const body =
        status === 'confirmed'
          ? 'Your order has been confirmed.'
          : status === 'delivered'
          ? 'Your order is delivered. Enjoy!'
          : 'Your order has been canceled.'

      const notifRow = {
        user_id: memberId,
        member_id: memberId,
        created_by: user.id,
        kind: 'order_update',
        title,
        body,
      }

      const { error: insErr } = await client.from('notifications').insert(notifRow)
      if (insErr) {
        return noStore(
          NextResponse.json({
            ok: true,
            order_id,
            status,
            message: 'Status updated (notification failed).',
            warn: 'NOTIFICATION_FAILED',
            details: insErr.message,
          })
        )
      }
    }

    return noStore(NextResponse.json({ ok: true, order_id, status, message: 'Status updated.' }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
