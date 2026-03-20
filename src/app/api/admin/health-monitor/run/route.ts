export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { collectHealthMonitorSummary, sendHealthMonitorEmail } from '@/lib/healthMonitor'
import { canAccessHealthMonitor, normalizeRole } from '@/lib/rbac'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
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
  const role = normalizeRole(me?.role)
  if (!canAccessHealthMonitor(role)) {
    return { ok: false as const, status: 403, error: 'FORBIDDEN' }
  }

  return { ok: true as const, actorId, role }
}

export async function GET(req: Request) {
  try {
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
    const sendEmail = cronOk ? true : (url.searchParams.get('send_email') ?? '').trim() === '1'
    const persist = (url.searchParams.get('persist') ?? '1').trim() !== '0'

    const admin = createSupabaseAdminClient()
    const summary = await collectHealthMonitorSummary(admin)

    let emailSent = false
    let emailError: string | null = null
    let emailRecipients: string[] = []

    if (sendEmail) {
      const result = await sendHealthMonitorEmail(summary)
      emailSent = !!result.sent
      emailError = result.error ?? null
      emailRecipients = result.recipients ?? []
    }

    let reportId: string | null = null
    let persistError: string | null = null

    if (persist) {
      const { data, error } = await admin
        .from('system_health_reports')
        .insert({
          actor_user_id: actorId,
          mode: cronOk ? 'cron' : 'manual',
          overall_status: summary.overall_status,
          email_sent: emailSent,
          email_error: emailError,
          email_recipients: emailRecipients,
          summary,
        })
        .select('id')
        .maybeSingle<{ id: string }>()

      if (error) persistError = error.message
      else reportId = data?.id ?? null
    }

    return noStore(
      NextResponse.json({
        ok: true,
        mode: cronOk ? 'cron' : 'manual',
        actor_role: actorRole,
        send_email: sendEmail,
        email_sent: emailSent,
        email_error: emailError,
        email_recipients: emailRecipients,
        persisted: persist,
        persist_error: persistError,
        report_id: reportId,
        summary,
      }),
    )
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }),
    )
  }
}
