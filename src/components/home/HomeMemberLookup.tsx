'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import InlineAlert from '@/components/ui/InlineAlert'

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

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const date = d.length <= 10 ? new Date(`${d}T00:00:00Z`) : new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date)
}

function ageYears(dob?: string | null) {
  if (!dob) return null
  const dateOnly = dob.length === 10 ? dob : dob.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null
  const [y, m, d] = dateOnly.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(born.getTime())) return null

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

function StatusBadge({ active }: { active?: boolean | null }) {
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

function AgeBadge({ dob }: { dob?: string | null }) {
  const group = ageGroup(dob)
  const age = ageYears(dob)
  if (!group || age === null) return null

  const tone = group === 'Kid'
    ? 'border-sky-200 bg-sky-50 text-sky-700'
    : 'border-violet-200 bg-violet-50 text-violet-700'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {group} · {age}y
    </span>
  )
}

export default function HomeMemberLookup({
  title = 'Quick member lookup',
  subtitle: _subtitle = 'Search a member by name, member ID or phone.',
  canOpenProfile = false,
  showSensitiveFields = true,
}: {
  title?: string
  subtitle?: string
  canOpenProfile?: boolean
  showSensitiveFields?: boolean
}) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [items, setItems] = useState<MemberRow[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)

  const trimmed = q.trim()

  const helperText = useMemo(() => {
    if (loading) return 'Searching…'
    if (!hasSearched) return 'Tip: this lookup is made for fast checks on mobile.'
    if (error) return ''
    if (!items.length) return 'No members found.'
    return `${items.length} result${items.length > 1 ? 's' : ''} shown.`
  }, [error, hasSearched, items.length, loading])

  function resetLookup({ keepQuery = false }: { keepQuery?: boolean } = {}) {
    abortRef.current?.abort()
    abortRef.current = null
    requestSeqRef.current += 1
    setLoading(false)
    setError('')
    setHasSearched(false)
    setItems([])
    if (!keepQuery) setQ('')
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  async function runSearch() {
    const query = trimmed
    if (!query) {
      setItems([])
      setError('')
      setHasSearched(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq

    setLoading(true)
    setError('')
    setHasSearched(true)

    try {
      const r = await fetch(`/api/members/search?q=${encodeURIComponent(query)}&limit=5`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const j = await r.json().catch(() => ({} as any))
      if (requestSeq !== requestSeqRef.current) return

      if (!r.ok || !j?.ok) {
        setError(j?.error || 'Search failed')
        setItems([])
        return
      }

      setItems(Array.isArray(j.items) ? (j.items as MemberRow[]) : [])
    } catch (e: any) {
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return
      setError(String(e?.message || e))
      setItems([])
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false)
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }

  return (
    <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch()
              }
              if (e.key === 'Escape' && (q || hasSearched || items.length)) {
                e.preventDefault()
                resetLookup()
              }
            }}
            placeholder="Search member…"
            aria-label="Search member"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={runSearch} disabled={loading || !trimmed} loading={loading} loadingText="Searching…">
            Search
          </Button>
          <Button
            variant="outline"
            disabled={!loading && !q && !hasSearched && !items.length}
            onClick={() => resetLookup()}
          >
            {loading ? 'Stop / Reset' : 'Reset'}
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {helperText ? (
          <InlineAlert compact variant={loading ? 'info' : hasSearched && !items.length && !error ? 'warning' : 'info'}>
            {helperText}
          </InlineAlert>
        ) : null}
        {error ? (
          <InlineAlert variant="error">{error}</InlineAlert>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {items.map((m) => {
            const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'
            return (
              <div
                key={m.user_id}
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-5">{name}</div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">
                      ID: <code>{m.member_id?.trim() || '—'}</code>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge active={m.is_active} />
                    <AgeBadge dob={m.date_of_birth} />
                  </div>
                </div>

                <div className="mt-3 grid gap-1 text-[13px]">
                  {showSensitiveFields ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Phone</span>
                        <span className="min-w-0 text-right font-medium break-words whitespace-normal">{m.phone ?? '—'}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Email</span>
                        <span className="min-w-0 text-right font-medium break-words whitespace-normal">{m.email ?? '—'}</span>
                      </div>
                    </>
                  ) : null}

                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Joined</span>
                    <span className="font-medium">{fmtDate(m.created_at)}</span>
                  </div>
                </div>

                {canOpenProfile ? (
                  <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
                    <Button asChild href={`/members/${m.user_id}`} variant="outline" size="sm">
                      Open profile
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}