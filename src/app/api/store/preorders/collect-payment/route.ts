export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'

type Body = {
  preorder_id?: string
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

    const preorderId = cleanText(body.preorder_id)
    if (!preorderId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_PREORDER_ID' }, { status: 400 }))
    }

    const requestedPaymentCents = Math.max(0, Math.floor(Number(body.payment_cents || 0) || 0))
    if (requestedPaymentCents <= 0) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_PAYMENT_AMOUNT' }, { status: 400 }))
    }

    const paymentMethod = ALLOWED_PAYMENT.has(body.payment_method as PaymentMethod)
      ? (body.payment_method as PaymentMethod)
      : 'cash'

    const { data: preorder, error: preorderErr } = await admin
      .from('store_preorders')
      .select('id,status,total_cents,deposit_cents,deposit_payment_method,converted_sale_id')
      .eq('id', preorderId)
      .maybeSingle<{
        id: string
        status: PreorderStatus
        total_cents: number | null
        deposit_cents: number | null
        deposit_payment_method: PaymentMethod | null
        converted_sale_id: string | null
      }>()

    if (preorderErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_LOOKUP_FAILED', details: preorderErr.message }, { status: 500 }))
    }
    if (!preorder) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_NOT_FOUND' }, { status: 404 }))
    }
    if (preorder.status === 'canceled') {
      return noStore(NextResponse.json({ ok: false, error: 'CANCELED_PREORDER_PAYMENT_BLOCKED' }, { status: 400 }))
    }
    if (preorder.status === 'completed' || preorder.converted_sale_id) {
      return noStore(NextResponse.json({ ok: false, error: 'COMPLETED_PREORDER_PAYMENT_BLOCKED' }, { status: 400 }))
    }

    const totalCents = Math.max(0, Math.floor(Number(preorder.total_cents || 0)))
    const currentDepositCents = Math.max(0, Math.min(Math.floor(Number(preorder.deposit_cents || 0)), totalCents))
    const currentBalanceCents = Math.max(0, totalCents - currentDepositCents)

    if (currentBalanceCents <= 0) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_ALREADY_CLEARED' }, { status: 400 }))
    }

    const appliedPaymentCents = Math.min(requestedPaymentCents, currentBalanceCents)
    const nextDepositCents = Math.max(0, Math.min(currentDepositCents + appliedPaymentCents, totalCents))
    const nextBalanceCents = Math.max(0, totalCents - nextDepositCents)

    const { data: updated, error: updateErr } = await admin
      .from('store_preorders')
      .update({
        deposit_cents: nextDepositCents,
        deposit_payment_method: paymentMethod,
        updated_by: guard.user.id,
      })
      .eq('id', preorderId)
      .select('id,status,total_cents,deposit_cents,balance_due_cents,deposit_payment_method,updated_at')
      .maybeSingle<{
        id: string
        status: PreorderStatus
        total_cents: number
        deposit_cents: number
        balance_due_cents: number
        deposit_payment_method: PaymentMethod | null
        updated_at: string
      }>()

    if (updateErr || !updated?.id) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PAYMENT_UPDATE_FAILED', details: updateErr?.message || 'update failed' },
          { status: 500 }
        )
      )
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/admin/store/preorders')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        id: preorderId,
        status: updated.status,
        total_cents: totalCents,
        deposit_cents: updated.deposit_cents ?? nextDepositCents,
        balance_due_cents: updated.balance_due_cents ?? nextBalanceCents,
        payment_cents: appliedPaymentCents,
        deposit_payment_method: updated.deposit_payment_method ?? paymentMethod,
      })
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
