export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { collectHealthMonitorSummary, sendHealthMonitorEmail } from '@/lib/healthMonitor'
import { canAccessHealthMonitor, normalizeRole } from '@/lib/rbac'
import { jsonWithApiRuntime, logApiError, logApiWarn, startApiRuntime } from '@/lib/apiRuntime'

function getCairoClock(value: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)

  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const hour = Number(pick('hour'))

  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
  }
}

function isSameCairoDate(isoTimestamp: string, dateKey: string) {
  const value = new Date(isoTimestamp)
  if (Number.isNaN(value.getTime())) return false
  return getCairoClock(value).dateKey === dateKey
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
  const meta = startApiRuntime('/api/admin/health-monitor/run')

  try {
    const authHeader = req.headers.get('authorization') ?? ''
    const cronSecret = process.env.CRON_SECRET
    const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`

    let actorId: string | null = null
    let actorRole: string | null = null

    if (!cronOk) {
      const sess = await getActorFromSession()
      if (!sess.ok) {
        return jsonWithApiRuntime(meta, sess.status, {
          ok: false,
          error: sess.error,
          ...(('details' in sess) && sess.details ? { details: sess.details } : {}),
        })
      }
      actorId = sess.actorId
      actorRole = sess.role
    }

    const url = new URL(req.url)
    const persist = (url.searchParams.get('persist') ?? '1').trim() !== '0'
    const admin = createSupabaseAdminClient()

    // Vercel cron schedules are UTC. We intentionally keep both 19:00 and 20:00 UTC
    // triggers in vercel.json so Egypt daylight-saving changes are covered. Only the
    // invocation that lands at 22:00 in Africa/Cairo is allowed to run/send.
    const cairoNow = getCairoClock()
    if (cronOk && cairoNow.hour !== 22) {
      return jsonWithApiRuntime(meta, 200, {
        ok: true,
        mode: 'cron',
        skipped: true,
        skip_reason: 'OUTSIDE_CAIRO_22H',
        cairo_date: cairoNow.dateKey,
        cairo_hour: cairoNow.hour,
      })
    }

    // Best-effort duplicate protection for retries/repeated scheduler invocations:
    // if today's Cairo report already sent an email, do not send it again.
    if (cronOk) {
      const { data: recentSentReports, error: recentSentErr } = await admin
        .from('system_health_reports')
        .select('created_at')
        .eq('mode', 'cron')
        .eq('email_sent', true)
        .order('created_at', { ascending: false })
        .limit(10)

      if (recentSentErr) {
        logApiWarn(meta, 'duplicate_guard_lookup', { error: recentSentErr.message })
      } else {
        const alreadySentToday = (recentSentReports ?? []).some((report: { created_at: string }) =>
          isSameCairoDate(report.created_at, cairoNow.dateKey),
        )

        if (alreadySentToday) {
          return jsonWithApiRuntime(meta, 200, {
            ok: true,
            mode: 'cron',
            skipped: true,
            skip_reason: 'ALREADY_SENT_TODAY',
            cairo_date: cairoNow.dateKey,
            cairo_hour: cairoNow.hour,
          })
        }
      }
    }

    const sendEmail = cronOk ? true : (url.searchParams.get('send_email') ?? '').trim() === '1'
    const summary = await collectHealthMonitorSummary(admin)

    let emailSent = false
    let emailError: string | null = null
    let emailRecipients: string[] = []

    if (sendEmail) {
      const result = await sendHealthMonitorEmail(summary)
      emailSent = !!result.sent
      emailError = result.error ?? null
      emailRecipients = result.recipients ?? []
      if (emailError) {
        logApiWarn(meta, 'send_email', {
          email_error: emailError,
          recipient_count: emailRecipients.length,
        })
      }
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

      if (error) {
        persistError = error.message
        logApiError(meta, 'persist_report', error, { mode: cronOk ? 'cron' : 'manual' })
      } else {
        reportId = data?.id ?? null
      }
    }

    return jsonWithApiRuntime(meta, 200, {
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
    })
  } catch (e: any) {
    logApiError(meta, 'unexpected', e)
    return jsonWithApiRuntime(meta, 500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: e?.message ?? String(e),
    })
  }
}
