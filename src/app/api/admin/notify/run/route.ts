// src/app/api/admin/notify/run/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { addDays, cairoToday } from '@/lib/cairoDate'
import { jsonWithApiRuntime, logApiError, logApiWarn, startApiRuntime } from '@/lib/apiRuntime'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function fullName(p?: { first_name: string | null; last_name: string | null }) {
  const n = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim()
  return n || 'Member'
}

async function trySendEmail(to: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM || 'noreply@example.com'
  if (!apiKey) return { sent: false, reason: 'NO_PROVIDER' }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  })
  if (!r.ok) {
    const err = await r.text().catch(() => '')
    return { sent: false, reason: `HTTP_${r.status}: ${err}` }
  }
  return { sent: true }
}

export async function POST(req: Request) {
  const meta = startApiRuntime('/api/admin/notify/run')

  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return jsonWithApiRuntime(meta, 401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      logApiError(meta, 'profile_lookup', meErr)
      return jsonWithApiRuntime(meta, 500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    }

    const role = me?.role ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) {
      return jsonWithApiRuntime(meta, 403, { ok: false, error: 'FORBIDDEN' })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !service) {
      logApiError(meta, 'env', 'SUPABASE env missing')
      return jsonWithApiRuntime(meta, 500, { ok: false, error: 'SERVER_ENV_MISSING' })
    }
    const admin = createClient(url, service)

    const sp = new URL(req.url).searchParams
    const dry = sp.get('dry') === '1'
    const mark = sp.get('mark') === '1'
    const today = cairoToday()

    const target = addDays(today, 7)
    const targetNext = addDays(target, 1)
    const { data: expiring, error: e1 } = await admin
      .from('subscriptions')
      .select('id, member_id, plan, end_date')
      .eq('subscription_type', 'time')
      .eq('status', 'active')
      .gte('end_date', target)
      .lt('end_date', targetNext)
      .limit(10000)
    if (e1) {
      logApiError(meta, 'query_expiring', e1)
      return jsonWithApiRuntime(meta, 500, { ok: false, error: 'QUERY_FAILED', details: e1.message })
    }

    const { data: sessionsRows, error: e2 } = await admin
      .from('subscriptions')
      .select('id, member_id, sessions_total, sessions_used, end_date')
      .eq('subscription_type', 'sessions')
      .eq('status', 'active')
      .gte('end_date', today)
      .limit(10000)
    if (e2) {
      logApiError(meta, 'query_sessions', e2)
      return jsonWithApiRuntime(meta, 500, { ok: false, error: 'QUERY_FAILED', details: e2.message })
    }

    const sessionsFiltered = (sessionsRows ?? []).filter((s) => {
      const left = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
      return left <= 2
    })

    const memberIds = Array.from(
      new Set([...(expiring ?? []).map((s) => s.member_id), ...(sessionsFiltered ?? []).map((s) => s.member_id)].filter(Boolean)),
    ) as string[]

    const profilesMap = new Map<string, { email: string; first_name: string | null; last_name: string | null }>()
    if (memberIds.length > 0) {
      const { data: profs, error: pe } = await admin
        .from('profiles')
        .select('user_id, email, first_name, last_name')
        .in('user_id', memberIds)
        .limit(10000)
      if (pe) {
        logApiError(meta, 'profiles_query', pe, { member_count: memberIds.length })
        return jsonWithApiRuntime(meta, 500, { ok: false, error: 'PROFILES_QUERY_FAILED', details: pe.message })
      }
      for (const p of profs ?? []) {
        if ((p as any).user_id && (p as any).email) {
          profilesMap.set((p as any).user_id, {
            email: (p as any).email,
            first_name: (p as any).first_name ?? null,
            last_name: (p as any).last_name ?? null,
          })
        }
      }
    }

    type Out = {
      member_id: string
      subscription_id: string
      kind: 'expire_7d' | 'sessions_low'
      email: string
      subject: string
      body: string
    }
    const out: Out[] = []

    for (const s of expiring ?? []) {
      const prof = profilesMap.get(s.member_id)
      if (!prof?.email) continue
      const name = fullName(prof)
      out.push({
        member_id: s.member_id,
        subscription_id: s.id,
        kind: 'expire_7d',
        email: prof.email,
        subject: 'Your membership expires in 7 days',
        body: `Hello ${name},

This is a friendly reminder that your membership will expire in 7 days (on ${s.end_date}).
If you need any help renewing, just reply to this email or visit the front desk.

Thank you!`,
      })
    }

    for (const s of sessionsFiltered ?? []) {
      const prof = profilesMap.get(s.member_id)
      if (!prof?.email) continue
      const name = fullName(prof)
      const left = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
      out.push({
        member_id: s.member_id,
        subscription_id: s.id,
        kind: 'sessions_low',
        email: prof.email,
        subject: `Only ${left} session(s) left`,
        body: `Hello ${name},

You have only ${left} session(s) remaining on your current pack.
If you want to top up or have questions, reply to this email or visit the front desk.

See you soon!`,
      })
    }

    const candidates = { expire_7d: (expiring ?? []).length, sessions_low: (sessionsFiltered ?? []).length }

    let queuedExpire = 0
    let queuedSessions = 0
    if (out.length > 0) {
      const { data, error: upErr } = await admin
        .from('notifications_outbox')
        .upsert(
          out.map((o) => ({
            member_id: o.member_id,
            subscription_id: o.subscription_id,
            kind: o.kind,
            email: o.email,
            subject: o.subject,
            body: o.body,
          })),
          { onConflict: 'kind,subscription_id' },
        )
        .select('id, kind')
      if (upErr) {
        logApiError(meta, 'outbox_upsert', upErr, { count: out.length })
        return jsonWithApiRuntime(meta, 500, { ok: false, error: 'OUTBOX_UPSERT_FAILED', details: upErr.message })
      }

      queuedExpire = (data ?? []).filter((r) => r.kind === 'expire_7d').length
      queuedSessions = (data ?? []).filter((r) => r.kind === 'sessions_low').length
    }

    let sent = 0
    const haveProvider = !!process.env.RESEND_API_KEY

    if (!dry) {
      if (haveProvider) {
        const { data: pending, error: pendErr } = await admin
          .from('notifications_outbox')
          .select('id, email, subject, body, sent_at')
          .is('sent_at', null)
          .limit(500)
        if (pendErr) {
          logApiError(meta, 'outbox_fetch_pending', pendErr)
          return jsonWithApiRuntime(meta, 500, { ok: false, error: 'OUTBOX_FETCH_PENDING_FAILED', details: pendErr.message })
        }

        for (const item of pending ?? []) {
          const res = await trySendEmail(item.email, item.subject, item.body)
          if (res.sent) {
            sent++
            await admin.from('notifications_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', item.id)
          } else {
            logApiWarn(meta, 'send_email_item', { outbox_id: item.id, reason: res.reason || 'SEND_FAILED' })
            await admin.from('notifications_outbox').update({ error: res.reason || 'SEND_FAILED' }).eq('id', item.id)
          }
        }
      } else if (mark) {
        const { data: pending, error: pendErr } = await admin.from('notifications_outbox').select('id').is('sent_at', null).limit(500)
        if (!pendErr) {
          const now = new Date().toISOString()
          const { data: upd } = await admin
            .from('notifications_outbox')
            .update({ sent_at: now, error: 'MARKED_SENT_NO_PROVIDER' })
            .in('id', (pending ?? []).map((p) => p.id))
            .select('id')
          sent = (upd ?? []).length
        }
      }
    }

    return jsonWithApiRuntime(meta, 200, {
      ok: true,
      date: today,
      candidates,
      queued: { expire_7d: queuedExpire, sessions_low: queuedSessions },
      sent,
      dry,
      marked: !haveProvider && !dry && mark,
    })
  } catch (e: any) {
    logApiError(meta, 'unexpected', e)
    return jsonWithApiRuntime(meta, 500, { ok: false, error: e?.message || 'SERVER_ERROR' })
  }
}
