// src/app/members/_components/MembersStatsCards.tsx
import Link from 'next/link'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type Status = 'all' | 'active' | 'frozen' | 'inactive'
type LegalStatus = 'complete' | 'action_required'

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

function hrefForLegalStatus(status: LegalStatus, pageSize: number) {
  const sp = new URLSearchParams()
  sp.set('legal', status)
  if (pageSize !== 20) sp.set('pageSize', String(pageSize))
  return `/members?${sp.toString()}`
}

export default async function MembersStatsCards({ pageSize }: Props) {
  const admin = getSupabaseAdminClientCached()

  let statsData: any = null
  let statsError: string | null = null
  let legalData: any = null
  let legalError: string | null = null

  try {
    const { data, error } = await admin.rpc('members_activity_stats_v4')
    if (error) throw new Error(error.message)
    statsData = data
  } catch (e: any) {
    statsError = e?.message || String(e)
  }

  try {
    const { data, error } = await admin.rpc('member_legal_consent_stats_v1')
    if (error) throw new Error(error.message)
    legalData = data
  } catch (e: any) {
    legalError = e?.message || String(e)
  }

  const stats = (Array.isArray(statsData) ? statsData[0] : statsData) as
    | { total?: number | string | null; active?: number | string | null; frozen?: number | string | null; inactive?: number | string | null }
    | null

  const legalStats = (Array.isArray(legalData) ? legalData[0] : legalData) as
    | { total_members?: number | string | null; complete?: number | string | null; action_required?: number | string | null; required_documents?: number | string | null }
    | null

  const total = Number(stats?.total ?? 0)
  const active = Number(stats?.active ?? 0)
  const frozen = Number(stats?.frozen ?? 0)
  const inactive = Number(stats?.inactive ?? Math.max(total - active - frozen, 0))
  const legalComplete = Number(legalStats?.complete ?? 0)
  const legalActionRequired = Number(legalStats?.action_required ?? 0)
  const requiredDocuments = Number(legalStats?.required_documents ?? 0)

  return (
    <>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
          href={hrefForStatus('frozen', pageSize)}
          className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Frozen</div>
          <div className="mt-1 text-xl font-semibold text-sky-600 group-hover:underline">{frozen}</div>
          <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Open frozen members</div>
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

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Link
          prefetch={false}
          href={hrefForLegalStatus('complete', pageSize)}
          className="group rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Legal complete</div>
          <div className="mt-1 text-xl font-semibold text-emerald-700 group-hover:underline">{legalComplete}</div>
          <div className="mt-1 text-[11px] text-emerald-800">
            Current {requiredDocuments} required document{requiredDocuments === 1 ? '' : 's'} accepted
          </div>
        </Link>

        <Link
          prefetch={false}
          href={hrefForLegalStatus('action_required', pageSize)}
          className="group rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800">Legal action required</div>
          <div className="mt-1 text-xl font-semibold text-amber-800 group-hover:underline">{legalActionRequired}</div>
          <div className="mt-1 text-[11px] text-amber-900">Open members needing consent regularization</div>
        </Link>
      </div>

      {statsError ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Members counters are unavailable right now. {statsError}
        </div>
      ) : null}

      {legalError ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Legal consent counters are unavailable right now. {legalError}
        </div>
      ) : null}
    </>
  )
}
