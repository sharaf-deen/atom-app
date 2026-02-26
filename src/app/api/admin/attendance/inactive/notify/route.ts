// src/app/api/admin/attendance/inactive/notify/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const CAIRO_TZ = 'Africa/Cairo'

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

async function requireAdmin() {
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
  if (role !== 'admin' && role !== 'super_admin') return { ok: false as const, status: 403, error: 'FORBIDDEN' }

  return { ok: true as const, actorId }
}

type TemplateKey = 'reminder' | 'offer'

export async function POST(req: Request) {
  try {
    const sess = await requireAdmin()
    if (!sess.ok) {
      return noStore(
        NextResponse.json({ ok: false, error: sess.error, details: (sess as any).details }, { status: sess.status }),
      )
    }

    const body: any = await req.json().catch(() => ({} as any))

    const idsRaw: unknown = body?.member_ids
    if (!Array.isArray(idsRaw)) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_MEMBERS' }, { status: 400 }))
    }

    const memberIds: string[] = (idsRaw as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((s) => s.trim())

    if (!memberIds.length) return noStore(NextResponse.json({ ok: false, error: 'NO_MEMBERS' }, { status: 400 }))
    if (memberIds.length > 200) return noStore(NextResponse.json({ ok: false, error: 'TOO_MANY' }, { status: 400 }))

    const template: TemplateKey = body?.template === 'offer' ? 'offer' : 'reminder'
    const title = typeof body?.title === 'string' ? body.title.slice(0, 120) : null
    const text = typeof body?.body === 'string' ? body.body.slice(0, 2000) : null

    const today = cairoToday()
    const admin = createSupabaseAdminClient()

    // Idempotency: max 1 inactive notify per member per Cairo day
    const { data: existing, error: exErr } = await admin
      .from('audit_logs')
      .select('target_user_id')
      .eq('action', 'attendance_inactive_notify')
      .in('target_user_id', memberIds)
      .contains('action_details', { sent_on: today })
      .limit(10000)

    if (exErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUDIT_LOOKUP_FAILED', details: exErr.message }, { status: 500 }),
      )
    }

    const already = new Set<string>((existing ?? []).map((r: any) => String(r.target_user_id)))
    const toSend = memberIds.filter((id) => !already.has(id))

    if (!toSend.length) {
      return noStore(NextResponse.json({ ok: true, sent: 0, skipped: memberIds.length }, { status: 200 }))
    }

    const defaultTitle = template === 'offer' ? 'Special offer from ATOM' : 'We miss you at ATOM'
    const defaultBody =
      template === 'offer'
        ? 'Hi! We noticed you haven’t trained in a while. We’d love to see you back at ATOM. Please contact reception today for a special offer.'
        : 'Hi! We noticed you haven’t trained recently. We miss you at ATOM — come train this week!'

    const notifBase = {
      kind: 'info',
      title: (title ?? '').trim() || defaultTitle,
      body: (text ?? '').trim() || defaultBody,
      created_by: sess.actorId,
    }

    // Try inserting with created_by; fallback without created_by if FK fails
    const payload1 = toSend.map((id) => ({ ...notifBase, user_id: id, member_id: id }))
    const ins1 = await admin.from('notifications').insert(payload1 as any)

    if (ins1.error) {
      const payload2 = toSend.map((id) => ({
        ...notifBase,
        user_id: id,
        member_id: id,
        created_by: null,
      }))
      const ins2 = await admin.from('notifications').insert(payload2 as any)
      if (ins2.error) {
        return noStore(
          NextResponse.json({ ok: false, error: 'NOTIFY_FAILED', details: ins2.error.message }, { status: 500 }),
        )
      }
    }

    // Audit logs (best-effort)
    try {
      const auditRows = toSend.map((id) => ({
        actor_user_id: sess.actorId,
        target_user_id: id,
        action: 'attendance_inactive_notify',
        action_details: {
          sent_on: today,
          template,
        },
      }))
      await admin.from('audit_logs').insert(auditRows as any)
    } catch {}

    return noStore(
      NextResponse.json({ ok: true, sent: toSend.length, skipped: memberIds.length - toSend.length }, { status: 200 }),
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'UNEXPECTED', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
