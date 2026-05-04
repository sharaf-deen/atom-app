export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'

type Body = {
  product_id?: string
  qty?: number
  buyer_user_id?: string | null
  buyer_full_name?: string
  buyer_email?: string | null
  buyer_phone?: string | null
  discount_cents?: number
  paid_cents?: number
  payment_method?: PaymentMethod | null
  note?: string | null
}

const ALLOWED_PAYMENT = new Set<PaymentMethod>(['cash', 'card', 'bank_transfer', 'instapay'])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function buildProductLabel(p: { name: string | null; color: string | null; size: string | null }) {
  return [p.name || 'Product', p.color || null, p.size || null].filter(Boolean).join(' · ')
}

function deriveStatus(totalCents: number, paidCents: number) {
  if (totalCents <= 0) return 'paid'
  if (paidCents <= 0) return 'draft'
  if (paidCents >= totalCents) return 'paid'
  return 'partial_paid'
}

function buildBuyerFullName(profile: { first_name: string | null; last_name: string | null; email: string | null; member_id: string | null }) {
  const name = [profile.first_name, profile.last_name].map((v) => String(v || '').trim()).filter(Boolean).join(' ')
  return name || profile.email || profile.member_id || 'Buyer'
}

export async function POST(req: Request) {
  try {
    const authClient = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    const { data: auth, error: authErr } = await authClient.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const { data: me, error: meErr } = await authClient
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

    const body = (await req.json().catch(() => ({}))) as Body
    const productId = String(body.product_id || '').trim()
    const qty = Math.max(1, Math.floor(Number(body.qty || 0) || 0))
    const buyerUserId = String(body.buyer_user_id || '').trim() || null
    let buyerMemberId: string | null = null
    let buyerFullName = String(body.buyer_full_name || '').trim()
    let buyerEmail = String(body.buyer_email || '').trim() || null
    let buyerPhone = String(body.buyer_phone || '').trim() || null
    const discountRaw = Math.max(0, Math.floor(Number(body.discount_cents || 0) || 0))
    const paidRaw = Math.max(0, Math.floor(Number(body.paid_cents || 0) || 0))
    const paymentMethod = ALLOWED_PAYMENT.has(body.payment_method as PaymentMethod)
      ? (body.payment_method as PaymentMethod)
      : 'cash'
    const note = String(body.note || '').trim() || null

    if (!productId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_PRODUCT_ID' }, { status: 400 }))
    }
    if (buyerUserId) {
      const { data: buyer, error: buyerErr } = await admin
        .from('profiles')
        .select('user_id,member_id,email,first_name,last_name,phone')
        .eq('user_id', buyerUserId)
        .maybeSingle<{
          user_id: string
          member_id: string | null
          email: string | null
          first_name: string | null
          last_name: string | null
          phone: string | null
        }>()

      if (buyerErr) {
        return noStore(NextResponse.json({ ok: false, error: 'BUYER_LOOKUP_FAILED', details: buyerErr.message }, { status: 500 }))
      }
      if (!buyer) {
        return noStore(NextResponse.json({ ok: false, error: 'BUYER_NOT_FOUND' }, { status: 404 }))
      }

      buyerMemberId = buyer.member_id || null
      buyerFullName = buildBuyerFullName(buyer)
      buyerEmail = buyer.email || null
      buyerPhone = buyer.phone || null
    }

    if (!buyerFullName) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_BUYER' }, { status: 400 }))
    }

    const { data: product, error: productErr } = await admin
      .from('store_products')
      .select('id,name,color,size,price_cents,currency,is_active,inventory_qty')
      .eq('id', productId)
      .maybeSingle<{
        id: string
        name: string | null
        color: string | null
        size: string | null
        price_cents: number
        currency: string | null
        is_active: boolean | null
        inventory_qty: number | null
      }>()

    if (productErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_LOOKUP_FAILED', details: productErr.message }, { status: 500 }))
    }
    if (!product) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_NOT_FOUND' }, { status: 404 }))
    }
    if (product.is_active !== true) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_INACTIVE' }, { status: 400 }))
    }

    const subtotalCents = Math.max(0, Number(product.price_cents || 0)) * qty
    const discountCents = Math.max(0, Math.min(discountRaw, subtotalCents))
    const totalCents = Math.max(subtotalCents - discountCents, 0)
    const paidCents = Math.max(0, Math.min(paidRaw, totalCents))
    const debtCents = Math.max(totalCents - paidCents, 0)
    const status = deriveStatus(totalCents, paidCents)
    const currency = product.currency || 'EGP'
    const productName = buildProductLabel(product)

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .insert({
        buyer_user_id: buyerUserId,
        buyer_member_id: buyerMemberId,
        buyer_full_name: buyerFullName,
        buyer_email: buyerEmail,
        buyer_phone: buyerPhone,
        status,
        payment_method: paymentMethod,
        currency,
        total_cents: totalCents,
        discount_cents: discountCents,
        paid_cents: paidCents,
        debt_cents: debtCents,
        note,
        created_by: user.id,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (saleErr || !sale?.id) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'SALE_CREATE_FAILED', details: saleErr?.message || 'Unable to create sale' },
          { status: 500 }
        )
      )
    }

    const { error: itemErr } = await admin.from('store_sale_items').insert({
      sale_id: sale.id,
      product_id: product.id,
      product_name: productName,
      qty,
      unit_price_cents: Number(product.price_cents || 0),
      line_total_cents: totalCents,
      currency,
      delivered_stock_applied: false,
    })

    if (itemErr) {
      await admin.from('store_sales').delete().eq('id', sale.id)
      return noStore(
        NextResponse.json({ ok: false, error: 'SALE_ITEM_CREATE_FAILED', details: itemErr.message }, { status: 500 })
      )
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/admin/store/sales')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        id: sale.id,
        status,
        total_cents: totalCents,
        discount_cents: discountCents,
        paid_cents: paidCents,
        debt_cents: debtCents,
      })
    )
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 })
    )
  }
}
