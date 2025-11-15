// src/app/api/admin/notify/run/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}
function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
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
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    const role = me?.role ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !service) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_ENV_MISSING' }, { status: 500 }))
    }
    const admin = createClient(url, service)

    const sp = new URL(req.url).searchParams
    const dry = sp.get('dry') === '1'
    const mark = sp.get('mark') === '1' // option test : marquer comme envoyé même sans provider
    const today = todayUTC()

    // --- 1) Expire J+7 (plage [J+7 ; J+8[ pour gérer date ou timestamptz)
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
    if (e1) return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: e1.message }, { status: 500 }))

    // --- 2) Packs sessions (≤ 2 restantes, encore valides)
    const { data: sessionsRows, error: e2 } = await admin
      .from('subscriptions')
      .select('id, member_id, sessions_total, sessions_used, end_date')
      .eq('subscription_type', 'sessions')
      .eq('status', 'active')
      .gte('end_date', today) // valide aujourd'hui
      .limit(10000)
    if (e2) return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: e2.message }, { status: 500 }))

    const sessionsFiltered = (sessionsRows ?? []).filter(s => {
      const left = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
      return left <= 2
    })

    // --- Profils (emails)
    const memberIds = Array.from(new Set([
      ...(expiring ?? []).map(s => s.member_id),
      ...(sessionsFiltered ?? []).map(s => s.member_id),
    ].filter(Boolean))) as string[]

    const profilesMap = new Map<string, { email: string; first_name: string | null; last_name: string | null }>()
    if (memberIds.length > 0) {
      const { data: profs, error: pe } = await admin
        .from('profiles')
        .select('user_id, email, first_name, last_name')
        .in('user_id', memberIds)
        .limit(10000)
      if (pe) return noStore(NextResponse.json({ ok: false, error: 'PROFILES_QUERY_FAILED', details: pe.message }, { status: 500 }))
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

    // --- Outbox
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
        body:
`Hello ${name},

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
        body:
`Hello ${name},

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
          out.map(o => ({
            member_id: o.member_id,
            subscription_id: o.subscription_id,
            kind: o.kind,
            email: o.email,
            subject: o.subject,
            body: o.body,
          })),
          { onConflict: 'kind,subscription_id' }
        )
        .select('id, kind')
      if (upErr) return noStore(NextResponse.json({ ok: false, error: 'OUTBOX_UPSERT_FAILED', details: upErr.message }, { status: 500 }))

      queuedExpire = (data ?? []).filter(r => r.kind === 'expire_7d').length
      queuedSessions = (data ?? []).filter(r => r.kind === 'sessions_low').length
    }

    // Envoi / marquage
    let sent = 0
    const haveProvider = !!process.env.RESEND_API_KEY

    if (!dry) {
      if (haveProvider) {
        const { data: pending, error: pendErr } = await admin
          .from('notifications_outbox')
          .select('id, email, subject, body, sent_at')
          .is('sent_at', null)
          .limit(500)
        if (pendErr) return noStore(NextResponse.json({ ok: false, error: 'OUTBOX_FETCH_PENDING_FAILED', details: pendErr.message }, { status: 500 }))

        for (const item of pending ?? []) {
          const res = await trySendEmail(item.email, item.subject, item.body)
          if (res.sent) {
            sent++
            await admin.from('notifications_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', item.id)
          } else {
            await admin.from('notifications_outbox').update({ error: res.reason || 'SEND_FAILED' }).eq('id', item.id)
          }
        }
      } else if (mark) {
        // Mode test : marquer comme "envoyé" même sans provider
        const { data: pending, error: pendErr } = await admin
          .from('notifications_outbox')
          .select('id')
          .is('sent_at', null)
          .limit(500)
        if (!pendErr) {
          const now = new Date().toISOString()
          const { data: upd } = await admin
            .from('notifications_outbox')
            .update({ sent_at: now, error: 'MARKED_SENT_NO_PROVIDER' })
            .in('id', (pending ?? []).map(p => p.id))
            .select('id')
          sent = (upd ?? []).length
        }
      }
    }

    return noStore(NextResponse.json({
      ok: true,
      date: today,
      candidates, // <- utile pour debug (combien détectés avant dédup)
      queued: { expire_7d: queuedExpire, sessions_low: queuedSessions },
      sent,
      dry: dry ? true : false,
      marked: (!haveProvider && !dry && mark) ? true : false,
    }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
