export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'

type PatchBody = {
  reconciliation_id?: string
  actual_received_cents?: number
  payment_method?: PaymentMethod | null
  received_date?: string
  reference?: string | null
  note?: string | null
}

type DeleteBody = {
  reconciliation_id?: string
}

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

function revalidateStore() {
  try {
    revalidatePath('/admin/store/reconciliation')
    revalidatePath('/admin/store/sales')
    revalidatePath('/admin/store/dashboard')
  } catch {}
}

export async function PATCH(req: Request) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const body = (await req.json().catch(() => ({}))) as PatchBody
    const reconciliationId = cleanText(body.reconciliation_id)
    const receivedDate = cleanText(body.received_date)
    const reference = cleanText(body.reference) || null
    const note = cleanText(body.note) || null

    if (!reconciliationId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_RECONCILIATION_ID' }, { status: 400 }))
    }
    if (!isDateOnly(receivedDate)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_RECEIVED_DATE' }, { status: 400 }))
    }

    const actualReceivedCents = Math.max(0, Math.floor(Number(body.actual_received_cents ?? 0)))
    const paymentMethod = body.payment_method && ALLOWED_METHODS.has(body.payment_method) ? body.payment_method : null

    const { data: existing, error: lookupErr } = await guard.admin
      .from('store_sale_reconciliations')
      .select('id,sale_id,recorded_paid_cents_snapshot')
      .eq('id', reconciliationId)
      .maybeSingle<{
        id: string
        sale_id: string
        recorded_paid_cents_snapshot: number | null
      }>()

    if (lookupErr) return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_LOOKUP_FAILED', details: lookupErr.message }, { status: 500 }))
    if (!existing) return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_NOT_FOUND' }, { status: 404 }))

    const recordedPaidCents = Math.max(0, Math.floor(Number(existing.recorded_paid_cents_snapshot || 0)))
    const varianceCents = actualReceivedCents - recordedPaidCents

    if (varianceCents !== 0 && !note) {
      return noStore(NextResponse.json({ ok: false, error: 'DIFFERENCE_NOTE_REQUIRED' }, { status: 400 }))
    }

    const { data: updated, error: updateErr } = await guard.admin
      .from('store_sale_reconciliations')
      .update({
        actual_received_cents: actualReceivedCents,
        variance_cents: varianceCents,
        payment_method_snapshot: paymentMethod,
        received_date: receivedDate,
        reference,
        note,
        validated_by: guard.user.id,
        validated_at: new Date().toISOString(),
      })
      .eq('id', reconciliationId)
      .select('id,sale_id,recorded_paid_cents_snapshot,actual_received_cents,variance_cents,payment_method_snapshot,received_date,reference,note,validated_by,validated_at')
      .single()

    if (updateErr) {
      return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_UPDATE_FAILED', details: updateErr.message }, { status: 500 }))
    }

    revalidateStore()
    return noStore(NextResponse.json({ ok: true, reconciliation: updated }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}

export async function DELETE(req: Request) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const body = (await req.json().catch(() => ({}))) as DeleteBody
    const reconciliationId = cleanText(body.reconciliation_id)

    if (!reconciliationId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_RECONCILIATION_ID' }, { status: 400 }))
    }

    const { data: existing, error: lookupErr } = await guard.admin
      .from('store_sale_reconciliations')
      .select('id,sale_id')
      .eq('id', reconciliationId)
      .maybeSingle<{ id: string; sale_id: string }>()

    if (lookupErr) return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_LOOKUP_FAILED', details: lookupErr.message }, { status: 500 }))
    if (!existing) return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_NOT_FOUND' }, { status: 404 }))

    const { error: deleteErr } = await guard.admin
      .from('store_sale_reconciliations')
      .delete()
      .eq('id', reconciliationId)

    if (deleteErr) {
      return noStore(NextResponse.json({ ok: false, error: 'RECONCILIATION_DELETE_FAILED', details: deleteErr.message }, { status: 500 }))
    }

    revalidateStore()
    return noStore(NextResponse.json({ ok: true, id: reconciliationId, sale_id: existing.sale_id }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
