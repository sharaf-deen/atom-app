// src/app/members/_components/MembersResults.tsx
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import { type Role } from '@/lib/session'
import { cairoToday } from '@/lib/cairoDate'

type Status = 'all' | 'active' | 'frozen' | 'inactive'
type InactiveReason = 'all' | 'expired' | 'cancelled' | 'no_membership' | 'depleted_legacy' | 'other_inactive'

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
  is_frozen?: boolean | null
  inactive_reason?: InactiveReason | null
}

type MemberRowWithTotal = MemberRow & { total_count?: number | string | null }

type Props = {
  q: string
  status: Status
  inactiveReason: InactiveReason
  page: number
  pageSize: number
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

  const [ty, tm, td] = cairoToday().split('-').map(Number)
  const today = new Date(Date.UTC(ty, tm - 1, td))
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  if (age < 0) return null
  return age
}

function StatusBadge({ active, frozen }: { active?: boolean | null; frozen?: boolean | null }) {
  if (frozen === true) {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
        Frozen
      </span>
    )
  }

  if (active === true) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        Active
      </span>
    )
  }

  if (active === false) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
        Inactive
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted))]">
      Unknown
    </span>
  )
}

function inactiveReasonLabel(reason?: InactiveReason | null) {
  switch (reason) {
    case 'expired':
      return 'Expired'
    case 'cancelled':
      return 'Cancelled'
    case 'no_membership':
      return 'No membership yet'
    case 'depleted_legacy':
      return 'Depleted legacy'
    case 'other_inactive':
      return 'Other inactive'
    default:
      return null
  }
}

function InactiveReasonBadge({ reason }: { reason?: InactiveReason | null }) {
  const label = inactiveReasonLabel(reason)
  if (!label) return null

  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      {label}
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

export default async function MembersResults({ q, status, inactiveReason, page, pageSize }: Props) {
  const admin = getSupabaseAdminClientCached()

  let rows: MemberRow[] = []
  let totalResults = 0
  let errorMsg: string | null = null
  const mode: 'search' | 'list' = q ? 'search' : 'list'

  try {
    const { data, error } = await admin.rpc('search_members_v4', {
      p_q: q || null,
      p_status: q ? 'all' : status,
      p_inactive_reason: q || status !== 'inactive' ? 'all' : inactiveReason,
      p_page: page,
      p_page_size: pageSize,
    })

    if (error) throw new Error(error.message)

    const list = (data ?? []) as MemberRowWithTotal[]
    totalResults = list.length ? Number(list[0]?.total_count ?? 0) : 0
    rows = list.map(({ total_count: _t, ...rest }) => rest)
  } catch (e: any) {
    errorMsg = e?.message || String(e)
    rows = []
    totalResults = 0
  }

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize))

  const base = new URLSearchParams()
  if (q) base.set('q', q)
  if (!q && status !== 'all') base.set('status', status)
  if (!q && status === 'inactive' && inactiveReason !== 'all') base.set('reason', inactiveReason)
  if (pageSize !== 20) base.set('pageSize', String(pageSize))

  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams(base)
    if (p > 1) sp.set('page', String(p))
    const s = sp.toString()
    return s ? `/members?${s}` : '/members'
  }

  return (
    <>
      {errorMsg ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
      ) : null}

      <div className="space-y-3">
        <div className="space-y-3 lg:hidden">
          {(rows ?? []).map((m) => {
            const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'
            return (
              <div
                key={m.user_id}
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] leading-5 truncate">{name}</div>
                    <div className="mt-1 text-[12px] text-[hsl(var(--muted))]">
                      ID: <code className="text-[11px]">{m.member_id?.trim() || '—'}</code>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge active={m.is_active} frozen={m.is_frozen} />
                    {m.is_active === false && m.is_frozen !== true ? <InactiveReasonBadge reason={m.inactive_reason} /> : null}
                    <AgeBadge dob={m.date_of_birth} />
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-[13px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Email</span>
                    <span className="min-w-0 text-right font-medium break-words whitespace-normal">
                      {m.email ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Phone</span>
                    <span className="min-w-0 text-right font-medium break-words whitespace-normal">
                      {m.phone ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Joined</span>
                    <span className="min-w-0 text-right font-medium">{fmtDate(m.created_at)}</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
                  <Link
                    prefetch={false}
                    href={`/members/${m.user_id}`}
                    className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-[hsl(var(--bg))]"
                  >
                    View
                  </Link>
                </div>
              </div>
            )
          })}

          {rows.length === 0 && !errorMsg ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center text-sm text-[hsl(var(--muted))] shadow-soft">
              {mode === 'search' ? 'No members found.' : 'No members to show.'}
            </div>
          ) : null}
        </div>

        <Card className="hidden lg:block p-0 overflow-hidden">
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
                          <StatusBadge active={m.is_active} frozen={m.is_frozen} />
                    {m.is_active === false && m.is_frozen !== true ? <InactiveReasonBadge reason={m.inactive_reason} /> : null}
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

              {rows.length === 0 && !errorMsg ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[hsl(var(--muted))]" colSpan={6}>
                    {mode === 'search' ? 'No members found.' : 'No members to show.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

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

        <div className="lg:hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-[hsl(var(--muted))]">
              {totalResults > 0 ? (
                <span>
                  Page <span className="font-semibold">{page}</span> / <span className="font-semibold">{totalPages}</span>
                </span>
              ) : (
                <span>—</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Link
                prefetch={false}
                href={hrefForPage(Math.max(1, page - 1))}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              >
                Prev
              </Link>
              <Link
                prefetch={false}
                href={hrefForPage(Math.min(totalPages, page + 1))}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              >
                Next
              </Link>
            </div>
          </div>

          {totalResults > 0 ? (
            <div className="mt-2 text-[11px] text-[hsl(var(--muted))]">
              Showing <span className="font-semibold">{(page - 1) * pageSize + 1}</span>-<span className="font-semibold">
                {Math.min(page * pageSize, totalResults)}
              </span>{' '}
              of <span className="font-semibold">{totalResults}</span>
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
