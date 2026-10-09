export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'

type Body = {
  sale_id?: string
  actual_received_cents?: number
  payment_method?: PaymentMethod | null
  received_date?: string
  reference?: string | null
  note?: string | null
}

const RECONCILIATION_START_DATE = '2026-09-01'
const ALLOWED_METHODS = new Set<PaymentMethod>(['cash', 'card', 'bank_transfer', 'instapay'])

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function requireSuperAdmin() {
  const authClient = createSupabaseServerActionClient()
  const admin = createSupabaseAdminClient()

  const { data: auth, error: authErr } = await authClient.auth.getUser()
  if (authErr) return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })) }
  if (!auth.user) return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })) }

  const { data: me, error: meErr } = await authClient
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  if (meErr) return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })) }
  if (me?.role !== 'super_admin') return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })) }

  return { ok: true as const, admin, user: auth.user }
}

export async function POST(req: Request) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const body = (await req.json().catch(() => ({}))) as Body
    const saleId = cleanText(body.sale_id)
    const receivedDate = cleanText(body.received_date)
    const reference = cleanText(body.reference) || null
    const note = cleanText(body.note) || null

    if (!saleId) return noStore(NextResponse.json({ ok: false, error: 'MISSING_SALE_ID' }, { status: 400 }))
    if (!isDateOnly(receivedDate)) return noStore(NextResponse.json({ ok: false, error: 'INVALID_RECEIVED_DATE' }, { status: 400 }))

    const actualReceivedCents = Math.max(0, Math.floor(Number(body.actual_received_cents ?? 0)))
    const paymentMethod = body.payment_method && ALLOWED_METHODS.has(body.payment_method) ? body.payment_method : null

    const { data: sale, error: saleErr } = await guard.admin
      .from('store_sales')
      .select('id,status,purchase_date,created_at,paid_cents,payment_method')
      .eq('id', saleId)
      .maybeSingle<{
        id: string
        status: string | null
        purchase_date: string | null
        created_at: string | null
        paid_cents: number | null
        payment_method: PaymentMethod | null
      }>()

    if (saleErr) return noStore(NextResponse.json({ ok: false, error: 'SALE_LOOKUP_FAILED', details: saleErr.message }, { status: 500 }))
    if (!sale) return noStore(NextResponse.json({ ok: false, error: 'SALE_NOT_FOUND' }, { status: 404 }))
    if (sale.status === 'canceled') return noStore(NextResponse.json({ ok: false, error: 'CANCELED_SALE_NOT_RECONCILABLE' }, { status: 400 }))

    const effectiveSaleDate = sale.purchase_date || String(sale.created_at || '').slice(0, 10)
    if (!effectiveSaleDate || effectiveSaleDate < RECONCILIATION_START_DATE) {
      return noStore(NextResponse.json({ ok: false, error: 'LEGACY_PERIOD_ALREADY_VALIDATED' }, { status: 400 }))
    }

    const recordedPaidCents = Math.max(0, Math.floor(Number(sale.paid_cents || 0)))
    const varianceCents = actualReceivedCents - recordedPaidCents

    if (varianceCents !== 0 && !note) {
      return noStore(NextResponse.json({ ok: false, error: 'DIFFERENCE_NOTE_REQUIRED' }, { status: 400 }))
    }

    const { data: inserted, error: insertErr } = await guard.admin
      .from('store_sale_reconciliations')
      .insert({
        sale_id: sale.id,
        recorded_paid_cents_snapshot: recordedPaidCents,
        actual_received_cents: actualReceivedCents,
        variance_cents: varianceCents,
        payment_method_snapshot: paymentMethod || sale.payment_method || null,
        received_date: receivedDate,
        reference,
        note,
        validated_by: guard.user.id,
        validated_at: new Date().toISOString(),
      })
      .select('id,sale_id,recorded_paid_cents_snapshot,actual_received_cents,variance_cents,received_date,validated_at')
      .single()

    if (insertErr) return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_INSERT_FAILED', details: insertErr.message }, { status: 500 }))

    try {
      revalidatePath('/admin/store/reconciliation')
      revalidatePath('/admin/store/sales')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return noStore(NextResponse.json({ ok: true, reconciliation: inserted }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
