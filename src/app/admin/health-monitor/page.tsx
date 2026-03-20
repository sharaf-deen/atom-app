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
import { collectHealthMonitorSummary, getHealthMonitorRecipients, type HealthMonitorStoredReport } from '@/lib/healthMonitor'

type SearchParams = {
  report?: string | string[]
}

function getStatusMeta(status: string) {
  if (status === 'healthy') {
    return {
      label: 'Healthy · Looks normal',
      short: 'Healthy',
      description: 'No important issue detected in the main checks.',
      className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    }
  }

  if (status === 'warning') {
    return {
      label: 'Warning · Needs attention',
      short: 'Warning',
      description: 'Something needs attention, but there is no major structural issue yet.',
      className: 'bg-amber-100 text-amber-800 border-amber-200',
    }
  }

  return {
    label: 'Critical · Urgent review',
    short: 'Critical',
    description: 'A serious data consistency or account integrity issue was detected.',
    className: 'bg-red-100 text-red-800 border-red-200',
  }
}

function getEmailMeta(emailSent: boolean, emailError: string | null) {
  if (emailSent) {
    return {
      label: 'Email sent',
      className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    }
  }

  if (emailError) {
    return {
      label: 'Email failed',
      className: 'bg-red-100 text-red-800 border-red-200',
    }
  }

  return {
    label: 'Email skipped',
    className: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  }
}

function getWarningAction(item: string) {
  const text = item.toLowerCase()

  if (text.includes('orphan profile')) {
    return {
      title: 'Review profile integrity',
      description: 'One or more profiles exist without a matching auth user. Review the affected accounts and clean them up.',
      href: '/admin/members',
      label: 'Open Members',
    }
  }

  if (text.includes('invalid role')) {
    return {
      title: 'Review invalid roles',
      description: 'Some profiles have a role that is missing or invalid. Check the affected accounts and fix their role.',
      href: '/admin/members',
      label: 'Open Members',
    }
  }

  if (text.includes('no scans')) {
    return {
      title: 'Check attendance flow',
      description: 'No scans were recorded after midday Cairo time. Confirm kiosk usage, staff process, and scan flow.',
      href: '/admin/scan-audit',
      label: 'Open Scan Audit',
    }
  }

  if (text.includes('invite resend failure')) {
    return {
      title: 'Review invite resend failures',
      description: 'Recent invite resend attempts failed. Check mail settings, audit logs, and retry from the member profile if needed.',
      href: '/admin/members',
      label: 'Open Members',
    }
  }

  return {
    title: 'Review this warning',
    description: 'Open the relevant admin area and review the related records.',
    href: '/admin',
    label: 'Open Admin',
  }
}

function formatCairoDateTime(value: string) {
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })
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

