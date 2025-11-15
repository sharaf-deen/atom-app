// src/app/api/store/orders/status/route.ts
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
}

export async function PATCH(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth & rôle
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    }
    if ((me?.role ?? '') !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 2) Payload
    const b = (await req.json()) as Body
    const order_id = (b?.order_id || '').trim()
    let statusIn = (b?.status || '').toString().trim().toLowerCase()

    // tolère petite faute de frappe "delivere"
    if (statusIn === 'delivere') statusIn = 'delivered'

    if (!order_id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ORDER_ID' }, { status: 400 }))
    if (!isOrderStatus(statusIn)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_STATUS' }, { status: 400 }))
    }
    const nextStatus = statusIn as OrderStatus

    // 3) Récupère commande (et ancien statut)
    const { data: order, error: getErr } = await supa
      .from('store_orders')
      .select('id, user_id, status')
      .eq('id', order_id)
      .maybeSingle<{ id: string; user_id: string; status: OrderStatus }>()
    if (getErr) {
      return noStore(NextResponse.json({ ok: false, error: 'ORDER_LOOKUP_FAILED', details: getErr.message }, { status: 500 }))
    }
    if (!order) {
      return noStore(NextResponse.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 }))
    }

    const oldStatus = order.status
    if (oldStatus === nextStatus) {
      return noStore(NextResponse.json({ ok: true, id: order_id, status: nextStatus, unchanged: true }))
    }

    // 4) Met à jour la commande d'abord
    const { error: updErr } = await supa
      .from('store_orders')
      .update({ status: nextStatus })
      .eq('id', order_id)
    if (updErr) {
      return noStore(NextResponse.json({ ok: false, error: 'ORDER_UPDATE_FAILED', details: updErr.message }, { status: 500 }))
    }

    // 5) Propagation aux items (déclenchera les triggers de stock)
    // - Passage vers READY: items => 'ready' (décrément stock via trigger)
    // - Sortie de READY: items 'ready' => 'pending' (restitution stock via trigger)
    if (nextStatus === 'ready' && oldStatus !== 'ready') {
      const { error: itemsErr } = await supa
        .from('store_orders_items')
        .update({ status: 'ready' })
        .eq('order_id', order_id)
        .neq('status', 'ready')

      if (itemsErr) {
        // rollback statut commande si items KO (ex: INSUFFICIENT_STOCK depuis trigger)
        await supa.from('store_orders').update({ status: oldStatus }).eq('id', order_id)
        return noStore(
          NextResponse.json(
            { ok: false, error: 'ITEMS_UPDATE_FAILED', details: itemsErr.message, rolled_back: true },
            { status: 400 }
          )
        )
      }
    } else if (oldStatus === 'ready' && nextStatus !== 'ready') {
      const { error: itemsErr } = await supa
        .from('store_orders_items')
        .update({ status: 'pending' }) // ajuste si tu veux 'confirmed' ou autre
        .eq('order_id', order_id)
        .eq('status', 'ready')

      if (itemsErr) {
        // rollback statut commande si items KO
        await supa.from('store_orders').update({ status: oldStatus }).eq('id', order_id)
        return noStore(
          NextResponse.json(
            { ok: false, error: 'ITEMS_UPDATE_FAILED', details: itemsErr.message, rolled_back: true },
            { status: 400 }
          )
        )
      }
    }

    // 6) Notification (inchangée : confirmed / delivered / canceled)
    if (['confirmed', 'delivered', 'canceled'].includes(nextStatus)) {
      const title =
        nextStatus === 'confirmed' ? 'Order confirmed'
        : nextStatus === 'delivered' ? 'Order delivered'
        : 'Order canceled'
      const body =
        nextStatus === 'confirmed'
          ? `Your order #${order_id} has been confirmed.`
          : nextStatus === 'delivered'
          ? `Your order #${order_id} is delivered / ready for pickup.`
          : `Your order #${order_id} has been canceled.`

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const service = process.env.SUPABASE_SERVICE_ROLE_KEY
      const adminClient = url && service
        ? createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
        : supa // fallback (peut échouer en RLS)

      const { error: notifErr } = await adminClient.from('notifications').insert({
        user_id: order.user_id,
        member_id: order.user_id, // <- ajuste si ta colonne attend un vrai member_id
        title,
        body,
        kind: 'order_update',
        created_by: user.id,
      } as any)

      if (notifErr) {
        return noStore(
          NextResponse.json({
            ok: true,
            id: order_id,
            status: nextStatus,
            hint: 'STATUS_UPDATED_BUT_NOTIFICATION_FAILED',
            details: notifErr.message,
          })
        )
      }
    }

    return noStore(NextResponse.json({ ok: true, id: order_id, status: nextStatus }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
