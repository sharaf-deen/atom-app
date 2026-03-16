import 'server-only'

import { addDays, CAIRO_TZ, cairoToday } from '@/lib/cairoDate'
import { getAppUrl } from '@/lib/appUrl'

type HealthStatus = 'healthy' | 'warning' | 'critical'

type AuditLike = {
  action_details?: any
  action?: string | null
}

export type HealthMonitorSummary = {
  generated_at_iso: string
  generated_date_cairo: string
  time_zone: string
  overall_status: HealthStatus
  counts: {
    scans_today: number
    scans_yesterday: number
    active_members: number
    expiring_7d: number
    outstanding_members: number
    outstanding_total_egp: number
    members_created_24h: number
    orphan_profiles: number
    invalid_role_profiles: number
    invite_resends_24h: number
    invite_resend_failures_24h: number
    delete_actions_24h: number
  }
  highlights: string[]
  warnings: string[]
}

export type HealthMonitorStoredReport = {
  id: string
  created_at: string
  mode: string
  overall_status: HealthStatus
  email_sent: boolean
  email_error: string | null
  email_recipients: string[] | null
  summary: HealthMonitorSummary
}

function getCairoHourNow() {
  const raw = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  return Number.parseInt(raw, 10) || 0
}

function parseRecipients(raw: string | undefined) {
  return String(raw ?? '')
    .split(/[\n,;]/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function getHealthMonitorRecipients() {
  return parseRecipients(process.env.HEALTH_MONITOR_TO)
}

function mailFrom() {
  return process.env.MAIL_FROM || 'noreply@example.com'
}

async function listAllAuthUserIds(admin: any) {
  const ids = new Set<string>()
  const perPage = 1000
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`AUTH_LIST_USERS_FAILED: ${error.message}`)

    const users = Array.isArray(data?.users) ? data.users : []
    for (const user of users) {
      const id = String(user?.id ?? '').trim()
      if (id) ids.add(id)
    }

    if (users.length < perPage) break
    page += 1
    if (page > 100) break
  }

  return ids
}

function extractOutcome(row: AuditLike) {
  const details = row?.action_details ?? {}
  return String(details?.outcome ?? '').trim().toLowerCase()
}

function buildWarnings(summary: Omit<HealthMonitorSummary, 'warnings' | 'highlights' | 'overall_status'>) {
  const warnings: string[] = []
  const cairoHour = getCairoHourNow()

  if (summary.counts.orphan_profiles > 0) {
    warnings.push(`${summary.counts.orphan_profiles} orphan profile(s) found.`)
  }

  if (summary.counts.invalid_role_profiles > 0) {
    warnings.push(`${summary.counts.invalid_role_profiles} profile(s) have an invalid role.`)
  }

  if (cairoHour >= 12 && summary.counts.scans_today === 0) {
    warnings.push('No scans recorded today after midday Cairo time.')
  }

  if (summary.counts.invite_resend_failures_24h > 0) {
    warnings.push(`${summary.counts.invite_resend_failures_24h} invite resend failure(s) in the last 24h.`)
  }

  return warnings
}

function buildHighlights(summary: Omit<HealthMonitorSummary, 'warnings' | 'highlights' | 'overall_status'>) {
  return [
    `${summary.counts.active_members} active member(s)`,
    `${summary.counts.scans_today} scan(s) today / ${summary.counts.scans_yesterday} yesterday`,
    `${summary.counts.outstanding_members} member(s) with ${summary.counts.outstanding_total_egp.toFixed(0)} EGP outstanding`,
    `${summary.counts.members_created_24h} member profile(s) created in the last 24h`,
  ]
}

function deriveOverallStatus(warnings: string[]): HealthStatus {
  if (warnings.some((w) => /orphan|invalid role/i.test(w))) return 'critical'
  if (warnings.length > 0) return 'warning'
  return 'healthy'
}

