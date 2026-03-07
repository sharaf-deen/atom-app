// src/app/api/admin/billing/outstanding-reminders/run/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { cairoToday, CAIRO_TZ } from '@/lib/cairoDate'

type ProfileLite = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  member_id: string | null
}

type SubRow = {
  id: string
  member_id: string | null
  plan: string | null
  status: string | null
  end_date: string | null
  amount: number | null
  amount_due: number | null
  payment_method: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function fmtEGP(v: any) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(0)
}

function makeTitle(totalDue: number) {
  return `Outstanding balance: ${fmtEGP(totalDue)} EGP`
}

function makeBody(name: string, totalDue: number, subsCount: number) {
  const suffix = subsCount > 1 ? ` (${subsCount} items)` : ''
  return `Hi ${name}, you have an outstanding balance of ${fmtEGP(totalDue)} EGP${suffix}. Please settle at reception.`
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
    const minDue = Number(url.searchParams.get('min_due') ?? '1')
    const cooldownDays = Math.max(0, Math.min(30, Number(url.searchParams.get('cooldown_days') ?? '3')))
    const limit = Math.max(100, Math.min(5000, Number(url.searchParams.get('limit') ?? '5000')))
    const dryRun = (url.searchParams.get('dry_run') ?? '').trim() === '1'

    const today = cairoToday()
    let admin: ReturnType<typeof createSupabaseAdminClient>
    try {
      admin = createSupabaseAdminClient()
    } catch (e: any) {
      // Important for CI/static export: do not hard-crash if env is missing at build time.
      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'MISSING_SERVER_ENV',
            details: e?.message ?? 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
          },
          { status: 200 },
        ),
      )
    }

    const summary: any = {
      ok: true,
      mode: cronOk ? 'cron' : 'manual',
      actor_role: actorRole,
      timeZone: CAIRO_TZ,
      today,
      params: { min_due: minDue, cooldown_days: cooldownDays, limit, dry_run: dryRun },
      totals: { candidates: 0, grouped_members: 0, sent: 0, skipped: 0, errors: 0 },
    }

    // 1) Find subscriptions with amount_due > 0
    const { data: subsRaw, error: subErr } = await admin
      .from('subscriptions')
      .select('id, member_id, plan, status, end_date, amount, amount_due, payment_method')
      .gt('amount_due', minDue)
      .order('amount_due', { ascending: false })
      .limit(limit)

    if (subErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SUBS_QUERY_FAILED', details: subErr.message }, { status: 500 }))
    }

    const subs: SubRow[] = (subsRaw ?? []) as any
    summary.totals.candidates = subs.length

    // 2) Group by member
    const byMember = new Map<
      string,
      { user_id: string; subs: SubRow[]; total_due: number; total_paid: number; max_due: number }
    >()

    for (const s of subs) {
      const uid = (s.member_id ?? '').trim()
      if (!uid) continue
      const due = Number(s.amount_due ?? 0)
      const paid = Number(s.amount ?? 0)
      const cur = byMember.get(uid)
      if (!cur) {
        byMember.set(uid, {
          user_id: uid,
          subs: [s],
          total_due: Number.isFinite(due) ? due : 0,
          total_paid: Number.isFinite(paid) ? paid : 0,
          max_due: Number.isFinite(due) ? due : 0,
        })
      } else {
        cur.subs.push(s)
        cur.total_due += Number.isFinite(due) ? due : 0
        cur.total_paid += Number.isFinite(paid) ? paid : 0
        cur.max_due = Math.max(cur.max_due, Number.isFinite(due) ? due : 0)
      }
    }

    const memberIds = Array.from(byMember.keys())
    summary.totals.grouped_members = memberIds.length

    if (!memberIds.length) {
      return noStore(NextResponse.json(summary, { status: 200 }))
    }

    // 3) Idempotency / cooldown: skip members reminded recently
    const recentCutoffIso = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000).toISOString()
    const recentReminded = new Set<string>()

    if (cooldownDays > 0) {
      const { data: recent, error: rErr } = await admin
        .from('audit_logs')
        .select('target_user_id, created_at')
        .eq('action', 'outstanding_due_reminder')
        .gte('created_at', recentCutoffIso)
        .in('target_user_id', memberIds)
        .limit(5000)

      if (!rErr) {
        for (const r of (recent ?? []) as any[]) {
          if (r?.target_user_id) recentReminded.add(String(r.target_user_id))
        }
      }
    }

    // 4) Profiles for nicer message
    const profileMap = new Map<string, ProfileLite>()
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id, first_name, last_name, email, phone, member_id')
      .in('user_id', memberIds)

    for (const p of ((profs ?? []) as any[]) as ProfileLite[]) {
      if (p?.user_id) profileMap.set(p.user_id, p)
    }

    // 5) Send notifications
    for (const uid of memberIds) {
      if (cooldownDays > 0 && recentReminded.has(uid)) {
        summary.totals.skipped++
        continue
      }

      const g = byMember.get(uid)
      if (!g) continue
      if (!(g.total_due > minDue)) {
        summary.totals.skipped++
        continue
      }

      const p = profileMap.get(uid)
      const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || p?.email || 'Member'

      if (dryRun) {
        summary.totals.sent++
        continue
      }

      const title = makeTitle(g.total_due)
      const body = makeBody(name, g.total_due, g.subs.length)

      const { error: nErr } = await admin.from('notifications').insert({
        user_id: uid,
        member_id: uid,
        title,
        body,
        kind: 'billing',
        created_by: actorId,
      } as any)

      if (nErr) {
        summary.totals.errors++
        continue
      }

      const { error: aErr } = await admin.from('audit_logs').insert({
        actor_user_id: actorId,
        target_user_id: uid,
        action: 'outstanding_due_reminder',
        action_details: {
          total_due: g.total_due,
          subscriptions: g.subs.map((s) => ({ id: s.id, due: s.amount_due, plan: s.plan, status: s.status })),
          cooldown_days: cooldownDays,
        },
      } as any)

      if (aErr) {
        summary.totals.errors++
      }

      summary.totals.sent++
    }

    return noStore(NextResponse.json(summary, { status: 200 }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
