export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { isStorePaymentMethod, isStorePreorderStatus, type StorePaymentMethod, type StorePreorderStatus } from '@/lib/storeV2'

type Body = {
  product_id?: string
  buyer_user_id?: string
  qty?: number
  deposit_cents?: number | string | null
  deposit_payment_method?: string | null
  status?: string | null
  note?: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function buildProductLabel(product: { name: string | null; color: string | null; size: string | null }) {
  return [product.name || 'Product', product.color || null, product.size || null].filter(Boolean).join(' · ')
}

function buildBuyerFullName(profile: { first_name: string | null; last_name: string | null; email: string | null; member_id: string | null }) {
  const name = [profile.first_name, profile.last_name]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
  return name || profile.email || profile.member_id || 'Member'
}

function parseCents(value: unknown) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  return Math.max(0, Math.floor(n))
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
    const buyerUserId = String(body.buyer_user_id || '').trim()
    const qty = Math.max(1, Math.min(100, Math.floor(Number(body.qty || 1) || 1)))
    const depositRawCents = parseCents(body.deposit_cents)
    const statusRaw = String(body.status || 'confirmed').trim()
    const note = String(body.note || '').trim().slice(0, 500) || null
    const paymentMethodRaw = body.deposit_payment_method === null || body.deposit_payment_method === undefined
      ? null
      : String(body.deposit_payment_method || '').trim()

    if (!productId) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_ID_REQUIRED' }, { status: 400 }))
    }

    if (!buyerUserId) {
      return noStore(NextResponse.json({ ok: false, error: 'BUYER_REQUIRED' }, { status: 400 }))
    }

    if (!Number.isFinite(depositRawCents)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_DEPOSIT' }, { status: 400 }))
    }

    if (!isStorePreorderStatus(statusRaw)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_STATUS' }, { status: 400 }))
    }
    const preorderStatus = statusRaw as StorePreorderStatus

    const [{ data: buyer, error: buyerErr }, { data: product, error: productErr }] = await Promise.all([
      admin
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
        }>(),
      admin
        .from('store_products')
        .select('id,category,name,color,size,price_cents,currency,is_active,allow_preorder,inventory_qty')
        .eq('id', productId)
        .maybeSingle<{
          id: string
          category: string | null
          name: string | null
          color: string | null
          size: string | null
          price_cents: number | null
          currency: string | null
          is_active: boolean | null
          allow_preorder: boolean | null
          inventory_qty: number | null
        }>(),
    ])

    if (buyerErr) {
      return noStore(NextResponse.json({ ok: false, error: 'BUYER_LOOKUP_FAILED', details: buyerErr.message }, { status: 500 }))
    }
    if (!buyer?.user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'BUYER_NOT_FOUND' }, { status: 404 }))
    }

    if (productErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_LOOKUP_FAILED', details: productErr.message }, { status: 500 }))
    }
    if (!product?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_NOT_FOUND' }, { status: 404 }))
    }
    if (product.is_active !== true) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_INACTIVE' }, { status: 400 }))
    }
    if (product.allow_preorder !== true) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_NOT_ALLOWED' }, { status: 400 }))
    }

    const unitPriceCents = Math.max(0, Number(product.price_cents || 0))
    const totalCents = unitPriceCents * qty
    const depositCents = Math.max(0, Math.min(depositRawCents, totalCents))

    let depositPaymentMethod: StorePaymentMethod | null = null
    if (depositCents > 0) {
      if (!isStorePaymentMethod(paymentMethodRaw)) {
        return noStore(NextResponse.json({ ok: false, error: 'PAYMENT_METHOD_REQUIRED' }, { status: 400 }))
      }
      depositPaymentMethod = paymentMethodRaw
    }

    const { data: preorder, error: preorderErr } = await admin
      .from('store_preorders')
      .insert({
        buyer_user_id: buyer.user_id,
        buyer_full_name: buildBuyerFullName(buyer),
        buyer_email: buyer.email || null,
        buyer_phone: buyer.phone || null,
        product_id: product.id,
        product_name: buildProductLabel(product),
        product_category: product.category ?? null,
        product_color: product.color ?? null,
        product_size: product.size ?? null,
        qty,
        unit_price_cents: unitPriceCents,
        total_cents: totalCents,
        deposit_cents: depositCents,
        deposit_payment_method: depositPaymentMethod,
        status: preorderStatus,
        note,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('id,status,total_cents,deposit_cents,balance_due_cents')
      .maybeSingle<{
        id: string
        status: StorePreorderStatus
        total_cents: number
        deposit_cents: number
        balance_due_cents: number
      }>()

    if (preorderErr || !preorder?.id) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PREORDER_CREATE_FAILED', details: preorderErr?.message || 'Unable to create preorder' },
          { status: 500 }
        )
      )
    }

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/admin/store/preorders') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        id: preorder.id,
        status: preorder.status,
        total_cents: preorder.total_cents,
        deposit_cents: preorder.deposit_cents,
        balance_due_cents: preorder.balance_due_cents,
      })
    )
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 })
    )
  }
}
