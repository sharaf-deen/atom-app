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
  status?: string | string[]
}

type ReportFilterStatus = 'all' | 'healthy' | 'warning' | 'critical'

function getStatusMeta(status: string) {
  if (status === 'healthy') {
    return {
      label: 'Healthy · Looks normal',
      short: 'Healthy',
      description: 'No important issue detected in the main checks.',
      className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      reviewClassName: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      reviewLabel: 'Looks normal',
    }
  }

  if (status === 'warning') {
    return {
      label: 'Warning · Needs attention',
      short: 'Warning',
      description: 'Something needs attention, but there is no major structural issue yet.',
      className: 'bg-amber-100 text-amber-800 border-amber-200',
      reviewClassName: 'bg-amber-100 text-amber-800 border-amber-200',
      reviewLabel: 'Needs review',
    }
  }

  return {
    label: 'Critical · Urgent review',
    short: 'Critical',
    description: 'A serious data consistency or account integrity issue was detected.',
    className: 'bg-red-100 text-red-800 border-red-200',
    reviewClassName: 'bg-red-100 text-red-800 border-red-200',
    reviewLabel: 'Needs urgent review',
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
      description: 'Profiles exist without a matching auth user.',
      href: '/admin/members',
      label: 'Open Members',
    }
  }

  if (text.includes('invalid role')) {
    return {
      title: 'Review invalid roles',
      description: 'Some profiles have a missing or invalid role.',
      href: '/admin/members',
      label: 'Open Members',
    }
  }

  if (text.includes('no scans')) {
    return {
      title: 'Check attendance flow',
      description: 'No scans were recorded after midday Cairo time.',
      href: '/admin/scan-audit',
      label: 'Open Scan Audit',
    }
  }

  if (text.includes('invite resend failure')) {
    return {
      title: 'Review invite resend failures',
      description: 'Recent invite resend attempts failed.',
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

function parseReportFilter(raw: string | string[] | undefined): ReportFilterStatus {
  const value = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw[0]
      : 'all'

  if (value === 'healthy' || value === 'warning' || value === 'critical') return value
  return 'all'
}

function reportMatchesFilter(report: HealthMonitorStoredReport, filter: ReportFilterStatus) {
  if (filter === 'all') return true
  return report.overall_status === filter
}

function buildMonitorHref({ status = 'all', reportId }: { status?: ReportFilterStatus; reportId?: string | null }) {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (reportId) params.set('report', reportId)
  const query = params.toString()
  return query ? `/admin/health-monitor?${query}` : '/admin/health-monitor'
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

function FilterChip({
  label,
  value,
  active,
  href,
}: {
  label: string
  value: number
  active?: boolean
  href: string
}) {
  return (
    <Link
      href={href}
      className={[
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
        active
          ? 'border-black bg-black text-white'
          : 'border-[hsl(var(--border))] bg-white text-black hover:bg-black/5',
      ].join(' ')}
    >
      <span>{label}</span>
      <span className={active ? 'text-white/85' : 'text-[hsl(var(--muted))]'}>{value}</span>
    </Link>
  )
}

function WarningActionList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return <p className="text-sm text-[hsl(var(--muted))]">No active warnings.</p>
  }

  return (
    <div className="space-y-3">
      {warnings.map((item) => {
        const action = getWarningAction(item)
        return (
          <div key={item} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
            <div className="text-sm font-semibold">{item}</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">{action.description}</div>
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

function CompactHighlights({ highlights }: { highlights: string[] }) {
  if (highlights.length === 0) return null

  return (
    <ul className="space-y-2 text-sm text-[hsl(var(--muted))]">
      {highlights.slice(0, 3).map((item) => (
        <li key={item} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2">
          {item}
        </li>
      ))}
    </ul>
  )
}

function FocusReportCard({
  report,
  filterStatus,
  autoFocusMessage,
  selectedOutsideFilter,
}: {
  report: HealthMonitorStoredReport | null
  filterStatus: ReportFilterStatus
  autoFocusMessage?: string | null
  selectedOutsideFilter?: boolean
}) {
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
  const warnings = Array.isArray(report.summary?.warnings) ? report.summary.warnings : []
  const highlights = Array.isArray(report.summary?.highlights) ? report.summary.highlights : []

  return (
    <Card>
      <CardContent className="space-y-4">
        {autoFocusMessage ? (
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-sm text-[hsl(var(--muted))]">
            {autoFocusMessage}
          </div>
        ) : null}

        {selectedOutsideFilter ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            The opened report is outside the current list filter.
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[hsl(var(--muted))]">Focus report</div>
            <div className="mt-1 text-lg font-semibold">{formatCairoDateTime(report.created_at)} · {report.mode}</div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">{status.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${status.className}`}>
              {status.label}
            </span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${email.className}`}>
              {email.label}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
          <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Warnings: {warnings.length}</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Highlights: {highlights.length}</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Scans today: {report.summary?.counts?.scans_today ?? 0}</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Generated for {report.summary?.generated_date_cairo ?? '—'}</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <div className="text-sm font-medium">Warnings to review</div>
            <WarningActionList warnings={warnings} />
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">Key highlights</div>
            <CompactHighlights highlights={highlights} />
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>Orphan profiles: <strong>{report.summary?.counts?.orphan_profiles ?? 0}</strong></div>
              <div>Invalid role profiles: <strong>{report.summary?.counts?.invalid_role_profiles ?? 0}</strong></div>
              <div>Invite resend failures 24h: <strong>{report.summary?.counts?.invite_resend_failures_24h ?? 0}</strong></div>
              <div>Delete actions 24h: <strong>{report.summary?.counts?.delete_actions_24h ?? 0}</strong></div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-sm text-[hsl(var(--muted))]">
              Email recipients: {Array.isArray(report.email_recipients) && report.email_recipients.length > 0 ? report.email_recipients.join(', ') : 'No recipients stored for this run.'}
              {report.email_error ? <div className="mt-2 text-red-700">{report.email_error}</div> : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" href={buildMonitorHref({ status: filterStatus, reportId: report.id })}>
            Refresh focus report
          </Button>
          <Button asChild variant="outline" size="sm" href="/admin/scan-audit">
            Open Scan Audit
          </Button>
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
      ? searchParams.report[0]
      : ''

  const filterStatus = parseReportFilter(searchParams?.status)
  const filteredReports = reports.filter((row) => reportMatchesFilter(row, filterStatus))
  const latestNeedsReviewOverall = reports.find((row) => row.overall_status !== 'healthy') ?? null
  const requestedReport = reports.find((row) => row.id === requestedReportId) ?? null
  const selectedReport = requestedReport
    ?? (filterStatus === 'all'
      ? latestNeedsReviewOverall ?? reports[0] ?? null
      : filteredReports[0] ?? latestNeedsReviewOverall ?? reports[0] ?? null)

  const selectedOutsideFilter = !!selectedReport && filterStatus !== 'all' && !reportMatchesFilter(selectedReport, filterStatus)
  const liveStatus = getStatusMeta(summary.overall_status)

  const visibleHealthyCount = filteredReports.filter((row) => row.overall_status === 'healthy').length
  const visibleWarningCount = filteredReports.filter((row) => row.overall_status === 'warning').length
  const visibleCriticalCount = filteredReports.filter((row) => row.overall_status === 'critical').length

  let autoFocusMessage: string | null = null
  if (!requestedReportId && selectedReport) {
    if (filterStatus === 'all' && selectedReport.overall_status !== 'healthy') {
      autoFocusMessage = 'Auto-focused the latest report that needs review.'
    } else if (filterStatus !== 'all') {
      autoFocusMessage = `Auto-focused the latest ${filterStatus} report in the current list.`
    }
  }

  return (
    <main>
      <PageHeader
        title="Health Monitor"
        subtitle="Daily health view with one focus report."
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[hsl(var(--muted))]">Live overview</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${liveStatus.className}`}>
                    {liveStatus.label}
                  </span>
                  <span className="text-sm text-[hsl(var(--muted))]">{summary.generated_date_cairo} · {summary.time_zone}</span>
                </div>
                <p className="mt-2 text-sm text-[hsl(var(--muted))]">{liveStatus.description}</p>
              </div>
              <div className="text-sm text-[hsl(var(--muted))] xl:text-right">
                Email recipients: {recipients.length > 0 ? recipients.join(', ') : 'not configured'}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
              <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Healthy</span>
              <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Warning</span>
              <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Critical</span>
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
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium">Live check</div>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">The current run in one place, without repeating the same information below.</p>
              </div>

              <WarningActionList warnings={summary.warnings} />

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>Orphan profiles: <strong>{summary.counts.orphan_profiles}</strong></div>
                <div>Invalid role profiles: <strong>{summary.counts.invalid_role_profiles}</strong></div>
                <div>Invite resend failures 24h: <strong>{summary.counts.invite_resend_failures_24h}</strong></div>
                <div>Delete actions 24h: <strong>{summary.counts.delete_actions_24h}</strong></div>
              </div>

              <CompactHighlights highlights={summary.highlights} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium">Triage</div>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">Pick a filter, then review one focus report.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <FilterChip label="All" value={reports.length} active={filterStatus === 'all'} href={buildMonitorHref({ status: 'all' })} />
                <FilterChip label="Healthy" value={reports.filter((row) => row.overall_status === 'healthy').length} active={filterStatus === 'healthy'} href={buildMonitorHref({ status: 'healthy' })} />
                <FilterChip label="Warning" value={reports.filter((row) => row.overall_status === 'warning').length} active={filterStatus === 'warning'} href={buildMonitorHref({ status: 'warning' })} />
                <FilterChip label="Critical" value={reports.filter((row) => row.overall_status === 'critical').length} active={filterStatus === 'critical'} href={buildMonitorHref({ status: 'critical' })} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Visible</div>
                  <div className="mt-1 text-xl font-semibold">{filteredReports.length}</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Warning</div>
                  <div className="mt-1 text-xl font-semibold">{visibleWarningCount}</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">Critical</div>
                  <div className="mt-1 text-xl font-semibold">{visibleCriticalCount}</div>
                </div>
              </div>

              {latestNeedsReviewOverall ? (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-sm text-[hsl(var(--muted))]">
                  Latest review needed: <strong>{formatCairoDateTime(latestNeedsReviewOverall.created_at)}</strong>.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Focus report</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Open one recent report in detail.</p>
        </div>

        <FocusReportCard
          report={selectedReport}
          filterStatus={filterStatus}
          autoFocusMessage={autoFocusMessage}
          selectedOutsideFilter={selectedOutsideFilter}
        />
      </Section>

      <Section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recent reports</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Compact list for switching the focus report. Status = system health. Email = delivery result for that report only.</p>
          </div>
          <div className="text-sm text-[hsl(var(--muted))]">Showing {filteredReports.length} report(s)</div>
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
        ) : filteredReports.length === 0 ? (
          <Card>
            <CardContent className="space-y-3">
              <div className="text-sm font-medium">No reports match this filter.</div>
              <div>
                <Button asChild variant="outline" size="sm" href={buildMonitorHref({ status: 'all' })}>
                  Show all reports
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {filteredReports.map((row) => {
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
                            Focused
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

                      <Button asChild variant={isSelected ? 'solid' : 'outline'} size="sm" href={buildMonitorHref({ status: filterStatus, reportId: row.id })}>
                        {isSelected ? 'Focused' : 'Open focus'}
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
                      <th className="px-2 py-3 font-semibold">Scans today</th>
                      <th className="px-2 py-3 font-semibold">Email</th>
                      <th className="px-2 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReports.map((row) => {
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
                          <td className="px-2 py-3 align-top whitespace-nowrap">{row.summary?.counts?.scans_today ?? 0}</td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${email.className}`}>
                              {email.label}
                            </span>
                          </td>
                          <td className="px-2 py-3 align-top whitespace-nowrap">
                            <Button asChild variant={isSelected ? 'solid' : 'outline'} size="sm" href={buildMonitorHref({ status: filterStatus, reportId: row.id })}>
                              {isSelected ? 'Focused' : 'Open focus'}
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
