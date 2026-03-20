export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import Forbidden from '@/components/Forbidden'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import RunHealthMonitorButton from '@/components/RunHealthMonitorButton'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  collectHealthMonitorSummary,
  getHealthMonitorRecipients,
  type HealthMonitorStoredReport,
  type HealthMonitorSummary,
} from '@/lib/healthMonitor'

type StatusKey = 'healthy' | 'warning' | 'critical'

type StatusMeta = {
  label: string
  tone: string
  description: string
  badgeClass: string
  accentClass: string
}

type WarningAction = {
  title: string
  details: string
  href: string
  cta: string
}

const STATUS_GUIDE: Array<{ status: StatusKey; example: string }> = [
  { status: 'healthy', example: 'Normal activity, no orphan profiles, no invalid roles.' },
  { status: 'warning', example: 'No scans after midday, or recent invite resend failures.' },
  { status: 'critical', example: 'Orphan profiles or invalid role profiles detected.' },
]

function statusMeta(status: string): StatusMeta {
  if (status === 'healthy') {
    return {
      label: 'Healthy',
      tone: 'Looks normal',
      description: 'No important issue detected. Core checks currently look normal.',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      accentClass: 'text-emerald-700',
    }
  }

  if (status === 'warning') {
    return {
      label: 'Warning',
      tone: 'Needs attention',
      description: 'Something needs attention, but there is no major structural issue yet.',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      accentClass: 'text-amber-700',
    }
  }

  return {
    label: 'Critical',
    tone: 'Urgent review',
    description: 'A serious data consistency or account integrity issue was detected.',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    accentClass: 'text-red-700',
  }
}

function emailBadgeClass(state: 'sent' | 'failed' | 'skipped') {
  if (state === 'sent') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (state === 'failed') return 'bg-red-100 text-red-800 border-red-200'
  return 'bg-zinc-100 text-zinc-700 border-zinc-200'
}

function getEmailState(row: HealthMonitorStoredReport): 'sent' | 'failed' | 'skipped' {
  if (row.email_sent) return 'sent'
  if (row.email_error) return 'failed'
  return 'skipped'
}

function getWarningAction(item: string): WarningAction {
  const text = item.toLowerCase()

  if (text.includes('no scans recorded today')) {
    return {
      title: 'Check scan activity',
      details: 'Confirm the kiosk or tablet is working and verify whether scans were recorded on the correct device today.',
      href: '/admin/scan-audit',
      cta: 'Open Scan Audit',
    }
  }

  if (text.includes('orphan profile')) {
    return {
      title: 'Review orphan profiles',
      details: 'Compare recent members against auth users and delete or repair any profile that no longer has a valid account.',
      href: '/admin/members',
      cta: 'Open Members',
    }
  }

  if (text.includes('invalid role')) {
    return {
      title: 'Review profile roles',
      details: 'Check role consistency on affected profiles and correct any account using an invalid or missing role.',
      href: '/admin/members',
      cta: 'Open Members',
    }
  }

  if (text.includes('invite resend failure')) {
    return {
      title: 'Review invite resend failures',
      details: 'Check recent member invite attempts, email delivery settings, and retry only after confirming the email path is healthy.',
      href: '/admin/members',
      cta: 'Open Members',
    }
  }

  return {
    title: 'Review this warning',
    details: 'Open the related admin area and confirm whether this issue needs manual action.',
    href: '/admin',
    cta: 'Open Admin',
  }
}

function getWarningSeverity(item: string) {
  return /orphan|invalid role/i.test(item) ? 'critical' : 'warning'
}

function countCriticalWarnings(summary: HealthMonitorSummary) {
  return summary.warnings.filter((item) => getWarningSeverity(item) === 'critical').length
}

