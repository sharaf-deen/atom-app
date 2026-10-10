// src/app/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUserCached } from '@/lib/requestCache'
import { canAccessMembersList } from '@/lib/rbac'
import MembersFilters from './_components/MembersFilters'
import MembersStatsCards from './_components/MembersStatsCards'
import MembersResults from './_components/MembersResults'

type Status = 'all' | 'active' | 'frozen' | 'inactive'
type InactiveReason = 'all' | 'expired' | 'cancelled' | 'no_membership' | 'depleted_legacy' | 'other_inactive'
type LegalStatus = 'all' | 'complete' | 'action_required'
type SearchParams = { [key: string]: string | string[] | undefined }

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function StatsCardsFallback() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 shadow-soft">
            <div className="h-3 w-20 animate-pulse rounded bg-[hsl(var(--bg))]" />
            <div className="mt-3 h-8 w-12 animate-pulse rounded bg-[hsl(var(--bg))]" />
            <div className="mt-3 h-3 w-28 animate-pulse rounded bg-[hsl(var(--bg))]" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 shadow-soft">
            <div className="h-3 w-28 animate-pulse rounded bg-[hsl(var(--bg))]" />
            <div className="mt-3 h-8 w-12 animate-pulse rounded bg-[hsl(var(--bg))]" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultsFallback() {
  return (
    <div className="space-y-3">
      <div className="space-y-3 lg:hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-soft">
            <div className="h-5 w-40 animate-pulse rounded bg-[hsl(var(--bg))]" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-[hsl(var(--bg))]" />
          </div>
        ))}
      </div>
      <div className="hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-soft lg:block">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 w-full animate-pulse rounded bg-[hsl(var(--bg))]" />)}
        </div>
      </div>
    </div>
  )
}

export default async function MembersPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()

  const q = typeof searchParams?.q === 'string' ? searchParams.q.trim() : ''
  const statusRaw = typeof searchParams?.status === 'string' ? searchParams.status.toLowerCase() : 'all'
  const status: Status = (['all', 'active', 'frozen', 'inactive'] as const).includes(statusRaw as any)
    ? (statusRaw as Status)
    : 'all'
  const inactiveReasonRaw = typeof searchParams?.reason === 'string' ? searchParams.reason.toLowerCase() : 'all'
  const inactiveReason: InactiveReason =
    status === 'inactive' &&
    (['all', 'expired', 'cancelled', 'no_membership', 'depleted_legacy', 'other_inactive'] as const).includes(inactiveReasonRaw as any)
      ? (inactiveReasonRaw as InactiveReason)
      : 'all'
  const program = typeof searchParams?.program === 'string' ? searchParams.program.trim() : ''
  const legalRaw = typeof searchParams?.legal === 'string' ? searchParams.legal.toLowerCase() : 'all'
  const legalStatus: LegalStatus = (['all', 'complete', 'action_required'] as const).includes(legalRaw as any)
    ? (legalRaw as LegalStatus)
    : 'all'
  const page = clampInt(Number(typeof searchParams?.page === 'string' ? searchParams.page : 1), 1, 1_000_000)
  const pageSize = clampInt(Number(typeof searchParams?.pageSize === 'string' ? searchParams.pageSize : 20), 5, 200)

  const current = new URLSearchParams()
  if (q) current.set('q', q)
  if (!q && status !== 'all') current.set('status', status)
  if (!q && status === 'inactive' && inactiveReason !== 'all') current.set('reason', inactiveReason)
  if (program) current.set('program', program)
  if (legalStatus !== 'all') current.set('legal', legalStatus)
  if (page > 1) current.set('page', String(page))
  if (pageSize !== 20) current.set('pageSize', String(pageSize))
  const currentPath = `/members${current.toString() ? `?${current.toString()}` : ''}`

  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)
  if (!canAccessMembersList(me.role)) {
    return (
      <AccessDeniedPage
        title="Members"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access the members list."
        allowed="reception, admin, super_admin"
        nextPath="/members"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Members" subtitle="Find a member fast, then use filters only when needed." />
      <Section className="space-y-4">
        <MembersFilters
          initialQ={q}
          initialStatus={q ? 'all' : status}
          initialInactiveReason={q ? 'all' : inactiveReason}
          initialProgram={program}
          initialLegalStatus={legalStatus}
          initialPageSize={pageSize}
        />
        <Suspense fallback={<ResultsFallback />}>
          <MembersResults
            q={q}
            status={status}
            inactiveReason={inactiveReason}
            program={program}
            legalStatus={legalStatus}
            page={page}
            pageSize={pageSize}
          />
        </Suspense>

        <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Member overview</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">Open aggregate membership and legal-status counts when you need them.</div>
              </div>
              <span className="text-sm font-medium text-[hsl(var(--muted))]">Show</span>
            </div>
          </summary>
          <div className="mt-4">
            <Suspense fallback={<StatsCardsFallback />}>
              <MembersStatsCards pageSize={pageSize} />
            </Suspense>
          </div>
        </details>
      </Section>
    </main>
  )
}
