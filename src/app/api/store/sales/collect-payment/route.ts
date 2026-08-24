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
  payment_cents?: number | null
  payment_method?: PaymentMethod | null
}

const ALLOWED_PAYMENT = new Set<PaymentMethod>(['cash', 'card', 'bank_transfer', 'instapay'])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function deriveStatus(totalCents: number, paidCents: number, currentStatus: SaleStatus) {
  if (currentStatus === 'delivered') return 'delivered' as SaleStatus
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

    const requestedPaymentCents = Math.max(0, Math.floor(Number(body.payment_cents || 0) || 0))
    if (requestedPaymentCents <= 0) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_PAYMENT_AMOUNT' }, { status: 400 }))
    }

    const paymentMethod = ALLOWED_PAYMENT.has(body.payment_method as PaymentMethod)
      ? (body.payment_method as PaymentMethod)
      : 'cash'

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .select('id,status,payment_method,total_cents,paid_cents')
      .eq('id', saleId)
      .maybeSingle<{
        id: string
        status: SaleStatus
        payment_method: PaymentMethod | null
        total_cents: number | null
        paid_cents: number | null
      }>()

    if (saleErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_LOOKUP_FAILED', details: saleErr.message }, { status: 500 }))
    }
    if (!sale) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_NOT_FOUND' }, { status: 404 }))
    }
    if (sale.status === 'canceled') {
      return noStore(NextResponse.json({ ok: false, error: 'CANCELED_SALE_PAYMENT_BLOCKED' }, { status: 400 }))
    }

    const totalCents = Math.max(0, Math.floor(Number(sale.total_cents || 0)))
    const currentPaidCents = Math.max(0, Math.min(Math.floor(Number(sale.paid_cents || 0)), totalCents))
    const currentDebtCents = Math.max(0, totalCents - currentPaidCents)

    if (currentDebtCents <= 0) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_ALREADY_CLEARED' }, { status: 400 }))
    }

    const appliedPaymentCents = Math.min(requestedPaymentCents, currentDebtCents)
    const nextPaidCents = Math.max(0, Math.min(currentPaidCents + appliedPaymentCents, totalCents))
    const nextDebtCents = Math.max(0, totalCents - nextPaidCents)
    const nextStatus = deriveStatus(totalCents, nextPaidCents, sale.status)

    const { error: updateErr } = await admin
      .from('store_sales')
      .update({
        paid_cents: nextPaidCents,
        payment_method: paymentMethod,
        status: nextStatus,
      })
      .eq('id', saleId)

    if (updateErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PAYMENT_UPDATE_FAILED', details: updateErr.message }, { status: 500 }))
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
        paid_cents: nextPaidCents,
        debt_cents: nextDebtCents,
        payment_cents: appliedPaymentCents,
        payment_method: paymentMethod,
      })
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