function statusSummaryLine(summary: HealthMonitorSummary) {
  const totalWarnings = summary.warnings.length
  const criticalWarnings = countCriticalWarnings(summary)

  if (summary.overall_status === 'healthy') {
    return 'No active warnings. Daily checks currently look normal.'
  }

  if (summary.overall_status === 'critical') {
    return `${criticalWarnings} critical warning(s) detected. Review account and profile consistency as soon as possible.`
  }

  return `${totalWarnings} active warning(s) detected. Review the items below before the end of the day.`
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

function StatusGuideCard({ status, example }: { status: StatusKey; example: string }) {
  const meta = statusMeta(status)
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${meta.badgeClass}`}>
            {meta.label.toUpperCase()}
          </span>
          <span className={`text-sm font-medium ${meta.accentClass}`}>{meta.tone}</span>
        </div>
        <p className="text-sm leading-6">{meta.description}</p>
        <p className="text-xs text-[hsl(var(--muted))]">Example: {example}</p>
      </CardContent>
    </Card>
  )
}

export default async function HealthMonitorPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/health-monitor')

  const allowed = me.role === 'admin' || me.role === 'super_admin'
  if (!allowed) {
    return (
      <Forbidden
        pageTitle="Health Monitor"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can access the health monitor."
        allowed="admin, super_admin"
        nextPath="/admin/health-monitor"
        actions={[{ href: '/admin', label: 'Admin Dashboard' }, { href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()
  const summary = await collectHealthMonitorSummary(admin)
  const recipients = getHealthMonitorRecipients()
  const currentMeta = statusMeta(summary.overall_status)

  let reports: HealthMonitorStoredReport[] = []
  let reportsError: string | null = null

  const { data: rawReports, error } = await admin
    .from('system_health_reports')
    .select('id, created_at, mode, overall_status, email_sent, email_error, email_recipients, summary')
    .order('created_at', { ascending: false })
    .limit(12)

  if (error) reportsError = error.message
  else reports = ((rawReports ?? []) as any[]) as HealthMonitorStoredReport[]

  return (
    <main>
      <PageHeader
        title="Health Monitor"
        subtitle="Daily app health snapshot and automated report status."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <RunHealthMonitorButton />
            <RunHealthMonitorButton sendEmail />
            <Button asChild variant="outline" href="/admin">
              Back to Admin
            </Button>
          </div>
        }
      />

      <Section className="space-y-4">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="text-sm text-[hsl(var(--muted))]">Current status</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${currentMeta.badgeClass}`}>
                    {currentMeta.label.toUpperCase()}
                  </span>
                  <span className={`text-sm font-medium ${currentMeta.accentClass}`}>{currentMeta.tone}</span>
                  <span className="text-sm text-[hsl(var(--muted))]">{summary.generated_date_cairo} · {summary.time_zone}</span>
                </div>
                <p className="max-w-2xl text-sm leading-6">{currentMeta.description}</p>
                <p className="text-sm text-[hsl(var(--muted))]">{statusSummaryLine(summary)}</p>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm">
                <div className="font-medium">Email recipients</div>
                <div className="mt-2 max-w-[420px] break-words text-[hsl(var(--muted))]">
                  {recipients.length > 0 ? recipients.join(', ') : 'Not configured'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Scans today" value={summary.counts.scans_today} hint={`Yesterday: ${summary.counts.scans_yesterday}`} />
          <StatCard label="Active members" value={summary.counts.active_members} hint={`Expiring in 7 days: ${summary.counts.expiring_7d}`} />
          <StatCard label="Outstanding total" value={`${summary.counts.outstanding_total_egp.toFixed(0)} EGP`} hint={`${summary.counts.outstanding_members} member(s)`} />
          <StatCard label="Members created 24h" value={summary.counts.members_created_24h} hint={`Invite resends 24h: ${summary.counts.invite_resends_24h}`} />
        </div>
      </Section>

      <Section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Status guide</h2>
          <div className="text-sm text-[hsl(var(--muted))]">Use this legend to understand what the badge means.</div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {STATUS_GUIDE.map((item) => (
            <StatusGuideCard key={item.status} status={item.status} example={item.example} />
          ))}
        </div>
      </Section>

      <Section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Warnings</h2>
                <div className="text-sm text-[hsl(var(--muted))]">Actionable next steps</div>
              </div>

              {summary.warnings.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {summary.warnings.map((item) => {
                    const action = getWarningAction(item)
                    const severity = getWarningSeverity(item)
                    const meta = statusMeta(severity)

                    return (
                      <div key={item} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.badgeClass}`}>
                                {meta.label.toUpperCase()}
                              </span>
                              <span className="text-sm font-medium">{action.title}</span>
                            </div>
                            <p className="text-sm leading-6">{item}</p>
                            <p className="text-xs leading-5 text-[hsl(var(--muted))]">Recommended action: {action.details}</p>
                          </div>
                          <Button asChild variant="outline" size="sm" href={action.href}>
                            {action.cta}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  No active warnings. Continue daily checks and run the monitor again if you want to store a fresh report.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Highlights</h2>
                <Link href="/admin/scan-audit" className="text-sm underline text-[hsl(var(--muted))]">Scan Audit</Link>
              </div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                {summary.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>Orphan profiles: <strong>{summary.counts.orphan_profiles}</strong></div>
                <div>Invalid role profiles: <strong>{summary.counts.invalid_role_profiles}</strong></div>
                <div>Invite resend failures 24h: <strong>{summary.counts.invite_resend_failures_24h}</strong></div>
                <div>Delete actions 24h: <strong>{summary.counts.delete_actions_24h}</strong></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent reports</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Status = health result. Email = report delivery result.</p>
          </div>
          <Link href="/admin/scan-audit" className="text-sm underline text-[hsl(var(--muted))]">Scan Audit</Link>
        </div>

        {reportsError ? (
          <Card>
            <CardContent>
              <div className="text-sm text-amber-700">Recent reports unavailable: {reportsError}</div>
            </CardContent>
          </Card>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">No stored health reports yet. Run the monitor once or wait for the daily cron.</div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto">
              <table className="min-w-[920px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Created at</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Mode</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Status</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Warnings</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Scans today</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Orphans</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Email</th>
                    <th className="sticky top-0 z-10 bg-[hsl(var(--card))] px-2 py-3 font-semibold">Recipients</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((row) => {
                    const meta = statusMeta(row.overall_status)
                    const emailState = getEmailState(row)
                    const warningCount = Array.isArray(row.summary?.warnings) ? row.summary.warnings.length : 0

                    return (
                      <tr key={row.id} className="border-b border-[hsl(var(--border))] last:border-0">
                        <td className="px-2 py-3 align-top whitespace-nowrap">{new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}</td>
                        <td className="px-2 py-3 align-top whitespace-nowrap">{row.mode}</td>
                        <td className="px-2 py-3 align-top whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}>
                              {meta.label.toUpperCase()}
                            </span>
                            <span className="text-xs text-[hsl(var(--muted))]">{meta.tone}</span>
                          </div>
                        </td>
                        <td className="px-2 py-3 align-top whitespace-nowrap">{warningCount}</td>
                        <td className="px-2 py-3 align-top whitespace-nowrap">{row.summary?.counts?.scans_today ?? 0}</td>
                        <td className="px-2 py-3 align-top whitespace-nowrap">{row.summary?.counts?.orphan_profiles ?? 0}</td>
                        <td className="px-2 py-3 align-top whitespace-nowrap">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${emailBadgeClass(emailState)}`}>
                            {emailState.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-2 py-3 align-top">
                          <div className="max-w-[260px] break-words text-xs text-[hsl(var(--muted))]">
                            {Array.isArray(row.email_recipients) && row.email_recipients.length > 0 ? row.email_recipients.join(', ') : '—'}
                            {row.email_error ? <div className="mt-1 text-red-700">{row.email_error}</div> : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </Section>
    </main>
  )
}