function WarningList({
  warnings,
  useActions = false,
}: {
  warnings: string[]
  useActions?: boolean
}) {
  if (warnings.length === 0) {
    return <p className="mt-3 text-sm text-[hsl(var(--muted))]">No active warnings.</p>
  }

  if (!useActions) {
    return (
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
        {warnings.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      {warnings.map((item) => {
        const action = getWarningAction(item)
        return (
          <div key={item} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
            <div className="text-sm font-semibold">{item}</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">{action.title}</div>
            <p className="mt-2 text-sm text-[hsl(var(--muted))]">{action.description}</p>
            <div className="mt-3">
              <Button asChild variant="outline" size="sm" href={action.href}>
                {action.label}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HighlightsList({ highlights }: { highlights: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
      {highlights.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function StoredReportDetails({ report }: { report: HealthMonitorStoredReport | null }) {
  if (!report) {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-[hsl(var(--muted))]">
            No stored report yet. Run the monitor once or wait for the daily cron to generate one.
          </div>
        </CardContent>
      </Card>
    )
  }

  const status = getStatusMeta(report.overall_status)
  const email = getEmailMeta(report.email_sent, report.email_error)
  const warningCount = Array.isArray(report.summary?.warnings) ? report.summary.warnings.length : 0
  const highlightCount = Array.isArray(report.summary?.highlights) ? report.summary.highlights.length : 0

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[hsl(var(--muted))]">Stored report details</div>
            <div className="mt-1 text-lg font-semibold">
              {formatCairoDateTime(report.created_at)} · {report.mode}
            </div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Open a stored report to inspect the full warnings and highlights without running a new check.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${status.className}`}>
              {status.label}
            </span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${email.className}`}>
              {email.label}
            </span>
            <Button asChild variant="outline" size="sm" href="/admin/health-monitor">
              View latest
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <div className="text-sm font-medium">What this means</div>
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">{status.description}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
            <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Warnings: {warningCount}</span>
            <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Highlights: {highlightCount}</span>
            <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">
              Generated for {report.summary?.generated_date_cairo ?? '—'}
            </span>
          </div>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Scans today" value={report.summary?.counts?.scans_today ?? 0} hint={`Yesterday: ${report.summary?.counts?.scans_yesterday ?? 0}`} />
          <StatCard label="Active members" value={report.summary?.counts?.active_members ?? 0} hint={`Expiring in 7 days: ${report.summary?.counts?.expiring_7d ?? 0}`} />
          <StatCard
            label="Outstanding total"
            value={`${Number(report.summary?.counts?.outstanding_total_egp ?? 0).toFixed(0)} EGP`}
            hint={`${report.summary?.counts?.outstanding_members ?? 0} member(s)`}
          />
          <StatCard
            label="Members created 24h"
            value={report.summary?.counts?.members_created_24h ?? 0}
            hint={`Invite resends 24h: ${report.summary?.counts?.invite_resends_24h ?? 0}`}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent>
              <h3 className="text-base font-semibold">Warnings from this report</h3>
              <WarningList warnings={Array.isArray(report.summary?.warnings) ? report.summary.warnings : []} useActions />
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="text-base font-semibold">Highlights from this report</h3>
              <HighlightsList highlights={Array.isArray(report.summary?.highlights) ? report.summary.highlights : []} />
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>Orphan profiles: <strong>{report.summary?.counts?.orphan_profiles ?? 0}</strong></div>
                <div>Invalid role profiles: <strong>{report.summary?.counts?.invalid_role_profiles ?? 0}</strong></div>
                <div>Invite resend failures 24h: <strong>{report.summary?.counts?.invite_resend_failures_24h ?? 0}</strong></div>
                <div>Delete actions 24h: <strong>{report.summary?.counts?.delete_actions_24h ?? 0}</strong></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
          <div className="text-sm font-medium">Email recipients</div>
          <div className="mt-2 text-sm text-[hsl(var(--muted))] break-words">
            {Array.isArray(report.email_recipients) && report.email_recipients.length > 0 ? report.email_recipients.join(', ') : 'No recipients stored for this run.'}
          </div>
          {report.email_error ? <div className="mt-2 text-sm text-red-700">{report.email_error}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function HealthMonitorPage({ searchParams }: { searchParams?: SearchParams }) {
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

  let reports: HealthMonitorStoredReport[] = []
  let reportsError: string | null = null

  const { data: rawReports, error } = await admin
    .from('system_health_reports')
    .select('id, created_at, mode, overall_status, email_sent, email_error, email_recipients, summary')
    .order('created_at', { ascending: false })
    .limit(12)

  if (error) reportsError = error.message
  else reports = ((rawReports ?? []) as any[]) as HealthMonitorStoredReport[]

  const requestedReportId = typeof searchParams?.report === 'string'
    ? searchParams.report
    : Array.isArray(searchParams?.report)
      ? searchParams?.report[0]
      : ''

  const selectedReport = reports.find((row) => row.id === requestedReportId) ?? reports[0] ?? null
  const liveStatus = getStatusMeta(summary.overall_status)

  return (
    <main>
      <PageHeader
        title="Health Monitor"
        subtitle="Daily app health snapshot, stored reports, and actionable admin follow-up."
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
        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[hsl(var(--muted))]">Current live status</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${liveStatus.className}`}>
                    {liveStatus.label}
                  </span>
                  <span className="text-sm text-[hsl(var(--muted))]">
                    {summary.generated_date_cairo} · {summary.time_zone}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[hsl(var(--muted))]">{liveStatus.description}</p>
              </div>
              <div className="text-sm text-[hsl(var(--muted))] xl:text-right">
                Email recipients: {recipients.length > 0 ? recipients.join(', ') : 'not configured'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="text-sm font-medium">Status guide</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(['healthy', 'warning', 'critical'] as const).map((status) => {
                  const meta = getStatusMeta(status)
                  return (
                    <span key={status} className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${meta.className}`}>
                      {meta.label}
                    </span>
                  )
                })}
              </div>
              <p className="mt-3 text-sm text-[hsl(var(--muted))]">
                Status reflects system health. Email only shows whether the report email was delivered for that run.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Scans today" value={summary.counts.scans_today} hint={`Yesterday: ${summary.counts.scans_yesterday}`} />
          <StatCard label="Active members" value={summary.counts.active_members} hint={`Expiring in 7 days: ${summary.counts.expiring_7d}`} />
          <StatCard label="Outstanding total" value={`${summary.counts.outstanding_total_egp.toFixed(0)} EGP`} hint={`${summary.counts.outstanding_members} member(s)`} />
          <StatCard label="Members created 24h" value={summary.counts.members_created_24h} hint={`Invite resends 24h: ${summary.counts.invite_resends_24h}`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold">Live warnings</h2>
              <WarningList warnings={summary.warnings} useActions />
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold">Live highlights</h2>
              <HighlightsList highlights={summary.highlights} />
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Stored report details</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Review a recent run in detail without launching a new one.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedReport ? (
              <Button asChild variant="outline" size="sm" href={`/admin/health-monitor?report=${selectedReport.id}`}>
                Refresh selected
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm" href="/admin/scan-audit">
              Open Scan Audit
            </Button>
          </div>
        </div>

        <StoredReportDetails report={selectedReport} />
      </Section>

      <Section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recent reports</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Status = system health. Email = delivery result for that report only.
            </p>
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
          <>
            <div className="grid gap-3 md:hidden">
              {reports.map((row) => {
                const status = getStatusMeta(row.overall_status)
                const email = getEmailMeta(row.email_sent, row.email_error)
                const isSelected = selectedReport?.id === row.id
                return (
                  <Card key={row.id}>
                    <CardContent className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{formatCairoDateTime(row.created_at)}</div>
                          <div className="text-xs text-[hsl(var(--muted))]">{row.mode}</div>
                        </div>
                        {isSelected ? (
                          <span className="inline-flex rounded-full border border-black/10 bg-black/5 px-2 py-1 text-[11px] font-semibold">
                            Opened
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${status.className}`}>
                          {status.short}
                        </span>
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${email.className}`}>
                          {email.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Warnings</div>
                          <div className="mt-1 font-semibold">{Array.isArray(row.summary?.warnings) ? row.summary.warnings.length : 0}</div>
                        </div>
                        <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Scans today</div>
                          <div className="mt-1 font-semibold">{row.summary?.counts?.scans_today ?? 0}</div>
                        </div>
                      </div>

                      <Button asChild variant={isSelected ? 'solid' : 'outline'} size="sm" href={`/admin/health-monitor?report=${row.id}`}>
                        {isSelected ? 'Opened' : 'Open details'}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            <Card className="hidden md:block">
              <CardContent className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="border-b border-[hsl(var(--border))]">
                      <th className="px-2 py-3 font-semibold">Created at</th>
                      <th className="px-2 py-3 font-semibold">Mode</th>
                      <th className="px-2 py-3 font-semibold">Status</th>
                      <th className="px-2 py-3 font-semibold">Warnings</th>
                      <th className="px-2 py-3 font-semibold">Highlights</th>
                      <th className="px-2 py-3 font-semibold">Scans today</th>
                      <th className="px-2 py-3 font-semibold">Email</th>
                      <th className="px-2 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((row) => {
                      const status = getStatusMeta(row.overall_status)
                      const email = getEmailMeta(row.email_sent, row.email_error)
                      const isSelected = selectedReport?.id === row.id
                      return (
                        <tr key={row.id} className={`border-b border-[hsl(var(--border))] last:border-0 ${isSelected ? 'bg-black/[0.03]' : ''}`}>
                          <td className="px-2 py-3 align-top whitespace-nowrap">{formatCairoDateTime(row.created_at)}</td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">{row.mode}</td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${status.className}`}>
                              {status.short}
                            </span>
                          </td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">{Array.isArray(row.summary?.warnings) ? row.summary.warnings.length : 0}</td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">{Array.isArray(row.summary?.highlights) ? row.summary.highlights.length : 0}</td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">{row.summary?.counts?.scans_today ?? 0}</td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${email.className}`}>
                              {email.label}
                            </span>
                          </td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">
                            <Button asChild variant={isSelected ? 'solid' : 'outline'} size="sm" href={`/admin/health-monitor?report=${row.id}`}>
                              {isSelected ? 'Opened' : 'Open details'}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </Section>
    </main>
  )
}
