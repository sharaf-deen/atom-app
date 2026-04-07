export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type SaleStatus = 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'

type Body = {
  id?: string
  paid_cents?: number | null
  payment_method?: PaymentMethod | null
  status?: SaleStatus | null
  note?: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function PATCH(req: Request) {
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
    const saleId = String(body.id || '').trim()
    if (!saleId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))
    }

    const { data, error } = await admin.rpc('admin_apply_store_sale_update', {
      _sale_id: saleId,
      _status: body.status ?? null,
      _paid_cents: body.paid_cents ?? null,
      _payment_method: body.payment_method ?? null,
      _note: body.note ?? null,
    })

    if (error) {
      return noStore(NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 }))
    }

    revalidateTag('store-products')
    try {
      revalidatePath('/admin/store')
      revalidatePath('/admin/store/sales')
      revalidatePath('/admin/store/dashboard')
      revalidatePath('/store')
    } catch {}

    return noStore(NextResponse.json({ ok: true, item: Array.isArray(data) ? data[0] ?? null : data ?? null }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 })
    )
  }
}
