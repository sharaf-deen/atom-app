// src/app/members/_components/MembersStatsCards.tsx
import Link from 'next/link'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type Status = 'all' | 'active' | 'inactive'

type Props = {
  pageSize: number
}

function hrefForStatus(status: Status, pageSize: number) {
  const sp = new URLSearchParams()
  if (status !== 'all') sp.set('status', status)
  if (pageSize !== 20) sp.set('pageSize', String(pageSize))
  const qs = sp.toString()
  return qs ? `/members?${qs}` : '/members'
}

export default async function MembersStatsCards({ pageSize }: Props) {
  const admin = getSupabaseAdminClientCached()

  let statsData: any = null
  let statsError: string | null = null

  try {
    const { data, error } = await admin.rpc('members_activity_stats_v3')
    if (error) throw new Error(error.message)
    statsData = data
  } catch (e: any) {
    statsError = e?.message || String(e)
  }

  const stats = (Array.isArray(statsData) ? statsData[0] : statsData) as
    | { total?: number | string | null; active?: number | string | null; inactive?: number | string | null }
    | null

  const total = Number(stats?.total ?? 0)
  const active = Number(stats?.active ?? 0)
  const inactive = Number(stats?.inactive ?? Math.max(total - active, 0))

  return (
    <>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <Link
          prefetch={false}
          href={hrefForStatus('all', pageSize)}
          className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Total members</div>
          <div className="mt-1 text-xl font-semibold group-hover:underline">{total}</div>
          <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Open all members</div>
        </Link>

        <Link
          prefetch={false}
          href={hrefForStatus('active', pageSize)}
          className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Active</div>
          <div className="mt-1 text-xl font-semibold text-emerald-600 group-hover:underline">{active}</div>
          <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Open active members</div>
        </Link>

        <Link
          prefetch={false}
          href={hrefForStatus('inactive', pageSize)}
          className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Inactive</div>
          <div className="mt-1 text-xl font-semibold text-amber-600 group-hover:underline">{inactive}</div>
          <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Open inactive members</div>
        </Link>
      </div>

      {statsError ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Members counters are unavailable right now. {statsError}
        </div>
      ) : null}
    </>
  )
}
