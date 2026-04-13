export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { isStorePaymentMethod, isStorePreorderStatus } from '@/lib/storeV2'

type Body = {
  id?: string
  status?: string
  deposit_amount?: string | number | null
  deposit_payment_method?: string | null
  note?: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function parseAmountToCents(value: unknown) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return NaN
    return Math.round(value * 100)
  }
  const normalized = String(value).replace(/,/g, '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return NaN
  return Math.round(parsed * 100)
}

export async function PATCH(req: Request) {
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
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()

    if (profileErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profileErr.message }, { status: 500 }))
    }

    if ((profile?.role || '') !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const id = String(body?.id || '').trim()
    const status = body?.status === undefined ? undefined : String(body.status || '').trim()
    const depositCents = parseAmountToCents(body?.deposit_amount)
    const paymentMethodRaw = body?.deposit_payment_method === undefined ? undefined : (body.deposit_payment_method === null ? null : String(body.deposit_payment_method || '').trim())
    const noteRaw = body?.note === undefined ? undefined : (body.note === null ? null : String(body.note || '').trim())

    if (!id) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_ID_REQUIRED' }, { status: 400 }))
    }

    if (status !== undefined && !isStorePreorderStatus(status)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_STATUS' }, { status: 400 }))
    }

    if (!Number.isFinite(depositCents) || depositCents < 0) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_DEPOSIT_AMOUNT' }, { status: 400 }))
    }

    if (paymentMethodRaw !== undefined && paymentMethodRaw !== null && paymentMethodRaw !== '' && !isStorePaymentMethod(paymentMethodRaw)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_PAYMENT_METHOD' }, { status: 400 }))
    }

    const { data: current, error: currentErr } = await supa
      .from('store_preorders')
      .select('id, buyer_user_id, product_name, total_cents, deposit_cents, deposit_payment_method, status')
      .eq('id', id)
      .maybeSingle<{
        id: string
        buyer_user_id: string
        product_name: string | null
        total_cents: number
        deposit_cents: number
        deposit_payment_method: string | null
        status: string
      }>()

    if (currentErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_LOOKUP_FAILED', details: currentErr.message }, { status: 500 }))
    }

    if (!current?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'PREORDER_NOT_FOUND' }, { status: 404 }))
    }

    if (depositCents > Math.max(0, Number(current.total_cents ?? 0))) {
      return noStore(NextResponse.json({ ok: false, error: 'DEPOSIT_EXCEEDS_TOTAL' }, { status: 400 }))
    }

    let depositPaymentMethod: string | null
    if (depositCents <= 0) {
      depositPaymentMethod = null
    } else if (paymentMethodRaw === undefined) {
      depositPaymentMethod = current.deposit_payment_method
      if (!depositPaymentMethod) {
        return noStore(NextResponse.json({ ok: false, error: 'PAYMENT_METHOD_REQUIRED' }, { status: 400 }))
      }
    } else if (paymentMethodRaw === null || paymentMethodRaw === '') {
      return noStore(NextResponse.json({ ok: false, error: 'PAYMENT_METHOD_REQUIRED' }, { status: 400 }))
    } else {
      depositPaymentMethod = paymentMethodRaw
    }

    const updatePayload: {
      updated_by: string
      deposit_cents: number
      deposit_payment_method: string | null
      status?: string
      note?: string | null
    } = {
      updated_by: user.id,
      deposit_cents: depositCents,
      deposit_payment_method: depositPaymentMethod,
    }

    if (status !== undefined) updatePayload.status = status
    if (noteRaw !== undefined) updatePayload.note = noteRaw

    const { data: updated, error: updateErr } = await supa
      .from('store_preorders')
      .update(updatePayload)
      .eq('id', id)
      .select('id, status, deposit_cents, deposit_payment_method, balance_due_cents, updated_at')
      .maybeSingle<{
        id: string
        status: string
        deposit_cents: number
        deposit_payment_method: string | null
        balance_due_cents: number
        updated_at: string
      }>()

    if (updateErr || !updated?.id) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PREORDER_UPDATE_FAILED', details: updateErr?.message || 'update failed' },
          { status: 500 }
        )
      )
    }

    const statusChanged = status !== undefined && updated.status !== current.status
    if (statusChanged && current.buyer_user_id) {
      const titleMap: Partial<Record<string, string>> = {
        confirmed: 'Preorder confirmed',
        ordered_from_supplier: 'Preorder ordered from supplier',
        ready: 'Preorder ready',
        completed: 'Preorder completed',
        canceled: 'Preorder canceled',
      }

      const bodyMap: Partial<Record<string, string>> = {
        confirmed: `Your preorder${current.product_name ? ` for ${current.product_name}` : ''} has been confirmed.`,
        ordered_from_supplier: `Your preorder${current.product_name ? ` for ${current.product_name}` : ''} has been ordered from the supplier.`,
        ready: `Your preorder${current.product_name ? ` for ${current.product_name}` : ''} is ready.`,
        completed: `Your preorder${current.product_name ? ` for ${current.product_name}` : ''} has been completed.`,
        canceled: `Your preorder${current.product_name ? ` for ${current.product_name}` : ''} has been canceled.`,
      }

      const nextTitle = titleMap[updated.status]
      const nextBody = bodyMap[updated.status]

      if (nextTitle && nextBody) {
        try {
          const admin = createSupabaseAdminClient()
          await admin.from('notifications').insert({
            user_id: current.buyer_user_id,
            member_id: current.buyer_user_id,
            created_by: user.id,
            kind: 'order_update',
            title: nextTitle,
            body: nextBody,
          })
        } catch {}
      }
    }

    revalidateTag('store-products')
    try { revalidatePath('/store') } catch {}
    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/admin/store/preorders') } catch {}
    try { revalidatePath('/admin/store/dashboard') } catch {}

    return noStore(NextResponse.json({ ok: true, item: updated }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
