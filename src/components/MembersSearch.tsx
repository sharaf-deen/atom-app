// src/components/MembersSearch.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import SubscribeDialog, { type Plan } from '@/components/SubscribeDialog'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

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

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const date = d.length <= 10 ? new Date(d + 'T00:00:00Z') : new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

export default function MembersSearch({ isStaff = false }: { isStaff?: boolean }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [rows, setRows] = useState<MemberRow[]>([])
  const abortRef = useRef<AbortController | null>(null)

  async function runSearch(signal?: AbortSignal) {
    setLoading(true)
    setErr('')
    try {
      const r = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
        signal,
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setErr(j?.error || 'Search failed')
        setRows([])
        return
      }
      setRows(j.items as MemberRow[])
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(String(e?.message || e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  // initial fetch
  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    runSearch(ctrl.signal)
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasData = rows.length > 0

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runSearch()
    }
  }

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
            <Button onClick={() => runSearch()} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setQ('')
                runSearch()
              }}
              disabled={loading}
            >
              Reset
            </Button>
          </div>
        </div>

        {/* État d'erreur */}
        {err && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* État vide */}
        {!hasData && !loading && !err && (
          <p className="mt-3 text-sm text-[hsl(var(--muted))]">No members found.</p>
        )}

        {/* Résultats */}
        {hasData && (
          <div className="mt-4">
            {/* Desktop: table */}
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
                    return (
                      <tr key={m.user_id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))]">
                        <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                          <div className="font-medium">{name}</div>
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
            <div className="md:hidden space-y-3">
              {rows.map((m) => {
                const name = [m.first_name ?? '', m.last_name ?? ''].join(' ').trim() || '—'
                return (
                  <div
                    key={m.user_id}
                    className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
                  >
                    <div className="mb-2">
                      <div className="text-sm text-[hsl(var(--muted))]">Name</div>
                      <div className="font-medium">{name}</div>
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
