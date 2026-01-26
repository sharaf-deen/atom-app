// src/components/CoachesManager.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'

type Role = 'coach' | 'assistant_coach'
type TargetRole = Role | 'member'

type CoachRow = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  created_at: string | null
  member_id: string | null
}

type Kind = 'all' | 'coach' | 'assistant_coach'

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

function fullName(r: CoachRow) {
  const n = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
  return n || r.email || r.member_id || '—'
}

export default function CoachesManager({ viewerRole }: { viewerRole: string }) {
  const canManage = viewerRole === 'super_admin'

  const [kind, setKind] = useState<Kind>('all')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<CoachRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState<number>(0)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const totalPages = useMemo(() => {
    if (!total || total <= 0) return 1
    return Math.max(1, Math.ceil(total / PAGE_SIZE))
  }, [total])

  const rangeText = useMemo(() => {
    if (!total || total <= 0) return null
    const start = (page - 1) * PAGE_SIZE + 1
    const end = start + rows.length - 1
    return `Showing ${start}-${Math.max(start, end)} of ${total}`
  }, [page, rows.length, total])

  async function load(targetPage = 1) {
    setLoading(true)
    setErr('')

    try {
      const url = new URL('/api/coaches/list', window.location.origin)
      url.searchParams.set('kind', kind)
      url.searchParams.set('page', String(targetPage))
      url.searchParams.set('limit', String(PAGE_SIZE))
      const query = q.trim()
      if (query) url.searchParams.set('q', query)

      const r = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => ({} as any))

      if (!r.ok || !j?.ok) {
        setRows([])
        setTotal(0)
        setPage(1)
        setErr(j?.error || 'Failed to load coaches')
        return
      }

      const items = (j.items ?? []) as CoachRow[]
      setRows(items)
      setTotal(typeof j.total === 'number' ? j.total : items.length)
      setPage(typeof j.page === 'number' ? j.page : targetPage)
    } catch (e: any) {
      setRows([])
      setTotal(0)
      setPage(1)
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  async function setRole(user_id: string, role: TargetRole) {
    if (!canManage) {
      setErr('FORBIDDEN')
      return
    }

    setUpdatingId(user_id)
    setErr('')

    try {
      const r = await fetch('/api/coaches/update-role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ user_id, role }),
      })

      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j?.ok) {
        setErr(j?.error || 'Failed to update role')
        return
      }

      if (role === 'member') {
        // Remove from the list immediately
        setRows((prev) => prev.filter((x) => x.user_id !== user_id))
        setTotal((t) => (typeof t === 'number' ? Math.max(0, t - 1) : t))
        // Refresh the current page to keep pagination consistent
        load(page)
      } else {
        setRows((prev) =>
          prev.map((x) => (x.user_id === user_id ? { ...x, role } : x)),
        )
      }
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setUpdatingId(null)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  function onSearch() {
    load(1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSearch()
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <Input
                label="Search coaches"
                placeholder="Name, email, phone, member id"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onSearch} disabled={loading}>
                Search
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setQ('')
                  // Keep current kind
                  load(1)
                }}
                disabled={loading}
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant={kind === 'all' ? 'solid' : 'outline'}
              size="sm"
              onClick={() => {
                setKind('all')
                setPage(1)
              }}
              disabled={loading}
            >
              All
            </Button>
            <Button
              variant={kind === 'coach' ? 'solid' : 'outline'}
              size="sm"
              onClick={() => {
                setKind('coach')
                setPage(1)
              }}
              disabled={loading}
            >
              Coaches
            </Button>
            <Button
              variant={kind === 'assistant_coach' ? 'solid' : 'outline'}
              size="sm"
              onClick={() => {
                setKind('assistant_coach')
                setPage(1)
              }}
              disabled={loading}
            >
              Assistant Coaches
            </Button>
          </div>

          {!canManage && (
            <div className="mt-3 text-xs text-[hsl(var(--muted))]">
              Only <span className="font-medium">Super Admin</span> can promote, demote, or remove coaches.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-[hsl(var(--muted))]">
              {rangeText ?? (loading ? 'Loading…' : total === 0 ? 'No coaches found.' : null)}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(Math.max(1, page - 1))}
                disabled={loading || page <= 1}
              >
                Prev
              </Button>
              <div className="text-sm">
                {page} / {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(Math.min(totalPages, page + 1))}
                disabled={loading || page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>

          {err && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </div>
          )}

          <div className="mt-4 divide-y divide-[hsl(var(--border))] rounded-2xl border border-[hsl(var(--border))]">
            <div className="grid grid-cols-1 gap-2 px-4 py-3 text-xs font-medium text-[hsl(var(--muted))] sm:grid-cols-12">
              <div className="sm:col-span-3">Name</div>
              <div className="sm:col-span-3">Email</div>
              <div className="sm:col-span-2">Phone</div>
              <div className="sm:col-span-2">Joined</div>
              <div className="sm:col-span-2 text-right">Actions</div>
            </div>

            {rows.map((r) => {
              const isBusy = updatingId === r.user_id
              const nextRole: Role = r.role === 'coach' ? 'assistant_coach' : 'coach'
              const actionLabel = r.role === 'coach' ? 'Demote' : 'Promote'
              const actionHint =
                r.role === 'coach' ? 'Demote to Assistant Coach' : 'Promote to Coach'

              return (
                <div
                  key={r.user_id}
                  className="grid grid-cols-1 gap-2 px-4 py-3 text-sm sm:grid-cols-12 sm:items-center"
                >
                  <div className="sm:col-span-3">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{fullName(r)}</div>
                      <Badge
                        className={
                          r.role === 'coach'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-blue-200 bg-blue-50 text-blue-700'
                        }
                      >
                        {r.role === 'coach' ? 'Coach' : 'Assistant'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {r.member_id ? `Member ID: ${r.member_id}` : '—'}
                    </div>
                  </div>

                  <div className="sm:col-span-3 text-[hsl(var(--muted))]">{r.email ?? '—'}</div>
                  <div className="sm:col-span-2 text-[hsl(var(--muted))]">{r.phone ?? '—'}</div>
                  <div className="sm:col-span-2 text-[hsl(var(--muted))]">{fmtDate(r.created_at)}</div>

                  <div className="sm:col-span-2 sm:text-right">
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Link href={`/members/${r.user_id}`} className="inline-block">
                        <Button variant="outline" size="sm" disabled={loading || isBusy}>
                          Open
                        </Button>
                      </Link>
                      {canManage && (
                        <>


                      <Button
                        variant={r.role === 'assistant_coach' ? 'solid' : 'outline'}
                        size="sm"
                        disabled={loading || isBusy || !r.role}
                        title={actionHint}
                        onClick={() => {
                          if (!r.role) return
                          const ok = window.confirm(
                            `${actionHint} for ${fullName(r)}?`,
                          )
                          if (!ok) return
                          setRole(r.user_id, nextRole)
                        }}
                      >
                        {isBusy ? 'Working…' : actionLabel}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || isBusy || !r.role}
                        title="Remove from coaches (set role to member)"
                        onClick={() => {
                          if (!r.role) return
                          const ok = window.confirm(
                            `Remove ${fullName(r)} from coaches? (Role will be set to member)`,
                          )
                          if (!ok) return
                          setRole(r.user_id, 'member')
                        }}
                        className="border-red-200 text-red-700 hover:bg-red-50"
                      >
                        {isBusy ? 'Working…' : 'Remove'}
                      </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {!canManage && (
            <div className="mt-3 text-xs text-[hsl(var(--muted))]">
              Only <span className="font-medium">Super Admin</span> can promote, demote, or remove coaches.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
