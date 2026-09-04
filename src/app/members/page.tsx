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

type SearchParams = { [key: string]: string | string[] | undefined }

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function StatsCardsFallback() {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 shadow-soft"
        >
          <div className="h-3 w-20 rounded bg-[hsl(var(--bg))] animate-pulse" />
          <div className="mt-3 h-8 w-12 rounded bg-[hsl(var(--bg))] animate-pulse" />
          <div className="mt-3 h-3 w-28 rounded bg-[hsl(var(--bg))] animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function ResultsFallback() {
  return (
    <div className="space-y-3">
      <div className="space-y-3 lg:hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-soft"
          >
            <div className="h-5 w-40 rounded bg-[hsl(var(--bg))] animate-pulse" />
            <div className="mt-2 h-3 w-24 rounded bg-[hsl(var(--bg))] animate-pulse" />
            <div className="mt-4 space-y-2">
              <div className="h-3 w-full rounded bg-[hsl(var(--bg))] animate-pulse" />
              <div className="h-3 w-5/6 rounded bg-[hsl(var(--bg))] animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-[hsl(var(--bg))] animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden lg:block rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-soft">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 w-full rounded bg-[hsl(var(--bg))] animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
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
  const page = clampInt(Number(typeof searchParams?.page === 'string' ? searchParams.page : 1), 1, 1_000_000)
  const pageSize = clampInt(Number(typeof searchParams?.pageSize === 'string' ? searchParams.pageSize : 20), 5, 200)

  const current = new URLSearchParams()
  if (q) current.set('q', q)
  if (!q && status !== 'all') current.set('status', status)
  if (!q && status === 'inactive' && inactiveReason !== 'all') current.set('reason', inactiveReason)
  if (page > 1) current.set('page', String(page))
  if (pageSize !== 20) current.set('pageSize', String(pageSize))
  const currentPath = `/members${current.toString() ? `?${current.toString()}` : ''}`

  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  const allowed = canAccessMembersList(me.role)

  if (!allowed) {
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
      <PageHeader title="Members" subtitle="Search and manage members" />

      <Section className="space-y-4">
        <MembersFilters initialQ={q} initialStatus={q ? 'all' : status} initialInactiveReason={q ? 'all' : inactiveReason} initialPageSize={pageSize} />

        <Suspense fallback={<StatsCardsFallback />}>
          <MembersStatsCards pageSize={pageSize} />
        </Suspense>

        <Suspense fallback={<ResultsFallback />}>
          <MembersResults q={q} status={status} inactiveReason={inactiveReason} page={page} pageSize={pageSize} />
        </Suspense>
      </Section>
    </main>
  )
}
