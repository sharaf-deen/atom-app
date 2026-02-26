// src/app/api/admin/membership/expiry-reminders/notify/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { cairoToday, diffDays } from '@/lib/cairoDate'

type ProfileLite = {
  first_name: string | null
  last_name: string | null
  email: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function humanPlan(plan: string, sessionsTotal?: number | null) {
  if (plan === 'sessions') {
    const n = Number.isFinite(Number(sessionsTotal)) ? Number(sessionsTotal) : null
    return n ? `${n} sessions` : 'Sessions package'
  }
  if (!plan) return 'Membership'
  return plan.replace(/_/g, ' ').toUpperCase()
}

function makeTitle(daysLeft: number) {
  if (daysLeft <= 0) {
    return daysLeft === 0 ? 'Membership expires today' : 'Membership expired'
  }
  if (daysLeft === 1) return 'Membership expires tomorrow'
  return `Membership expires in ${daysLeft} days`
}

function makeBody(name: string, plan: string, endDate: string, daysLeft: number) {
  if (daysLeft < 0) {
    return `Hi ${name}, your ${plan} has expired (${endDate}). Please renew at reception.`
  }
  const when = daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
  return `Hi ${name}, your ${plan} will expire ${when} (${endDate}). Please renew at reception.`
}

async function getActorFromSession() {
  const supa = createSupabaseServerActionClient()
  const { data: auth, error: authErr } = await supa.auth.getUser()
  if (authErr || !auth?.user) return { ok: false as const, status: 401, error: 'NOT_AUTHENTICATED' }

  const actorId = auth.user.id
  const { data: me, error: meErr } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', actorId)
    .maybeSingle<{ role: string | null }>()

  if (meErr) return { ok: false as const, status: 500, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }
  const role = (me?.role ?? '').toLowerCase()
  if (!role || (role !== 'admin' && role !== 'super_admin')) {
    return { ok: false as const, status: 403, error: 'FORBIDDEN' }
  }

  return { ok: true as const, actorId, role }
}

export async function POST(req: Request) {
  try {
    const sess = await getActorFromSession()
    if (!sess.ok) {
      return noStore(
        NextResponse.json({ ok: false, error: sess.error, details: (sess as any).details }, { status: sess.status }),
      )
    }

    const body = await req.json().catch(() => ({} as any))
    const subscriptionId = typeof body?.subscription_id === 'string' ? body.subscription_id.trim() : ''
    if (!subscriptionId) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_SUBSCRIPTION_ID' }, { status: 400 }))
    }

    const today = cairoToday()
    const admin = createSupabaseAdminClient()

    // Load subscription + profile
    const { data: sub, error: subErr } = await admin
      .from('subscriptions')
      .select('id, member_id, end_date, plan, sessions_total, profiles:member_id(first_name,last_name,email)')
      .eq('id', subscriptionId)
      .maybeSingle()

    if (subErr) return noStore(NextResponse.json({ ok: false, error: 'LOAD_FAILED', details: subErr.message }, { status: 500 }))
    if (!sub) return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))

    const memberId = (sub as any).member_id as string | null
    const endDate = (sub as any).end_date as string | null
    if (!memberId || !endDate) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_ROW' }, { status: 400 }))
    }

    // Idempotency: only 1 manual notify per subscription per Cairo day
    const { data: existing, error: exErr } = await admin
      .from('audit_logs')
      .select('id')
      .eq('action', 'membership_expiry_reminder_manual')
      .eq('target_user_id', memberId)
      .contains('action_details', { subscription_id: subscriptionId, sent_on: today })
      .limit(1)

    if (!exErr && (existing ?? []).length > 0) {
      return noStore(NextResponse.json({ ok: true, skipped: true }, { status: 200 }))
    }

    const p = ((sub as any).profiles ?? null) as ProfileLite | null
    const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || p?.email || 'Member'
    const planName = humanPlan((sub as any).plan as string, (sub as any).sessions_total as number | null)
    const daysLeft = diffDays(today, endDate)

    const title = makeTitle(typeof daysLeft === 'number' ? daysLeft : 0)
    const bodyText = makeBody(name, planName, endDate, typeof daysLeft === 'number' ? daysLeft : 0)

    // Insert notification
    const { error: nErr } = await admin.from('notifications').insert({
      user_id: memberId,
      member_id: memberId,
      title,
      body: bodyText,
      kind: 'billing',
      created_by: sess.actorId,
    } as any)

    if (nErr) return noStore(NextResponse.json({ ok: false, error: 'NOTIFY_FAILED', details: nErr.message }, { status: 500 }))

    // Audit log (best-effort)
    try {
      await admin.from('audit_logs').insert({
        actor_user_id: sess.actorId,
        target_user_id: memberId,
        action: 'membership_expiry_reminder_manual',
        action_details: {
          subscription_id: subscriptionId,
          end_date: endDate,
          days_left: daysLeft,
          sent_on: today,
        },
      } as any)
    } catch {}

    return noStore(NextResponse.json({ ok: true }, { status: 200 }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'UNEXPECTED', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
