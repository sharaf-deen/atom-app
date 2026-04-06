export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { CheckCircle2, MailQuestion, ShieldAlert, UserRound } from 'lucide-react'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import AccountActivationBadge from '@/components/account/AccountActivationBadge'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ResendInviteButton from '@/components/ResendInviteButton'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import {
  accountActivationLabel,
  accountActivationSortValue,
  type AccountActivationRow,
  type AccountActivationStatus,
} from '@/lib/accountActivation'
import { listAccountActivationRows } from '@/lib/accountActivationServer'
import { getSessionUserCached } from '@/lib/requestCache'
import { canAccessAdminDashboard } from '@/lib/rbac'

type SearchParams = Record<string, string | string[] | undefined>

type ViewRow = AccountActivationRow & {
  id: string
}

function spGet(sp: SearchParams, key: string): string {
  const v = sp[key]
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

function fmtDateTime(v?: string | null) {
  if (!v) return '—'
  const dt = new Date(v)
  if (Number.isNaN(dt.getTime())) return v
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt)
}

function fmtAge(days?: number | null) {
  if (days === null || days === undefined) return '—'
  if (!Number.isFinite(days)) return '—'
  if (days <= 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function fullName(row: Pick<AccountActivationRow, 'first_name' | 'last_name' | 'email'>) {
  const name = [row.first_name ?? '', row.last_name ?? ''].join(' ').trim()
  return name || row.email || 'Unknown member'
}

function statusCount(rows: ViewRow[], status: AccountActivationStatus) {
  return rows.filter((row) => row.account_status === status).length
}

function matchesSearch(row: ViewRow, q: string) {
  if (!q) return true
  const hay = [
    row.member_id ?? '',
    row.email ?? '',
    row.first_name ?? '',
    row.last_name ?? '',
    row.role ?? '',
    accountActivationLabel(row.account_status),
  ]
    .join(' ')
    .toLowerCase()

  return hay.includes(q)
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: number
  hint: string
  icon: ReactNode
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">{label}</div>
            <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
            <div className="mt-2 text-sm text-[hsl(var(--muted))]">{hint}</div>
          </div>
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-black">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function AccountActivationPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getSessionUserCached()
  const nextPath = '/admin/account-activation'

  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  if (!canAccessAdminDashboard(me.role)) {
    return (
      <AccessDeniedPage
        title="Account Activation"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can review account activation status."
        allowed="admin, super_admin"
        nextPath={nextPath}
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  const q = spGet(searchParams, 'q').trim().toLowerCase()
  const status = spGet(searchParams, 'status').trim() as '' | 'active' | 'invite_pending' | 'no_account' | 'auth_issue'
  const allRows = (await listAccountActivationRows()).map((row, index) => ({ ...row, id: row.user_id ?? row.email ?? `account-row-${index}` }))

  const filteredRows = allRows
    .filter((row) => (status ? row.account_status === status : true))
    .filter((row) => matchesSearch(row, q))
    .sort((a, b) => {
      const byStatus = accountActivationSortValue(a.account_status) - accountActivationSortValue(b.account_status)
      if (byStatus !== 0) return byStatus
      const byAge = (b.invite_age_days ?? -1) - (a.invite_age_days ?? -1)
      if (byAge !== 0) return byAge
      return fullName(a).localeCompare(fullName(b))
    })

  const columns = [
    { key: 'member', header: 'Member' },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Role' },
    { key: 'status', header: 'Account status' },
    { key: 'invited_at', header: 'Invited at', hideOnMobile: true },
    { key: 'last_sign_in', header: 'Last sign in', hideOnMobile: true },
    { key: 'invite_age', header: 'Invite age', hideOnMobile: true },
    { key: 'actions', header: 'Actions' },
    { key: 'open', header: 'Open' },
  ]

  const rows = filteredRows.map((row) => ({
    id: row.id,
    member: (
      <div className="min-w-0">
        <div className="font-semibold tracking-tight">{fullName(row)}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.member_id || 'No member id'}</div>
      </div>
    ),
    email: row.email || '—',
    role: row.role || 'member',
    status: <AccountActivationBadge status={row.account_status} />,
    invited_at: fmtDateTime(row.invited_at),
    last_sign_in: fmtDateTime(row.last_sign_in_at),
    invite_age: fmtAge(row.invite_age_days),
    actions: row.user_id ? (
      <ResendInviteButton userId={row.user_id} email={row.email} hideStatusBadge className="justify-end" />
    ) : (
      '—'
    ),
    open: row.user_id ? (
      <Button asChild variant="outline" size="sm" href={`/members/${row.user_id}`}>
        Open member
      </Button>
    ) : (
      '—'
    ),
  }))

  return (
    <main>
      <PageHeader
        title="Account Activation"
        subtitle="Admin overview of app account activation, with resend invite and reset password actions."
        right={
          <Button asChild variant="outline" href="/admin">
            Back to Admin
          </Button>
        }
      />

      <Section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active"
            value={statusCount(allRows, 'active')}
            hint="Members already activated"
            icon={<CheckCircle2 size={18} strokeWidth={2.1} />}
          />
          <StatCard
            label="Invite pending"
            value={statusCount(allRows, 'invite_pending')}
            hint="Need follow-up"
            icon={<MailQuestion size={18} strokeWidth={2.1} />}
          />
          <StatCard
            label="No account"
            value={statusCount(allRows, 'no_account')}
            hint="No usable app account yet"
            icon={<UserRound size={18} strokeWidth={2.1} />}
          />
          <StatCard
            label="Auth issue"
            value={statusCount(allRows, 'auth_issue')}
            hint="Check setup consistency"
            icon={<ShieldAlert size={18} strokeWidth={2.1} />}
          />
        </div>

        <Card>
          <CardContent className="space-y-2 text-sm text-[hsl(var(--muted))]">
            <p>Admins can now follow up directly from this page.</p>
            <ul className="space-y-1 pl-5 list-disc">
              <li><span className="font-medium text-black">Invite pending</span> → Resend invite</li>
              <li><span className="font-medium text-black">Active</span> → Send reset password email</li>
              <li><span className="font-medium text-black">No account / Auth issue</span> → review the member profile first</li>
            </ul>
          </CardContent>
        </Card>

        <form
          action="/admin/account-activation"
          method="get"
          className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_220px_auto]"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder="Search member / email / role / member id"
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
          />

          <select
            name="status"
            defaultValue={status}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
          >
            <option value="">All account statuses</option>
            <option value="active">Active</option>
            <option value="invite_pending">Invite pending</option>
            <option value="no_account">No account</option>
            <option value="auth_issue">Auth issue</option>
          </select>

          <div className="flex items-center gap-2">
            <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Apply
            </button>
            <Link href="/admin/account-activation" className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
              Reset
            </Link>
            <span className="ml-auto text-sm text-[hsl(var(--muted))]">{filteredRows.length} result(s)</span>
          </div>
        </form>

        <Table columns={columns} rows={rows} keyField="id" stickyTopClassName="top-0" />
      </Section>
    </main>
  )
}
