export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type SaleStatus = 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'

type Body = {
  sale_id?: string
  purchase_date?: string | null
  buyer_full_name?: string | null
  buyer_email?: string | null
  buyer_phone?: string | null
  status?: SaleStatus | null
  payment_method?: PaymentMethod | null
  discount_cents?: number | null
  paid_cents?: number | null
  note?: string | null
  qty?: number | null
  unit_price_cents?: number | null
}

const ALLOWED_PAYMENT = new Set<PaymentMethod>(['cash', 'card', 'bank_transfer', 'instapay'])
const ALLOWED_STATUS = new Set<SaleStatus>(['draft', 'partial_paid', 'paid', 'delivered', 'canceled'])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function nullableText(value: unknown) {
  const s = cleanText(value)
  return s ? s : null
}

function normalizeDateInput(value: unknown) {
  const s = cleanText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function deriveStatus(totalCents: number, paidCents: number) {
  if (totalCents <= 0) return 'paid' as SaleStatus
  if (paidCents <= 0) return 'draft' as SaleStatus
  if (paidCents >= totalCents) return 'paid' as SaleStatus
  return 'partial_paid' as SaleStatus
}

async function requireSuperAdmin() {
  const authClient = createSupabaseServerActionClient()
  const admin = createSupabaseAdminClient()

  const { data: auth, error: authErr } = await authClient.auth.getUser()
  if (authErr) {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })) }
  }
  const user = auth.user
  if (!user) {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })) }
  }

  const { data: me, error: meErr } = await authClient
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (meErr) {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })) }
  }
  if (me?.role !== 'super_admin') {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })) }
  }

  return { ok: true as const, admin, user }
}

export async function POST(req: Request) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const admin = guard.admin
    const body = (await req.json().catch(() => ({}))) as Body
    const saleId = cleanText(body.sale_id)
    if (!saleId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_SALE_ID' }, { status: 400 }))
    }

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .select('id,status,payment_method,currency,total_cents,discount_cents,paid_cents,buyer_full_name,buyer_email,buyer_phone,note,purchase_date,delivered_at')
      .eq('id', saleId)
      .maybeSingle<{
        id: string
        status: SaleStatus
        payment_method: PaymentMethod | null
        currency: string | null
        total_cents: number | null
        discount_cents: number | null
        paid_cents: number | null
        buyer_full_name: string | null
        buyer_email: string | null
        buyer_phone: string | null
        note: string | null
        purchase_date: string | null
        delivered_at: string | null
      }>()

    if (saleErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_LOOKUP_FAILED', details: saleErr.message }, { status: 500 }))
    }
    if (!sale) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_NOT_FOUND' }, { status: 404 }))
    }

    const { data: itemsData, error: itemsErr } = await admin
      .from('store_sale_items')
      .select('sale_id,product_id,product_name,qty,unit_price_cents,line_total_cents,currency,delivered_stock_applied')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: true })

    if (itemsErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_ITEMS_LOOKUP_FAILED', details: itemsErr.message }, { status: 500 }))
    }

    const items = Array.isArray(itemsData) ? itemsData : []
    const firstItem = items[0] as any | undefined
    const hasAppliedStock = items.some((item: any) => !!item?.delivered_stock_applied)
    const requestedQty = Math.max(1, Math.floor(Number(body.qty || firstItem?.qty || 1) || 1))
    const requestedUnitPriceCents = Math.max(0, Math.floor(Number(body.unit_price_cents ?? firstItem?.unit_price_cents ?? 0) || 0))
    const currentQty = Math.max(1, Math.floor(Number(firstItem?.qty || 1) || 1))
    const currentUnitPriceCents = Math.max(0, Math.floor(Number(firstItem?.unit_price_cents || 0) || 0))
    const itemChanged = !!firstItem && (requestedQty !== currentQty || requestedUnitPriceCents !== currentUnitPriceCents)

    if (hasAppliedStock && itemChanged) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'STOCK_ALREADY_APPLIED', details: 'Quantity and unit price cannot be edited after stock has been applied.' },
          { status: 400 }
        )
      )
    }

    if (firstItem && itemChanged) {
      const { error: itemUpdateErr } = await admin
        .from('store_sale_items')
        .update({ qty: requestedQty, unit_price_cents: requestedUnitPriceCents })
        .eq('sale_id', saleId)
        .eq('product_id', firstItem.product_id)

      if (itemUpdateErr) {
        return noStore(NextResponse.json({ ok: false, error: 'SALE_ITEM_UPDATE_FAILED', details: itemUpdateErr.message }, { status: 500 }))
      }
    }

    const subtotalCents = firstItem
      ? requestedQty * requestedUnitPriceCents
      : Math.max(0, Number(sale.total_cents || 0) + Number(sale.discount_cents || 0))
    const discountRaw = Math.max(0, Math.floor(Number(body.discount_cents ?? sale.discount_cents ?? 0) || 0))
    const discountCents = Math.max(0, Math.min(discountRaw, subtotalCents))
    const totalCents = Math.max(subtotalCents - discountCents, 0)
    const paidRaw = Math.max(0, Math.floor(Number(body.paid_cents ?? sale.paid_cents ?? 0) || 0))
    const paidCents = Math.max(0, Math.min(paidRaw, totalCents))
    const requestedStatus = ALLOWED_STATUS.has(body.status as SaleStatus) ? (body.status as SaleStatus) : sale.status
    const nextStatus = requestedStatus === 'delivered' || requestedStatus === 'canceled' ? requestedStatus : deriveStatus(totalCents, paidCents)

    if (hasAppliedStock && nextStatus !== 'delivered') {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'STOCK_ALREADY_APPLIED', details: 'A delivered sale with stock already applied cannot be moved back from delivered.' },
          { status: 400 }
        )
      )
    }

    const paymentMethod = ALLOWED_PAYMENT.has(body.payment_method as PaymentMethod)
      ? (body.payment_method as PaymentMethod)
      : sale.payment_method || 'cash'
    const purchaseDate = normalizeDateInput(body.purchase_date) || sale.purchase_date || new Date().toISOString().slice(0, 10)
    const buyerFullName = nullableText(body.buyer_full_name) || 'Unknown buyer'
    const buyerEmail = nullableText(body.buyer_email)
    const buyerPhone = nullableText(body.buyer_phone)
    const note = nullableText(body.note)

    const updatePayload: Record<string, unknown> = {
      purchase_date: purchaseDate,
      buyer_full_name: buyerFullName,
      buyer_email: buyerEmail,
      buyer_phone: buyerPhone,
      status: nextStatus,
      payment_method: paymentMethod,
      total_cents: totalCents,
      discount_cents: discountCents,
      paid_cents: paidCents,
      note,
    }

    if (nextStatus === 'delivered' && !sale.delivered_at) {
      updatePayload.delivered_at = new Date().toISOString()
    }

    const { error: updateErr } = await admin.from('store_sales').update(updatePayload).eq('id', saleId)
    if (updateErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_UPDATE_FAILED', details: updateErr.message }, { status: 500 }))
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/admin/store/sales')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        id: saleId,
        status: nextStatus,
        total_cents: totalCents,
        discount_cents: discountCents,
        paid_cents: paidCents,
      })
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
