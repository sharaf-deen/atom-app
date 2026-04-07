export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Body = {
  product_id?: string
  qty?: number
  note?: string | null
}

const ALLOWED_PREORDER_ROLES = new Set([
  'member',
  'coach',
  'assistant_coach',
  'head_coach',
  'vip',
  'champion',
])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
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

    const { data: profile, error: profileErr } = await supa
      .from('profiles')
      .select('role, email, first_name, last_name, phone')
      .eq('user_id', user.id)
      .maybeSingle<{
        role: string | null
        email: string | null
        first_name: string | null
        last_name: string | null
        phone: string | null
      }>()

    if (profileErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profileErr.message }, { status: 500 }))
    }

    const role = (profile?.role ?? 'member').toString()
    if (!ALLOWED_PREORDER_ROLES.has(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const productId = String(body?.product_id || '').trim()
    const qty = Math.max(1, Math.min(100, Math.trunc(Number(body?.qty || 1))))
    const note = String(body?.note || '').trim().slice(0, 400) || null

    if (!productId) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_ID_REQUIRED' }, { status: 400 }))
    }

    const { data: product, error: productErr } = await supa
      .from('store_products')
      .select('id, category, name, color, size, price_cents, currency, is_active, allow_preorder')
      .eq('id', productId)
      .maybeSingle<{
        id: string
        category: 'kimono' | 'rashguard' | 'short' | 'belt'
        name: string | null
        color: string | null
        size: string | null
        price_cents: number | null
        currency: string | null
        is_active: boolean | null
        allow_preorder: boolean | null
      }>()

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

    const buyerFullName = [profile?.first_name ?? '', profile?.last_name ?? ''].join(' ').trim() || null
    const unitPriceCents = Math.max(0, Number(product.price_cents ?? 0))
    const totalCents = unitPriceCents * qty

    const insertPayload = {
      buyer_user_id: user.id,
      buyer_full_name: buyerFullName,
      buyer_email: profile?.email ?? user.email ?? null,
      buyer_phone: profile?.phone ?? null,
      product_id: product.id,
      product_name: product.name?.trim() || 'Product',
      product_category: product.category ?? null,
      product_color: product.color ?? null,
      product_size: product.size ?? null,
      qty,
      unit_price_cents: unitPriceCents,
      total_cents: totalCents,
      deposit_cents: 0,
      deposit_payment_method: null,
      status: 'pending' as const,
      note,
    }

    const { data: preorder, error: preorderErr } = await supa
      .from('store_preorders')
      .insert(insertPayload)
      .select('id, status, total_cents, balance_due_cents')
      .maybeSingle<{
        id: string
        status: string
        total_cents: number
        balance_due_cents: number
      }>()

    if (preorderErr || !preorder?.id) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PREORDER_CREATE_FAILED', details: preorderErr?.message || 'insert failed' },
          { status: 500 }
        )
      )
    }

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        id: preorder.id,
        status: preorder.status,
        total_cents: preorder.total_cents,
        balance_due_cents: preorder.balance_due_cents,
      })
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
