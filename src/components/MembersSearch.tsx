// src/components/MembersSearch.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import SubscribeDialog, { type Plan } from '@/components/SubscribeDialog'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'

type Role =
  | 'member'
  | 'assistant_coach'
  | 'coach'
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
}

type MembersStats = {
  total: number
  active: number
  inactive: number
}

type Mode = 'idle' | 'search' | 'inactive'

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

export default function MembersSearch({ isStaff = false }: { isStaff?: boolean }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [rows, setRows] = useState<MemberRow[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')

  // Stats globales
  const [stats, setStats] = useState<MembersStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsErr, setStatsErr] = useState<string | null>(null)

  // Pagination pour la liste des inactifs
  const [page, setPage] = useState(1)
  const [totalResults, setTotalResults] = useState<number | null>(null)

  const hasData = rows.length > 0

  // Charger les stats au montage
  useEffect(() => {
    async function loadStats() {
      try {
        setStatsLoading(true)
        setStatsErr(null)
        const r = await fetch('/api/members/stats', {
          headers: { Accept: 'application/json' },
        })
        const j = await r.json()
        if (!r.ok || !j.ok) {
          setStatsErr(j?.error || 'Failed to load stats')
          setStats(null)
        } else {
          setStats({
            total: j.total ?? 0,
            active: j.active ?? 0,
            inactive: j.inactive ?? 0,
          })
        }
      } catch (e: any) {
        setStatsErr(String(e?.message || e))
        setStats(null)
      } finally {
        setStatsLoading(false)
      }
    }

    loadStats()
  }, [])

  async function runSearch() {
    if (!q.trim()) {
      setRows([])
      setHasSearched(true)
      setMode('search')
      setTotalResults(0)
      setPage(1)
      return
    }

    setLoading(true)
    setErr('')
    try {
      const r = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setErr(j?.error || 'Search failed')
        setRows([])
        setTotalResults(0)
      } else {
        setRows(j.items as MemberRow[])
        setTotalResults((j.items as MemberRow[])?.length ?? 0)
      }
      setMode('search')
    } catch (e: any) {
      setErr(String(e?.message || e))
      setRows([])
      setTotalResults(0)
    } finally {
      setLoading(false)
      setHasSearched(true)
      setPage(1)
    }
  }

  async function loadInactive(targetPage = 1) {
    setLoading(true)
    setErr('')
    try {
      const r = await fetch(`/api/members/inactive?page=${targetPage}`, {
        headers: { Accept: 'application/json' },
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setErr(j?.error || 'Failed to load inactive members')
        setRows([])
        setTotalResults(0)
      } else {
        setRows(j.items as MemberRow[])
        setTotalResults(j.total ?? (j.items as MemberRow[])?.length ?? 0)
        setPage(j.page ?? targetPage)
      }
      setMode('inactive')
    } catch (e: any) {
      setErr(String(e?.message || e))
      setRows([])
      setTotalResults(0)
    } finally {
      setLoading(false)
      setHasSearched(true)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runSearch()
    }
  }

  function handleReset() {
    setQ('')
    setRows([])
    setErr('')
    setHasSearched(false)
    setMode('idle')
    setPage(1)
    setTotalResults(null)
  }

  const totalPages =
    totalResults && totalResults > 0 ? Math.ceil(totalResults / PAGE_SIZE) : 1

  return (
    <Card hover>
      <CardHeader className="items-start">
        <CardTitle>Search members</CardTitle>
      </CardHeader>

      <CardContent>
        {/* Barre de recherche */}
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
          <div className="flex gap-2">
            <Button onClick={runSearch} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={loading}>
              Reset
            </Button>
          </div>
        </div>

        {/* Bloc stats globales redesign */}
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
                {/* Total */}
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 shadow-soft">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    Total members
                  </div>
                  <div className="mt-1 text-xl font-semibold">{stats.total}</div>
                </div>

                {/* Active */}
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 shadow-soft">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    Active
                  </div>
                  <div className="mt-1 text-xl font-semibold text-emerald-600">
                    {stats.active}
                  </div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">
                    Active subscriptions (time or sessions)
                  </div>
                </div>

                {/* Inactive (cliquable) */}
                <button
                  type="button"
                  onClick={() => loadInactive(1)}
                  className="group flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/60"
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    Inactive
                  </div>
                  <div className="mt-1 text-xl font-semibold text-amber-600 group-hover:underline">
                    {stats.inactive}
                  </div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">
                    Tap to list inactive members (20 per page)
                  </div>
                </button>
              </div>

              <p className="mt-2 text-[11px] text-[hsl(var(--muted))]">
                Start by searching a member or tap on <span className="font-semibold">Inactive</span> to
                see the full inactive list.
              </p>
            </>
          )}
        </div>

        {/* État d'erreur pour la recherche */}
        {err && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* Résumé après recherche ou clic "inactive" */}
        {hasSearched && !loading && !err && (
          <p className="mt-3 text-sm text-[hsl(var(--muted))]">
            {mode === 'inactive'
              ? hasData
                ? `${totalResults ?? rows.length} inactive member${
                    (totalResults ?? rows.length) > 1 ? 's' : ''
                  } in total.`
                : 'No inactive members.'
              : hasData
              ? `${rows.length} member${rows.length > 1 ? 's' : ''} found for this search.`
              : 'No members found for this search.'}
          </p>
        )}

        {/* Résultats */}
        {hasData && (
          <div className="mt-4">
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:block">
              <table className="w-full text-sm">
                <thead className="bg-[hsl(var(--bg))] text-left">
                  <tr>
                    <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">
                      Name
                    </th>
                    <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">
                      Member&nbsp;ID
                    </th>
                    <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">
                      Email
                    </th>
                    <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">
                      Phone
                    </th>
                    <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">
                      Joined
                    </th>
                    <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const name =
                      [m.first_name ?? '', m.last_name ?? ''].join(' ').trim() ||
                      '—'
                    return (
                      <tr
                        key={m.user_id}
                        className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))]"
                      >
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          <div className="font-medium">{name}</div>
                        </td>
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          <code className="text-xs">
                            {m.member_id?.trim() || '—'}
                          </code>
                        </td>
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          {m.email ?? '—'}
                        </td>
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          {m.phone ?? '—'}
                        </td>
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          {fmtDate(m.created_at)}
                        </td>
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="px-2"
                            >
                              <Link href={`/members/${m.user_id}`}>View</Link>
                            </Button>
                            {isStaff && (
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

            {/* Mobile: cartes */}
            <div className="space-y-3 md:hidden">
              {rows.map((m) => {
                const name =
                  [m.first_name ?? '', m.last_name ?? ''].join(' ').trim() ||
                  '—'
                return (
                  <div
                    key={m.user_id}
                    className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
                  >
                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">
                        Name
                      </div>
                      <div className="font-medium">{name}</div>
                    </div>

                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">
                        Member ID
                      </div>
                      <code className="font-medium">
                        {m.member_id?.trim() || '—'}
                      </code>
                    </div>

                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">
                        Email
                      </div>
                      <div className="font-medium">{m.email ?? '—'}</div>
                    </div>
                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">
                        Phone
                      </div>
                      <div className="font-medium">{m.phone ?? '—'}</div>
                    </div>
                    <div className="mb-3">
                      <div className="text-sm text-[hsl(var(--muted))]">
                        Joined
                      </div>
                      <div className="font-medium">
                        {fmtDate(m.created_at)}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="px-2"
                      >
                        <Link href={`/members/${m.user_id}`}>View</Link>
                      </Button>
                      {isStaff && (
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
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination pour les inactifs */}
            {mode === 'inactive' &&
              totalResults !== null &&
              totalResults > PAGE_SIZE && (
                <div className="mt-4 flex items-center justify-between text-xs text-[hsl(var(--muted))]">
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || loading}
                      onClick={() => loadInactive(page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || loading}
                      onClick={() => loadInactive(page + 1)}
                    >
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
