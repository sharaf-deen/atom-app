export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { isStorePaymentMethod, type StorePaymentMethod } from '@/lib/storeV2'

type Body = {
  payment_method?: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function errorMessage(error: any) {
  const raw = String(error?.message || error?.details || error || '')
  if (raw.includes('PREORDER_NOT_FOUND')) return 'Preorder not found.'
  if (raw.includes('PREORDER_ALREADY_CONVERTED')) return 'This preorder has already been converted to a sale.'
  if (raw.includes('PREORDER_NOT_CONVERTIBLE')) return 'This preorder cannot be converted with its current status.'
  if (raw.includes('PREORDER_PRODUCT_REQUIRED')) return 'This preorder is not linked to a product.'
  if (raw.includes('PRODUCT_NOT_FOUND')) return 'Linked product not found.'
  if (raw.includes('INSUFFICIENT_STOCK')) return 'Current stock is not enough to complete this preorder as a delivered sale.'
  if (raw.includes('SALE_INSERT_FAILED')) return 'Sale creation failed.'
  return raw || 'Unable to complete preorder as sale.'
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const preorderId = String(params?.id || '').trim()
    if (!preorderId) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_ID_REQUIRED' }, { status: 400 }))
    }

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
    const paymentMethodRaw = String(body.payment_method || '').trim()
    if (!isStorePaymentMethod(paymentMethodRaw)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_PAYMENT_METHOD' }, { status: 400 }))
    }
    const paymentMethod = paymentMethodRaw as StorePaymentMethod

    const { data, error } = await admin.rpc('admin_complete_store_preorder_as_sale', {
      _preorder_id: preorderId,
      _payment_method: paymentMethod,
      _actor_id: user.id,
    } as any)

    if (error) {
      const details = errorMessage(error)
      return noStore(NextResponse.json({ ok: false, error: 'CONVERT_PREORDER_FAILED', details }, { status: 400 }))
    }

    const payload = (data || {}) as { sale_id?: string | null; preorder_id?: string | null }

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/admin/store/preorders') } catch {}
    try { revalidatePath('/admin/store/sales') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        preorder_id: payload.preorder_id || preorderId,
        sale_id: payload.sale_id || null,
      })
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
