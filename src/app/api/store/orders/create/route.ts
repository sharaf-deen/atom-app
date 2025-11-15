// src/app/api/store/orders/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


type ItemIn = { product_id: string; qty: number }
type Body = {
  items: ItemIn[]
  preferred_payment?: 'cash' | 'card' | 'bank_transfer' | 'instapay'
  note?: string
}

const ALLOWED_PAYMENT = new Set(['cash', 'card', 'bank_transfer', 'instapay'])
const ALLOWED_CUSTOMERS = new Set(['member', 'assistant_coach', 'coach'])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })
      )
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    // 2) Rôle (seuls member / assistant_coach / coach peuvent commander)
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 })
      )
    }
    const role = (me?.role ?? 'member') as 'member' | 'assistant_coach' | 'coach' | string
    if (!ALLOWED_CUSTOMERS.has(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 3) Payload
    const b = (await req.json()) as Body
    const itemsIn = Array.isArray(b?.items) ? b.items : []
    if (itemsIn.length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_ITEMS' }, { status: 400 }))
    }

    // Quantités nettoyées + fusion doublons
    const qtyByProduct = new Map<string, number>()
    for (const it of itemsIn) {
      const pid = (it?.product_id || '').trim()
      const q = Math.max(1, Number(it?.qty || 0))
      if (!pid) continue
      qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + q)
    }
    if (qtyByProduct.size === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_VALID_ITEMS' }, { status: 400 }))
    }

    const preferred_payment =
      (b?.preferred_payment && ALLOWED_PAYMENT.has(b.preferred_payment) ? b.preferred_payment : 'cash') as
        | 'cash'
        | 'card'
        | 'bank_transfer'
        | 'instapay'
    const note = (b?.note || '').trim() || null

    // 4) Produits
    const productIds = Array.from(qtyByProduct.keys())
    const { data: products, error: prodErr } = await supa
      .from('store_products')
      .select('id, name, price_cents, currency, is_active')
      .in('id', productIds)
    if (prodErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PRODUCTS_QUERY_FAILED', details: prodErr.message }, { status: 500 })
      )
    }
    if (!products || products.length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCTS_NOT_FOUND' }, { status: 400 }))
    }

    // 5) Construire lignes (prix gelés)
    type Line = {
      product_id: string
      name: string
      unit_price_cents: number
      qty: number
      currency: string | null
      sub_cents: number            // unit * qty
      final_cents: number          // après remise, arrondi réparti
    }
    const lines: Line[] = []

    for (const p of products) {
      const qty = qtyByProduct.get(p.id) || 0
      if (qty <= 0) continue

      if (p.is_active !== true) {
        return noStore(
          NextResponse.json({ ok: false, error: 'PRODUCT_INACTIVE', details: p.id }, { status: 400 })
        )
      }

      const unit = Math.max(0, Number(p.price_cents || 0))
      const sub = unit * qty

      lines.push({
        product_id: p.id,
        name: p.name ?? 'Item',
        unit_price_cents: unit,
        qty,
        currency: p.currency ?? null,
        sub_cents: sub,
        final_cents: 0, // calculé après prorata
      })
    }

    if (lines.length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_SELLABLE_ITEMS' }, { status: 400 }))
    }

    // 6) Total + remise (proratisation par ligne)
    const subtotal = lines.reduce((s, l) => s + l.sub_cents, 0)
    const discount_pct = role === 'coach' ? 30 : role === 'assistant_coach' ? 20 : 0
    const targetTotal = Math.max(0, Math.round((subtotal * (100 - discount_pct)) / 100))

    if (discount_pct === 0) {
      // pas de remise
      for (const l of lines) l.final_cents = l.sub_cents
    } else {
      // prorata + correction arrondi sur la dernière ligne
      let acc = 0
      const factor = (100 - discount_pct) / 100
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (i < lines.length - 1) {
          l.final_cents = Math.round(l.sub_cents * factor)
          acc += l.final_cents
        } else {
          l.final_cents = Math.max(0, targetTotal - acc)
        }
      }
    }

    const total_cents = lines.reduce((s, l) => s + l.final_cents, 0)

    // 7) Insert commande (⚠️ user_id obligatoire si RLS/NOT NULL)
    const orderPayload: any = {
      user_id: user.id,     // ✅ requis
      member_id: user.id,   // sémantique client
      created_by: user.id,  // qui a créé
      status: 'pending',
      preferred_payment,
      note,
      total_cents,
      discount_pct,
    }

    const { data: orderRow, error: orderErr } = await supa
      .from('store_orders')
      .insert(orderPayload)
      .select('id')
      .maybeSingle<{ id: string }>()
    if (orderErr || !orderRow?.id) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'ORDER_CREATE_FAILED', details: orderErr?.message || 'insert store_orders failed' },
          { status: 500 }
        )
      )
    }
    const order_id = orderRow.id

    // 8) Insert items (⚠️ final_price_cents NOT NULL)
    const itemsPayload = lines.map((l) => ({
      order_id,
      product_id: l.product_id,
      qty: l.qty,
      unit_price_cents: l.unit_price_cents,
      final_price_cents: l.final_cents,   // ✅ on renseigne
      name: l.name,
      currency: l.currency,
    }))

    const { error: itemsErr } = await supa.from('store_order_items').insert(itemsPayload)
    if (itemsErr) {
      // rollback best-effort
      await supa.from('store_orders').delete().eq('id', order_id)
      return noStore(
        NextResponse.json(
          { ok: false, error: 'ORDER_ITEMS_INSERT_FAILED', details: itemsErr.message },
          { status: 500 }
        )
      )
    }

    // 9) Retour
    return noStore(
      NextResponse.json({
        ok: true,
        id: order_id,
        total_cents,
        discount_pct,
        status: 'pending',
      })
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
