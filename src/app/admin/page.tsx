// src/app/admin/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import type React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AdminExports from '@/components/AdminExports'
import AdminRevenue from '@/components/AdminRevenue'
import { addDays, cairoToday, CAIRO_TZ } from '@/lib/cairoDate'
import { MessageSquare, ShieldAlert, ShieldCheck, Wallet, UserCog } from 'lucide-react'

function fmtMoneyEGP(v: any) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function healthBadgeClass(status?: string | null) {
  const value = String(status ?? '').toLowerCase()
  if (value === 'healthy') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (value === 'critical') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  href?: string
}) {
  const inner = (
    <Card hover>
      <CardContent>
        <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">{hint}</div> : null}
      </CardContent>
    </Card>
  )

  if (!href) return inner
  return (
    <Link
      href={href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl"
    >
      {inner}
    </Link>
  )
}

function TodayCard({
  href,
  label,
  title,
  hint,
  icon,
}: {
  href: string
  label: string
  title: string
  hint: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="group block rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">{label}</div>
          <div className="mt-2 text-base font-semibold tracking-tight">{title}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">{hint}</div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black">
          {icon}
        </span>
      </div>
    </Link>
  )
}

export default async function AdminPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin')

  const allowed = me.role === 'admin' || me.role === 'super_admin'
  if (!allowed) {
    return (
      <Forbidden
        pageTitle="Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can access the admin dashboard."
        allowed="admin, super_admin"
        nextPath="/admin"
        actions={[{ href: '/', label: 'Go Home' }, { href: '/members', label: 'Members' }]}
        showBackHome
      />
    )
  }

  const supa = createSupabaseRSC()

  // Cairo date strings (YYYY-MM-DD)
  const today = cairoToday()
  const next7 = addDays(today, 7)

  // KPIs
  const [{ count: activeCount }, { count: expiring7Count }, scansRes] = await Promise.all([
    supa
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('end_date', today)
      // exclude frozen memberships (same logic as Expiring Soon page)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    supa
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', next7)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    supa.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
  ])

  // Outstanding total (sum)
  let outstandingCount = 0
  let outstandingTotal = 0
  try {
    const { data, count } = await supa
      .from('subscriptions')
      .select('amount_due', { count: 'exact' })
      .gt('amount_due', 0)
      .not('member_id', 'is', null)
      .limit(10000)

    outstandingCount = count ?? (data?.length ?? 0)
    outstandingTotal = (data ?? []).reduce((acc, r: any) => acc + Number(r?.amount_due ?? 0), 0)
  } catch {
    // ignore
  }

  let latestHealthStatus: string | null = null
  let latestHealthDate: string | null = null

  try {
    const admin = getSupabaseAdminClientCached()
    const { data } = await admin
      .from('system_health_reports')
      .select('overall_status, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ overall_status: string | null; created_at: string | null }>()

    latestHealthStatus = data?.overall_status ?? null
    latestHealthDate = data?.created_at ?? null
  } catch {
    // ignore
  }

  const scansToday = scansRes?.count ?? 0
  const latestHealthLabel = latestHealthStatus
    ? `${latestHealthStatus.charAt(0).toUpperCase()}${latestHealthStatus.slice(1)}`
    : 'Not run yet'

  return (
    <main>
      <PageHeader
        title="Admin Dashboard"
        subtitle={`Daily ops · Cairo time (${CAIRO_TZ}).`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" href="/scan?kiosk=1">
              Scan
            </Button>
            <Button asChild variant="outline" href="/members">
              Members
            </Button>
          </div>
        }
      />

      <Section>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active members"
            value={activeCount ?? 0}
            hint={`Active subscriptions as of ${today}`}
            href="/members"
          />
          <StatCard
            label="Expiring in 7 days"
            value={expiring7Count ?? 0}
            hint={`Window: ${today} → ${next7}`}
            href="/admin/expiring-soon"
          />
          <StatCard
            label="Outstanding total"
            value={fmtMoneyEGP(outstandingTotal)}
            hint={`${outstandingCount} member(s) with dues`}
            href="/admin/outstanding-dues"
          />
          <StatCard
            label="Scans today"
            value={scansToday}
            hint={`Attendance — ${today}`}
            href="/admin/scan-audit"
          />
        </div>
      </Section>

      <Section className="space-y-4">
        <h2 className="text-lg font-semibold">Today priorities</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TodayCard
            href="/admin/crm"
            label="Follow-up"
            title="Open CRM"
            hint="Start with renewals, dues and low-attendance cases."
            icon={<MessageSquare size={18} strokeWidth={2.1} />}
          />
          <TodayCard
            href="/admin/health-monitor"
            label="Health"
            title={latestHealthLabel}
            hint={latestHealthDate ? `Latest report saved ${new Date(latestHealthDate).toLocaleDateString('en-GB')}.` : 'Open Health Monitor to review or run a check.'}
            icon={
              latestHealthStatus === 'healthy' ? (
                <ShieldCheck size={18} strokeWidth={2.1} />
              ) : (
                <ShieldAlert size={18} strokeWidth={2.1} />
              )
            }
          />
          <TodayCard
            href="/admin/payments"
            label="Finance"
            title={outstandingCount > 0 ? fmtMoneyEGP(outstandingTotal) : 'Payments clear'}
            hint={outstandingCount > 0 ? `${outstandingCount} member(s) still have dues to settle.` : 'Open Payments or Cash Report for detail.'}
            icon={<Wallet size={18} strokeWidth={2.1} />}
          />
          <TodayCard
            href={me.role === 'super_admin' ? '/admin/permissions-audit' : '/admin/personal-funds'}
            label={me.role === 'super_admin' ? 'Control' : 'Review'}
            title={me.role === 'super_admin' ? 'Permissions audit' : 'Personal funds'}
            hint={me.role === 'super_admin' ? 'Review access in one place.' : 'Review advances, reimbursements and proof.'}
            icon={<UserCog size={18} strokeWidth={2.1} />}
          />
        </div>
      </Section>

      <Section className="space-y-4">
        <h2 className="text-lg font-semibold">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/crm">
            CRM
          </Button>
          <Button asChild variant="outline" href="/admin/payments">
            Payments
          </Button>
          <Button asChild variant="outline" href="/admin/cash-report">
            Cash report
          </Button>
          <Button asChild variant="outline" href="/expenses">
            Expenses
          </Button>
          <Button asChild variant="outline" href="/admin/health-monitor">
            Health Monitor
          </Button>
          <Button asChild variant="outline" href="/admin/personal-funds">
            Personal Funds
          </Button>
          <Button asChild variant="outline" href="/admin/external-income">
            Other Income
          </Button>
          {me.role === 'super_admin' ? (
            <Button asChild variant="outline" href="/admin/permissions-audit">
              Permissions Audit
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AdminRevenue />
          <AdminExports />
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm text-[hsl(var(--muted))]">
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${healthBadgeClass(latestHealthStatus)}`}>
              Health: {latestHealthLabel}
            </span>
            <Link href="/" className="ml-auto underline">
              Back to home
            </Link>
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
