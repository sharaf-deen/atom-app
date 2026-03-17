export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { cairoLocalToUTC, CAIRO_TZ, isISODateOnly } from '@/lib/cairoTime'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function cairoClockParts(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  const dt = raw ? new Date(raw) : null
  if (!dt || Number.isNaN(dt.getTime())) {
    return { hour: 12, minute: 0, second: 0 }
  }

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = fmt.formatToParts(dt)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }

  const hour = Number(map.hour ?? '12')
  const minute = Number(map.minute ?? '0')
  const second = Number(map.second ?? '0')

  return {
    hour: Number.isFinite(hour) ? hour : 12,
    minute: Number.isFinite(minute) ? minute : 0,
    second: Number.isFinite(second) ? second : 0,
  }
}

async function insertAuditLog(admin: any, payload: {
  actor_user_id: string
  target_user_id: string
  action: string
  action_details: Record<string, unknown>
}) {
  try {
    await admin.from('audit_logs').insert(payload)
  } catch {
    // best effort only
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const paymentId = String(params?.id ?? '').trim()
    if (!isUuid(paymentId)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_PAYMENT_ID' }, { status: 400 }))
    }

    const body = await req.json().catch(() => ({} as any))
    const paymentDate = String(body?.payment_date ?? '').trim()
    if (!isISODateOnly(paymentDate)) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'INVALID_PAYMENT_DATE', details: 'payment_date must be YYYY-MM-DD.' },
          { status: 400 },
        ),
      )
    }

    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr || !authData.user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const actorId = authData.user.id
    const { data: actorProfile, error: actorProfileErr } = await supa
      .from('profiles')
      .select('user_id, role')
      .eq('user_id', actorId)
      .maybeSingle<{ user_id: string; role: string | null }>()

    if (actorProfileErr) {
      return noStore(NextResponse.json({ ok: false, error: 'ACTOR_PROFILE_ERROR', details: actorProfileErr.message }, { status: 500 }))
    }

    const actorRole = String(actorProfile?.role ?? '')
    if (actorRole !== 'admin' && actorRole !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const admin = createSupabaseAdminClient()

    const { data: payment, error: paymentErr } = await admin
      .from('subscription_payments')
      .select('id, subscription_id, member_id, amount, payment_method, note, paid_at, created_at')
      .eq('id', paymentId)
      .maybeSingle<{
        id: string
        subscription_id: string | null
        member_id: string
        amount: number
        payment_method: string | null
        note: string | null
        paid_at: string | null
        created_at: string | null
      }>()

    if (paymentErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PAYMENT_LOOKUP_ERROR', details: paymentErr.message }, { status: 500 }))
    }

    if (!payment) {
      return noStore(NextResponse.json({ ok: false, error: 'PAYMENT_NOT_FOUND' }, { status: 404 }))
    }

    const currentBase = payment.paid_at || payment.created_at || null
    const clock = cairoClockParts(currentBase)
    const newPaidAt = cairoLocalToUTC({
      dateOnly: paymentDate,
      hour: clock.hour,
      minute: clock.minute,
      second: clock.second,
    }).toISOString()

    const { error: updatePaymentErr } = await admin
      .from('subscription_payments')
      .update({ paid_at: newPaidAt })
      .eq('id', paymentId)

    if (updatePaymentErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'UPDATE_PAYMENT_FAILED', details: updatePaymentErr.message }, { status: 400 }),
      )
    }

    let latestPaidAt: string | null = null

    if (payment.subscription_id) {
      const { data: latestPayment, error: latestErr } = await admin
        .from('subscription_payments')
        .select('id, paid_at, created_at')
        .eq('subscription_id', payment.subscription_id)
        .order('paid_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; paid_at: string | null; created_at: string | null }>()

      if (!latestErr && latestPayment) {
        latestPaidAt = latestPayment.paid_at || latestPayment.created_at || null
        if (latestPaidAt) {
          await admin.from('subscriptions').update({ paid_at: latestPaidAt }).eq('id', payment.subscription_id)
        }
      }
    }

    await insertAuditLog(admin, {
      actor_user_id: actorId,
      target_user_id: payment.member_id,
      action: 'update_payment_date',
      action_details: {
        payment_id: payment.id,
        subscription_id: payment.subscription_id,
        old_paid_at: payment.paid_at,
        new_paid_at: newPaidAt,
        payment_date: paymentDate,
      },
    })

    return noStore(
      NextResponse.json({
        ok: true,
        payment_id: payment.id,
        paid_at: newPaidAt,
        subscription_latest_paid_at: latestPaidAt,
      }),
    )
  } catch (e: any) {
    return noStore(
      NextResponse.json(
        {
          ok: false,
          error: 'SERVER_ERROR',
          details: e?.message ?? 'Unexpected error',
        },
        { status: 500 },
      ),
    )
  }
}
