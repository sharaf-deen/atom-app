// src/app/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUser, type Role } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import MembersFilters from './_components/MembersFilters'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']

type Status = 'all' | 'active' | 'inactive'

type MemberRow = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  created_at: string | null
  member_id: string | null
  date_of_birth: string | null
  is_active?: boolean | null
}

type MemberRowWithTotal = MemberRow & { total_count?: number | string | null }

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const date = d.length <= 10 ? new Date(d + 'T00:00:00Z') : new Date(d)
  if (isNaN(date.getTime())) return d
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(date)
}

function ageYears(dob?: string | null) {
  if (!dob) return null
  const dateOnly = dob.length === 10 ? dob : dob.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null
  const [y, m, d] = dateOnly.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(born.getTime())) return null

  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  if (age < 0) return null
  return age
}

function StatusBadge({ active }: { active?: boolean | null }) {
  const isTrue = active === true
  const isFalse = active === false

  if (!isTrue && !isFalse) {
    return (
      <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted))]">
        Unknown
      </span>
    )
  }

  if (isTrue) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        Active
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
      Inactive
    </span>
  )
}

function AgeBadge({ dob }: { dob?: string | null }) {
  const age = ageYears(dob ?? null)
  if (age === null) return null
  const isKid = age < 17
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        isKid ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-violet-200 bg-violet-50 text-violet-700'
      }`}
      title={dob ? `Date of birth: ${dob}` : undefined}
    >
      {isKid ? 'Kid' : 'Adult'}
    </span>
  )
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()

  const q = typeof searchParams?.q === 'string' ? searchParams.q.trim() : ''
  const statusRaw = typeof searchParams?.status === 'string' ? searchParams.status.toLowerCase() : 'all'
  const status: Status = (['all', 'active', 'inactive'] as const).includes(statusRaw as any)
    ? (statusRaw as Status)
    : 'all'
  const page = clampInt(Number(typeof searchParams?.page === 'string' ? searchParams.page : 1), 1, 1_000_000)
  const pageSize = clampInt(Number(typeof searchParams?.pageSize === 'string' ? searchParams.pageSize : 20), 5, 200)

  // Build current path for the login redirect.
  const current = new URLSearchParams()
  if (q) current.set('q', q)
  if (!q && status !== 'all') current.set('status', status)
  if (page > 1) current.set('page', String(page))
  if (pageSize !== 20) current.set('pageSize', String(pageSize))
  const currentPath = `/members${current.toString() ? `?${current.toString()}` : ''}`

  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  const allowed = STAFF.includes(me.role)

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

  const admin = createSupabaseAdminClient()

  // Stats (server rendered) via RPC (Postgres does the heavy lifting).
  const { data: statsData, error: statsError } = await admin.rpc('members_activity_stats')
  if (statsError) console.error('Error fetching members stats (RPC):', statsError)

  const stats = (Array.isArray(statsData) ? statsData[0] : statsData) as
    | { total?: number | string | null; active?: number | string | null; inactive?: number | string | null }
    | null

  const total = Number(stats?.total ?? 0)
  const active = Number(stats?.active ?? 0)
  const inactive = Number(stats?.inactive ?? Math.max(total - active, 0))

  let rows: MemberRow[] = []
  let totalResults = 0
  const mode: 'search' | 'list' = q ? 'search' : 'list'
  let errorMsg: string | null = null

  // Pro search (FTS + trigram + pagination) via RPC.
  // Note: when q is set, we force status='all' to match the previous UX.
  const { data, error } = await admin.rpc('search_members', {
    q: q || null,
    status: q ? 'all' : status,
    page,
    page_size: pageSize,
  })

  if (error) {
    errorMsg = error.message
    rows = []
    totalResults = 0
  } else {
    const list = (data ?? []) as MemberRowWithTotal[]
    totalResults = list.length ? Number(list[0]?.total_count ?? 0) : 0
    rows = list.map(({ total_count: _t, ...rest }) => rest)
  }

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize))

  const base = new URLSearchParams()
  if (q) base.set('q', q)
  if (!q && status !== 'all') base.set('status', status)
  if (pageSize !== 20) base.set('pageSize', String(pageSize))

  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams(base)
    if (p > 1) sp.set('page', String(p))
    const s = sp.toString()
    return s ? `/members?${s}` : '/members'
  }

  const hrefForStatus = (s: Status) => {
    const sp = new URLSearchParams()
    if (s !== 'all') sp.set('status', s)
    if (pageSize !== 20) sp.set('pageSize', String(pageSize))
    const qs = sp.toString()
    return qs ? `/members?${qs}` : '/members'
  }

  return (
    <main>
      <PageHeader title="Members" subtitle="Search and manage your member base" />

      <Section className="space-y-4">
        <MembersFilters initialQ={q} initialStatus={q ? 'all' : status} initialPageSize={pageSize} />

        {/* Stats cards */}
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Link
            prefetch={false}
            href={hrefForStatus('all')}
            className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Total members</div>
            <div className="mt-1 text-xl font-semibold group-hover:underline">{total}</div>
            <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tap to list all members</div>
          </Link>

          <Link
            prefetch={false}
            href={hrefForStatus('active')}
            className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Active</div>
            <div className="mt-1 text-xl font-semibold text-emerald-600 group-hover:underline">{active}</div>
            <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tap to list active members</div>
          </Link>

          <Link
            prefetch={false}
            href={hrefForStatus('inactive')}
            className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Inactive</div>
            <div className="mt-1 text-xl font-semibold text-amber-600 group-hover:underline">{inactive}</div>
            <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tap to list inactive members</div>
          </Link>
        </div>

        {errorMsg && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
        )}

        {/* Results */}
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[hsl(var(--bg))] text-left">
                <tr>
                  <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Name</th>
                  <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Member&nbsp;ID</th>
                  <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Email</th>
                  <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Phone</th>
                  <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Joined</th>
                  <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'
                  return (
                    <tr key={m.user_id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))]">
                      <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{name}</div>
                          <div className="flex items-center gap-2">
                            <StatusBadge active={m.is_active} />
                            <AgeBadge dob={m.date_of_birth} />
                          </div>
                        </div>
                      </td>
                      <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                        <code className="text-xs">{m.member_id?.trim() || '—'}</code>
                      </td>
                      <td className="border-t border-[hsl(var(--border))] px-4 py-3">{m.email ?? '—'}</td>
                      <td className="border-t border-[hsl(var(--border))] px-4 py-3">{m.phone ?? '—'}</td>
                      <td className="border-t border-[hsl(var(--border))] px-4 py-3">{fmtDate(m.created_at)}</td>
                      <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                        <Link
                          prefetch={false}
                          href={`/members/${m.user_id}`}
                          className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--bg))]"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })}

                {rows.length === 0 && !errorMsg && (
                  <tr>
                    <td className="px-4 py-8 text-center text-[hsl(var(--muted))]" colSpan={6}>
                      {mode === 'search' ? 'No members found.' : 'No members to show.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer summary + pagination */}
          <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[hsl(var(--muted))]">
                {totalResults > 0 ? (
                  <span>
                    Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span>-<span className="font-medium">
                      {Math.min(page * pageSize, totalResults)}
                    </span>{' '}
                    of <span className="font-medium">{totalResults}</span>
                  </span>
                ) : (
                  <span>—</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Link
                  prefetch={false}
                  href={hrefForPage(Math.max(1, page - 1))}
                  className={`rounded-xl border px-3 py-1.5 hover:bg-white ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
                >
                  Prev
                </Link>
                <span className="text-[hsl(var(--muted))]">
                  Page <span className="font-medium">{page}</span> / <span className="font-medium">{totalPages}</span>
                </span>
                <Link
                  prefetch={false}
                  href={hrefForPage(Math.min(totalPages, page + 1))}
                  className={`rounded-xl border px-3 py-1.5 hover:bg-white ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
                >
                  Next
                </Link>
              </div>
            </div>
          </div>
        </Card>
      </Section>
    </main>
  )
}
