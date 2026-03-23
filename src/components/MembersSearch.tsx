// src/components/MembersSearch.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SubscribeDialog, { type Plan } from '@/components/SubscribeDialog'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'

type Role =
  | 'member'
  | 'champion'
  | 'vip'
  | 'assistant_coach'
  | 'coach'
  | 'head_coach'
  | 'reception'
  | 'admin'
  | 'super_admin'

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

type MembersStats = {
  total: number
  active: number
  inactive: number
}

type Mode = 'idle' | 'search' | 'list'

type ListKind = 'all' | 'active' | 'inactive'

const PAGE_SIZE = 20

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const date = d.length <= 10 ? new Date(d + 'T00:00:00Z') : new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
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

function ageGroup(dob?: string | null) {
  const age = ageYears(dob)
  if (age === null) return null
  return age < 17 ? 'Kid' : 'Adult'
}

function AgeBadge({ dob }: { dob?: string | null }) {
  const g = ageGroup(dob ?? null)
  if (!g) return null

  const isKid = g === 'Kid'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        isKid ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-violet-200 bg-violet-50 text-violet-700'
      }`}
      title={dob ? `Date of birth: ${dob}` : undefined}
    >
      {g}
    </span>
  )
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

function listLabel(kind: ListKind) {
  if (kind === 'all') return 'All members'
  if (kind === 'active') return 'Active members'
  return 'Inactive members'
}

function listSummaryLabel(kind: ListKind) {
  if (kind === 'all') return 'member'
  if (kind === 'active') return 'active member'
  return 'inactive member'
}

function resolveActive(mode: Mode, listKind: ListKind, active?: boolean | null) {
  if (active === true || active === false) return active
  if (mode !== 'list') return active
  if (listKind === 'active') return true
  if (listKind === 'inactive') return false
  return active
}

export default function MembersSearch({ isStaff = false }: { isStaff?: boolean }) {
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<Mode>('idle')
  const [listKind, setListKind] = useState<ListKind>('all')

  const [rows, setRows] = useState<MemberRow[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')

  // Stats globales
  const [stats, setStats] = useState<MembersStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsErr, setStatsErr] = useState<string | null>(null)

  // Pagination (utilisée pour search & lists)
  const [page, setPage] = useState(1)
  const [totalResults, setTotalResults] = useState<number | null>(null)

  const hasData = rows.length > 0

  const totalPages = useMemo(() => {
    if (!totalResults || totalResults <= 0) return 1
    return Math.max(1, Math.ceil(totalResults / PAGE_SIZE))
  }, [totalResults])

  const rangeText = useMemo(() => {
    if (!hasSearched || mode === 'idle') return null
    const total = totalResults ?? rows.length
    if (!total || total <= 0) return null
    const start = (page - 1) * PAGE_SIZE + 1
    const end = start + rows.length - 1
    return `Showing ${start}-${Math.max(start, end)} of ${total}`
  }, [hasSearched, mode, page, rows.length, totalResults])

  async function loadStats() {
    try {
      setStatsLoading(true)
      setStatsErr(null)

      const r = await fetch(`/api/members/stats?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({} as any))

      if (!r.ok || !j?.ok) {
        setStatsErr(j?.error || 'Failed to load stats')
        setStats(null)
        return
      }

      setStats({
        total: j.total ?? 0,
        active: j.active ?? 0,
        inactive: j.inactive ?? 0,
      })
    } catch (e: any) {
      setStatsErr(String(e?.message || e))
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Make the top-right header Reload button actually refresh this client list
  useEffect(() => {
    const onReload = () => {
      refreshAll()
    }
    window.addEventListener('atom:reload', onReload as any)
    return () => window.removeEventListener('atom:reload', onReload as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, listKind, page, q])

  async function runSearch(targetPage = 1) {
    const query = q.trim()

    if (!query) {
      handleReset()
      return
    }

    setLoading(true)
    setErr('')

    try {
      const url = `/api/members/search?q=${encodeURIComponent(query)}&page=${targetPage}&limit=${PAGE_SIZE}&ts=${Date.now()}`
      const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const j = await r.json().catch(() => ({} as any))

      if (!r.ok || !j?.ok) {
        setErr(j?.error || 'Search failed')
        setRows([])
        setTotalResults(0)
        setPage(1)
        setMode('search')
        setHasSearched(true)
        return
      }

      const items = (j.items ?? []) as MemberRow[]
      setRows(items)
      setTotalResults(typeof j.total === 'number' ? j.total : items.length)
      setPage(typeof j.page === 'number' ? j.page : targetPage)
      setMode('search')
      setHasSearched(true)
    } catch (e: any) {
      setErr(String(e?.message || e))
      setRows([])
      setTotalResults(0)
      setPage(1)
      setMode('search')
      setHasSearched(true)
    } finally {
      setLoading(false)
    }
  }

  async function loadList(kind: ListKind, targetPage = 1) {
    setLoading(true)
    setErr('')

    try {
      const url = `/api/members/list?status=${encodeURIComponent(kind)}&page=${targetPage}&limit=${PAGE_SIZE}&ts=${Date.now()}`
      const r = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({} as any))

      if (!r.ok || !j?.ok) {
        setErr(j?.error || `Failed to load ${kind} members`)
        setRows([])
        setTotalResults(0)
        setPage(1)
        setMode('list')
        setListKind(kind)
        setHasSearched(true)
        return
      }

      const items = (j.items ?? []) as MemberRow[]
      setRows(items)
      setTotalResults(typeof j.total === 'number' ? j.total : items.length)
      setPage(typeof j.page === 'number' ? j.page : targetPage)
      setMode('list')
      setListKind(kind)
      setHasSearched(true)
    } catch (e: any) {
      setErr(String(e?.message || e))
      setRows([])
      setTotalResults(0)
      setPage(1)
      setMode('list')
      setListKind(kind)
      setHasSearched(true)
    } finally {
      setLoading(false)
    }
  }

  async function refreshAll() {
    await loadStats()
    if (mode === 'list') return loadList(listKind, page)
    if (mode === 'search') return runSearch(page)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runSearch(1)
    }
  }

  function handleReset() {
    setQ('')
    setRows([])
    setErr('')
    setHasSearched(false)
    setMode('idle')
    setListKind('all')
    setPage(1)
    setTotalResults(null)
  }

  function goPrev() {
    if (page <= 1) return
    if (mode === 'list') return loadList(listKind, page - 1)
    if (mode === 'search') return runSearch(page - 1)
  }

  function goNext() {
    if (page >= totalPages) return
    if (mode === 'list') return loadList(listKind, page + 1)
    if (mode === 'search') return runSearch(page + 1)
  }

  return (
    <Card hover={true}>
      <CardHeader className="items-start">
        <CardTitle>Search members</CardTitle>
      </CardHeader>

      <CardContent>
        {/* Search bar */}
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 sm:max-w-md">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search by name, email, phone or member id…"
              aria-label="Search members"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runSearch(1)} disabled={loading}>
              {loading && mode === 'search' ? 'Searching…' : 'Search'}
            </Button>

            <Button variant="outline" onClick={handleReset} disabled={loading}>
              Reset
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4">
          {statsLoading && (
            <p className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
              Loading members stats…
            </p>
          )}

          {statsErr && !statsLoading && (
            <p className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              Error loading stats: {statsErr}
            </p>
          )}

          {stats && !statsLoading && !statsErr && (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => loadList('all', 1)}
                  className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/60"
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    Total members
                  </div>
                  <div className="mt-1 text-xl font-semibold group-hover:underline">{stats.total}</div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tap to list all members</div>
                </button>

                <button
                  type="button"
                  onClick={() => loadList('active', 1)}
                  className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/60"
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    Active
                  </div>
                  <div className="mt-1 text-xl font-semibold text-emerald-600 group-hover:underline">
                    {stats.active}
                  </div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tap to list active members</div>
                </button>

                <button
                  type="button"
                  onClick={() => loadList('inactive', 1)}
                  className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/60"
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    Inactive
                  </div>
                  <div className="mt-1 text-xl font-semibold text-amber-600 group-hover:underline">
                    {stats.inactive}
                  </div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tap to list inactive members</div>
                </button>
              </div>

              <p className="mt-2 text-[11px] text-[hsl(var(--muted))]">
                You can search a member, or use the cards above to list members.
              </p>
            </>
          )}
        </div>

        {/* Error */}
        {err && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* Summary */}
        {hasSearched && !loading && !err && (
          <div className="mt-3 flex flex-col gap-1 text-sm text-[hsl(var(--muted))]">
            {rangeText ? <p>{rangeText}</p> : null}
            <p>
              {mode === 'list'
                ? hasData
                  ? `${totalResults ?? rows.length} ${listSummaryLabel(listKind)}${
                      (totalResults ?? rows.length) > 1 ? 's' : ''
                    } total.`
                  : `No ${listLabel(listKind).toLowerCase()}.`
                : hasData
                  ? `${totalResults ?? rows.length} member${(totalResults ?? rows.length) > 1 ? 's' : ''} found.`
                  : 'No members found.'}
            </p>
          </div>
        )}

        {/* Results */}
        {hasData && (
          <div className="mt-4">
            {/* Desktop */}
            <div className="hidden overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:block">
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
                    const name = [m.first_name ?? '', m.last_name ?? ''].join(' ').trim() || '—'
                    const resolved = resolveActive(mode, listKind, m.is_active)
                    const canSubscribe = isStaff && resolved === false // ✅ only inactive members can be subscribed
                    return (
                      <tr key={m.user_id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))]">
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{name}</div>
                            <div className="flex items-center gap-2">
                              <StatusBadge active={resolved} />
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
                          <div className="flex flex-wrap items-center gap-2">
                            <Button asChild variant="outline" size="sm" className="px-2">
                              <Link prefetch={false} href={`/members/${m.user_id}`}>View</Link>
                            </Button>

                            {canSubscribe && (
                              <SubscribeDialog
                                member={{
                                  user_id: m.user_id,
                                  email: m.email,
                                  first_name: m.first_name,
                                  last_name: m.last_name,
                                }}
                                defaultPlan={'1m' as Plan}
                                defaultSessions={10}
                                buttonLabel="Subscribe"
                                onCreated={() => {
                                  refreshAll()
                                }}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="space-y-3 md:hidden">
              {rows.map((m) => {
                const name = [m.first_name ?? '', m.last_name ?? ''].join(' ').trim() || '—'
                const resolved = resolveActive(mode, listKind, m.is_active)
                const canSubscribe = isStaff && resolved === false // ✅ only inactive members can be subscribed
                return (
                  <div
                    key={m.user_id}
                    className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
                  >
                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">Name</div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{name}</div>
                        <div className="flex items-center gap-2">
                          <StatusBadge active={resolved} />
                          <AgeBadge dob={m.date_of_birth} />
                        </div>
                      </div>
                    </div>

                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">Member ID</div>
                      <code className="font-medium">{m.member_id?.trim() || '—'}</code>
                    </div>

                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">Email</div>
                      <div className="font-medium">{m.email ?? '—'}</div>
                    </div>

                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">Phone</div>
                      <div className="font-medium">{m.phone ?? '—'}</div>
                    </div>

                    <div className="mb-3">
                      <div className="text-sm text-[hsl(var(--muted))]">Joined</div>
                      <div className="font-medium">{fmtDate(m.created_at)}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm" className="px-2">
                        <Link prefetch={false} href={`/members/${m.user_id}`}>View</Link>
                      </Button>

                      {canSubscribe && (
                        <SubscribeDialog
                          member={{
                            user_id: m.user_id,
                            email: m.email,
                            first_name: m.first_name,
                            last_name: m.last_name,
                          }}
                          defaultPlan={'1m' as Plan}
                          defaultSessions={10}
                          buttonLabel="Subscribe"
                          onCreated={() => {
                            refreshAll()
                          }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination (search + list) */}
            {totalResults !== null && totalResults > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between text-xs text-[hsl(var(--muted))]">
                <span>
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={goPrev}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={goNext}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