export async function collectHealthMonitorSummary(admin: any): Promise<HealthMonitorSummary> {
  const today = cairoToday()
  const yesterday = addDays(today, -1)
  const next7 = addDays(today, 7)
  const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    activeMembersRes,
    expiring7Res,
    scansTodayRes,
    scansYesterdayRes,
    membersCreated24hRes,
    outstandingRes,
    rolesRes,
    profilesRes,
    resendAuditRes,
    deleteAuditRes,
  ] = await Promise.all([
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('end_date', today)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', next7)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    admin.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
    admin.from('attendance').select('id', { count: 'exact', head: true }).eq('date', yesterday),
    admin.from('profiles').select('user_id', { count: 'exact', head: true }).gte('created_at', since24hIso),
    admin.from('subscriptions').select('member_id, amount_due').gt('amount_due', 0).limit(10000),
    admin.from('roles').select('id'),
    admin.from('profiles').select('user_id, email, role, created_at').limit(10000),
    admin
      .from('audit_logs')
      .select('action_details')
      .eq('action', 'member_invite_resend')
      .gte('created_at', since24hIso)
      .limit(5000),
    admin
      .from('audit_logs')
      .select('action')
      .in('action', ['delete_user', 'delete_orphan_profile'])
      .gte('created_at', since24hIso)
      .limit(5000),
  ])

  const maybeError = [
    activeMembersRes.error,
    expiring7Res.error,
    scansTodayRes.error,
    scansYesterdayRes.error,
    membersCreated24hRes.error,
    outstandingRes.error,
    rolesRes.error,
    profilesRes.error,
    resendAuditRes.error,
    deleteAuditRes.error,
  ].find(Boolean)

  if (maybeError) {
    throw new Error(maybeError.message)
  }

  const authIds = await listAllAuthUserIds(admin)
  const profiles = Array.isArray(profilesRes.data) ? profilesRes.data : []
  const roleIds = new Set((rolesRes.data ?? []).map((r: any) => String(r?.id ?? '').trim()).filter(Boolean))

  const orphanProfiles = profiles.filter((p: any) => {
    const id = String(p?.user_id ?? '').trim()
    return id && !authIds.has(id)
  })

  const invalidRoleProfiles = profiles.filter((p: any) => {
    const role = String(p?.role ?? '').trim()
    return !role || !roleIds.has(role)
  })

  const outstandingRows = Array.isArray(outstandingRes.data) ? outstandingRes.data : []
  const outstandingMembers = new Set<string>()
  let outstandingTotal = 0
  for (const row of outstandingRows as any[]) {
    const memberId = String(row?.member_id ?? '').trim()
    if (memberId) outstandingMembers.add(memberId)
    const due = Number(row?.amount_due ?? 0)
    if (Number.isFinite(due)) outstandingTotal += due
  }

  const resendRows = Array.isArray(resendAuditRes.data) ? resendAuditRes.data : []
  const resendFailures = resendRows.filter((row: any) => extractOutcome(row) && extractOutcome(row) !== 'ok').length

  const base = {
    generated_at_iso: new Date().toISOString(),
    generated_date_cairo: today,
    time_zone: CAIRO_TZ,
    counts: {
      scans_today: scansTodayRes.count ?? 0,
      scans_yesterday: scansYesterdayRes.count ?? 0,
      active_members: activeMembersRes.count ?? 0,
      expiring_7d: expiring7Res.count ?? 0,
      outstanding_members: outstandingMembers.size,
      outstanding_total_egp: Number(outstandingTotal.toFixed(2)),
      members_created_24h: membersCreated24hRes.count ?? 0,
      orphan_profiles: orphanProfiles.length,
      invalid_role_profiles: invalidRoleProfiles.length,
      invite_resends_24h: resendRows.length,
      invite_resend_failures_24h: resendFailures,
      delete_actions_24h: Array.isArray(deleteAuditRes.data) ? deleteAuditRes.data.length : 0,
    },
  }

  const warnings = buildWarnings(base)
  const highlights = buildHighlights(base)
  const overall_status = deriveOverallStatus(warnings)

  return {
    ...base,
    overall_status,
    highlights,
    warnings,
  }
}

function statusLabel(status: HealthStatus) {
  if (status === 'healthy') return 'Healthy'
  if (status === 'warning') return 'Warning'
  return 'Critical'
}

function statusColor(status: HealthStatus) {
  if (status === 'healthy') return '#166534'
  if (status === 'warning') return '#92400e'
  return '#991b1b'
}

