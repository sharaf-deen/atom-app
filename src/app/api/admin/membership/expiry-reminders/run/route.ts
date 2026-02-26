// src/app/api/admin/membership/expiry-reminders/run/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { addDays, cairoToday, CAIRO_TZ } from '@/lib/cairoDate'

type ProfileLite = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  member_id: string | null
}

type SubRow = {
  id: string
  member_id: string
  end_date: string | null
  status: string
  plan: string
  sessions_total: number | null
  frozen_until: string | null
  profiles?: ProfileLite | null
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

function makeTitle(daysBefore: number) {
  if (daysBefore <= 0) return 'Membership expires today'
  if (daysBefore === 1) return 'Membership expires tomorrow'
  return `Membership expires in ${daysBefore} days`
}

function makeBody(name: string, plan: string, endDate: string, daysBefore: number) {
  const when = daysBefore <= 0 ? 'today' : daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`
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

export async function GET(req: Request) {
  try {
    // Allow 2 auth modes:
    // - Vercel Cron: Authorization: Bearer ${CRON_SECRET}
    // - Manual run: authenticated admin/super_admin session
    const authHeader = req.headers.get('authorization') ?? ''
    const cronSecret = process.env.CRON_SECRET
    const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`

    let actorId: string | null = null
    let actorRole: string | null = null

    if (!cronOk) {
      const sess = await getActorFromSession()
      if (!sess.ok) {
        return noStore(
          NextResponse.json(
            { ok: false, error: sess.error, ...(sess as any).details ? { details: (sess as any).details } : {} },
            { status: sess.status },
          ),
        )
      }
      actorId = sess.actorId
      actorRole = sess.role
    }

    const url = new URL(req.url)
    const daysParam = (url.searchParams.get('days') ?? '7,3,1,0').trim()
    const dryRun = (url.searchParams.get('dry_run') ?? '').trim() === '1'

    const daysList = Array.from(
      new Set(
        daysParam
          .split(',')
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n) && n >= 0 && n <= 60),
      ),
    ).sort((a, b) => b - a) // largest first

    const today = cairoToday()

    const admin = createSupabaseAdminClient()

    const summary: any = {
      ok: true,
      mode: cronOk ? 'cron' : 'manual',
      actor_role: actorRole,
      timeZone: CAIRO_TZ,
      today,
      days: daysList,
      dry_run: dryRun,
      totals: { candidates: 0, sent: 0, skipped: 0, errors: 0 },
      by_days: {} as Record<string, any>,
    }

    for (const daysBefore of daysList) {
      const targetDate = addDays(today, daysBefore)

      // 1) Find active subscriptions expiring on targetDate
      const { data: subs, error: subErr } = await admin
        .from('subscriptions')
        .select(
          'id, member_id, end_date, status, plan, sessions_total, frozen_until, profiles:member_id(first_name,last_name,email,phone,member_id)',
        )
        .eq('status', 'active')
        .eq('end_date', targetDate)
        .limit(5000)

      if (subErr) {
        summary.totals.errors++
        summary.by_days[String(daysBefore)] = { targetDate, error: subErr.message, sent: 0, skipped: 0 }
        continue
      }

      const list = (subs ?? []) as unknown as SubRow[]

      // Skip frozen members (currently frozen): frozen_until >= today
      const candidates = list.filter((s) => {
        const fu = (s.frozen_until ?? '').trim()
        if (!fu) return true
        return fu < today
      })

      summary.totals.candidates += candidates.length

      let sent = 0
      let skipped = 0
      const errors: string[] = []

      for (const s of candidates) {
        const memberId = s.member_id
        if (!memberId) {
          skipped++
          continue
        }

        // 2) Idempotency: skip if already sent (audit log exists)
        const { data: existing, error: exErr } = await admin
          .from('audit_logs')
          .select('id')
          .eq('action', 'membership_expiry_reminder')
          .eq('target_user_id', memberId)
          .contains('action_details', { subscription_id: s.id, days_before: daysBefore })
          .limit(1)

        if (exErr) {
          // If audit lookup fails, be safe: skip
          skipped++
          continue
        }
        if ((existing ?? []).length > 0) {
          skipped++
          continue
        }

        const p = (s.profiles ?? null) as ProfileLite | null
        const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || p?.email || 'Member'
        const endDate = s.end_date ?? targetDate
        const planName = humanPlan(s.plan, s.sessions_total)

        if (dryRun) {
          sent++
          continue
        }

        // 3) Insert notification
        const nTitle = makeTitle(daysBefore)
        const nBody = makeBody(name, planName, endDate, daysBefore)

        const { error: nErr } = await admin.from('notifications').insert({
          user_id: memberId,
          member_id: memberId,
          title: nTitle,
          body: nBody,
          kind: 'billing',
          created_by: actorId, // null for cron
        } as any)

        if (nErr) {
          errors.push(`notif:${memberId}:${nErr.message}`)
          summary.totals.errors++
          continue
        }

        // 4) Insert audit log
        const { error: aErr } = await admin.from('audit_logs').insert({
          actor_user_id: actorId,
          target_user_id: memberId,
          action: 'membership_expiry_reminder',
          action_details: {
            subscription_id: s.id,
            days_before: daysBefore,
            end_date: endDate,
          },
        } as any)

        if (aErr) {
          // Do not fail the notification; just record error
          errors.push(`audit:${memberId}:${aErr.message}`)
          summary.totals.errors++
        }

        sent++
      }

      summary.totals.sent += sent
      summary.totals.skipped += skipped
      summary.by_days[String(daysBefore)] = {
        targetDate,
        candidates: candidates.length,
        sent,
        skipped,
        errors: errors.length ? errors.slice(0, 20) : undefined,
      }
    }

    return noStore(NextResponse.json(summary, { status: 200 }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }),
    )
  }
}
