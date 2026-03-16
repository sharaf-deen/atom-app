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

function badgeClass(status: string) {
  if (status === 'healthy') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (status === 'warning') return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-red-100 text-red-800 border-red-200'
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
          <CardContent className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-sm text-[hsl(var(--muted))]">Current status</div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass(summary.overall_status)}`}>
                  {summary.overall_status.toUpperCase()}
                </span>
                <span className="text-sm text-[hsl(var(--muted))]">{summary.generated_date_cairo} · {summary.time_zone}</span>
              </div>
            </div>
            <div className="ml-auto text-sm text-[hsl(var(--muted))]">
              Email recipients: {recipients.length > 0 ? recipients.join(', ') : 'not configured'}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Scans today" value={summary.counts.scans_today} hint={`Yesterday: ${summary.counts.scans_yesterday}`} />
          <StatCard label="Active members" value={summary.counts.active_members} hint={`Expiring in 7 days: ${summary.counts.expiring_7d}`} />
          <StatCard label="Outstanding total" value={`${summary.counts.outstanding_total_egp.toFixed(0)} EGP`} hint={`${summary.counts.outstanding_members} member(s)`} />
          <StatCard label="Members created 24h" value={summary.counts.members_created_24h} hint={`Invite resends 24h: ${summary.counts.invite_resends_24h}`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold">Warnings</h2>
              {summary.warnings.length > 0 ? (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                  {summary.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[hsl(var(--muted))]">No active warnings.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold">Highlights</h2>
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Recent reports</h2>
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
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="px-2 py-3 font-semibold">Created at</th>
                    <th className="px-2 py-3 font-semibold">Mode</th>
                    <th className="px-2 py-3 font-semibold">Status</th>
                    <th className="px-2 py-3 font-semibold">Scans today</th>
                    <th className="px-2 py-3 font-semibold">Orphans</th>
                    <th className="px-2 py-3 font-semibold">Email</th>
                    <th className="px-2 py-3 font-semibold">Recipients</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((row) => (
                    <tr key={row.id} className="border-b border-[hsl(var(--border))] last:border-0">
                      <td className="px-2 py-3 align-top whitespace-nowrap">{new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}</td>
                      <td className="px-2 py-3 align-top whitespace-nowrap">{row.mode}</td>
                      <td className="px-2 py-3 align-top whitespace-nowrap">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClass(row.overall_status)}`}>
                          {row.overall_status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-2 py-3 align-top whitespace-nowrap">{row.summary?.counts?.scans_today ?? 0}</td>
                      <td className="px-2 py-3 align-top whitespace-nowrap">{row.summary?.counts?.orphan_profiles ?? 0}</td>
                      <td className="px-2 py-3 align-top whitespace-nowrap">{row.email_sent ? 'sent' : row.email_error ? 'failed' : 'skipped'}</td>
                      <td className="px-2 py-3 align-top">
                        <div className="max-w-[260px] break-words text-xs text-[hsl(var(--muted))]">
                          {Array.isArray(row.email_recipients) && row.email_recipients.length > 0 ? row.email_recipients.join(', ') : '—'}
                          {row.email_error ? <div className="mt-1 text-red-700">{row.email_error}</div> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </Section>
    </main>
  )
}