function renderEmailHtml(summary: HealthMonitorSummary) {
  const statusText = statusLabel(summary.overall_status)
  const statusHex = statusColor(summary.overall_status)
  const appUrl = getAppUrl()
  const warningsHtml =
    summary.warnings.length > 0
      ? `<ul style="margin:8px 0 0 18px;padding:0;color:#111827;font-size:14px;line-height:1.6;">${summary.warnings
          .map((item) => `<li>${item}</li>`)
          .join('')}</ul>`
      : '<p style="margin:8px 0 0 0;font-size:14px;color:#111827;line-height:1.6;">No active warnings.</p>'

  const highlightsHtml = summary.highlights
    .map((item) => `<li>${item}</li>`)
    .join('')

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:#000000;text-align:center;">
                <a href="${appUrl}" target="_blank" style="text-decoration:none;display:inline-block;">
                  <img src="https://atomjiujitsuhq.com/wp-content/uploads/2025/11/LogoAtomNew180px.png" alt="Atom Jiu-Jitsu HQ" style="display:block;margin:0 auto;width:140px;max-width:60%;height:auto;" />
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 8px 24px;">
                <p style="margin:0 0 8px 0;font-size:13px;color:#71717a;">ATOM App Health Monitor · ${summary.generated_date_cairo} · ${summary.time_zone}</p>
                <h1 style="margin:0;font-size:22px;line-height:1.2;">Daily health report</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 16px 24px;">
                <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:${statusHex};color:#ffffff;font-size:12px;font-weight:700;">${statusText}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;border-spacing:0 8px;">
                  <tr>
                    <td style="padding:12px;border:1px solid #e4e4e7;border-radius:12px;font-size:13px;">Scans today<br/><strong style="font-size:20px;">${summary.counts.scans_today}</strong></td>
                    <td style="padding:12px;border:1px solid #e4e4e7;border-radius:12px;font-size:13px;">Orphan profiles<br/><strong style="font-size:20px;">${summary.counts.orphan_profiles}</strong></td>
                  </tr>
                  <tr>
                    <td style="padding:12px;border:1px solid #e4e4e7;border-radius:12px;font-size:13px;">Active members<br/><strong style="font-size:20px;">${summary.counts.active_members}</strong></td>
                    <td style="padding:12px;border:1px solid #e4e4e7;border-radius:12px;font-size:13px;">Outstanding total<br/><strong style="font-size:20px;">${summary.counts.outstanding_total_egp.toFixed(0)} EGP</strong></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 12px 24px;">
                <h2 style="margin:0;font-size:16px;">Highlights</h2>
                <ul style="margin:8px 0 0 18px;padding:0;color:#111827;font-size:14px;line-height:1.6;">${highlightsHtml}</ul>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 20px 24px;">
                <h2 style="margin:0;font-size:16px;">Warnings</h2>
                ${warningsHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px 24px;">
                <a href="${appUrl}/admin/health-monitor" style="display:inline-block;padding:12px 24px;background:#000000;color:#ffffff;text-decoration:none;border-radius:999px;font-size:14px;font-weight:600;">Open Health Monitor</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function renderEmailText(summary: HealthMonitorSummary) {
  return [
    `ATOM App Health Monitor - ${summary.generated_date_cairo} (${summary.time_zone})`,
    `Status: ${statusLabel(summary.overall_status)}`,
    '',
    `Scans today: ${summary.counts.scans_today}`,
    `Scans yesterday: ${summary.counts.scans_yesterday}`,
    `Active members: ${summary.counts.active_members}`,
    `Expiring in 7 days: ${summary.counts.expiring_7d}`,
    `Outstanding members: ${summary.counts.outstanding_members}`,
    `Outstanding total: ${summary.counts.outstanding_total_egp.toFixed(0)} EGP`,
    `Members created in last 24h: ${summary.counts.members_created_24h}`,
    `Orphan profiles: ${summary.counts.orphan_profiles}`,
    `Invalid role profiles: ${summary.counts.invalid_role_profiles}`,
    `Invite resends 24h: ${summary.counts.invite_resends_24h}`,
    `Invite resend failures 24h: ${summary.counts.invite_resend_failures_24h}`,
    `Delete actions 24h: ${summary.counts.delete_actions_24h}`,
    '',
    'Highlights:',
    ...summary.highlights.map((item) => `- ${item}`),
    '',
    'Warnings:',
    ...(summary.warnings.length > 0 ? summary.warnings.map((item) => `- ${item}`) : ['- No active warnings.']),
    '',
    `${getAppUrl()}/admin/health-monitor`,
  ].join('\n')
}

export async function sendHealthMonitorEmail(summary: HealthMonitorSummary) {
  const apiKey = process.env.RESEND_API_KEY
  const recipients = getHealthMonitorRecipients()

  if (!apiKey) {
    return { sent: false, error: 'RESEND_API_KEY_MISSING', recipients }
  }
  if (recipients.length === 0) {
    return { sent: false, error: 'HEALTH_MONITOR_TO_MISSING', recipients }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: recipients,
      subject: `[ATOM][${statusLabel(summary.overall_status)}] Health Monitor - ${summary.generated_date_cairo}`,
      html: renderEmailHtml(summary),
      text: renderEmailText(summary),
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { sent: false, error: `HTTP_${res.status}: ${text}`, recipients }
  }

  const data = await res.json().catch(() => ({} as any))
  return { sent: true, error: null as string | null, recipients, email_id: data?.id ?? null }
}
