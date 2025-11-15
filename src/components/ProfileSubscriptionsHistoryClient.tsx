// src/components/ProfileSubscriptionsHistoryClient.tsx
'use client'

import { useMemo, useState } from 'react'
import type { SubRow } from './ProfileSubscriptions'

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const date = d.length <= 10 ? new Date(d + 'T00:00:00Z') : new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}
function fmtAmount(n?: number | null) {
  if (n == null) return '—'
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return Number(n).toFixed(2)
  }
}
function humanPlan(p: SubRow['plan']) {
  const map: Record<SubRow['plan'], string> = {
    '1m': '1 month',
    '3m': '3 months',
    '6m': '6 months',
    '12m': '12 months',
    'sessions': 'Per sessions',
  }
  return map[p] ?? p
}

type YearKey = 'all' | `${number}`

export default function ProfileSubscriptionsHistoryClient({
  rows,
  title = 'History',
  initiallyVisible = 5,
}: {
  rows: SubRow[]
  title?: string
  initiallyVisible?: number
}) {
  const thisYear = new Date().getFullYear()
  const years: `${number}`[] = useMemo(
    () => Array.from({ length: thisYear - 2024 + 1 }, (_, i) => String(2024 + i) as `${number}`),
    [thisYear]
  )

  const [openAll, setOpenAll] = useState(false)
  const [year, setYear] = useState<YearKey>('all')
  const [q, setQ] = useState('')

  function belongsToYear(row: SubRow, y: `${number}`): boolean {
    // On se base sur start_date de préférence, sinon paid_at, sinon end_date
    const s = row.start_date || row.paid_at || row.end_date
    if (!s) return false
    const key = s.length <= 10 ? s : s.slice(0, 10) // YYYY-MM-DD
    return key.startsWith(`${y}-`)
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (year !== 'all' && !belongsToYear(r, year as `${number}`)) return false
      if (!needle) return true
      const fields = [
        humanPlan(r.plan).toLowerCase(),
        (r.status || '').toLowerCase(),
        (r.subscription_type || '').toLowerCase(),
        (r.start_date || '').toLowerCase(),
        (r.end_date || '').toLowerCase(),
      ]
      return fields.some((f) => f.includes(needle))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, year, q])

  const visible = useMemo(() => {
    if (openAll) return filtered
    return filtered.slice(0, initiallyVisible)
  }, [filtered, openAll, initiallyVisible])

  const hasMore = filtered.length > initiallyVisible
  const totalCount = rows.length
  const filteredCount = filtered.length

  return (
    <section className="space-y-3">
      {/* Header + actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>

        {/* Year filter (All + 2024..current) */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-4">
          <select
            value={year}
            onChange={(e) => setYear(e.target.value as YearKey)}
            className="px-2 py-1.5 border rounded"
            aria-label="Year"
          >
            <option value="all">All</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search plan / status…"
            className="px-3 py-1.5 border rounded w-[220px]"
          />
          {hasMore && (
            <button
              onClick={() => setOpenAll((v) => !v)}
              className="text-xs underline hover:opacity-80"
              aria-expanded={openAll}
            >
              {openAll ? 'Show less' : `Show more (${filtered.length - initiallyVisible})`}
            </button>
          )}
        </div>
      </div>

      {/* Counters */}
      <div className="text-xs text-gray-600">
        {filteredCount}/{totalCount} items
        {year !== 'all' && <span className="ml-2 text-gray-500">(year {year})</span>}
        {q.trim() && <span className="ml-2 text-gray-500">(search “{q.trim()}”)</span>}
      </div>

      {/* List */}
      <div className="grid gap-3">
        {visible.map((row) => (
          <details key={row.id} className="rounded-xl border bg-white p-3 open:shadow-sm group">
            <summary className="list-none cursor-pointer">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50">
                  {humanPlan(row.plan)}
                </span>
                <span className="text-xs text-gray-500">
                  {fmtDate(row.start_date)} → {fmtDate(row.end_date)}
                </span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full border bg-gray-50">
                  {row.status ?? '—'}
                </span>
              </div>
            </summary>

            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <div className="text-gray-500">Amount</div>
                <div className="font-medium">{fmtAmount(row.amount)}</div>
              </div>
              <div>
                <div className="text-gray-500">Paid at</div>
                <div className="font-medium">{fmtDate(row.paid_at)}</div>
              </div>
              <div>
                <div className="text-gray-500">Type</div>
                <div className="font-medium capitalize">{row.subscription_type || '—'}</div>
              </div>

              {row.plan === 'sessions' && (
                <>
                  <div>
                    <div className="text-gray-500">Total sessions</div>
                    <div className="font-medium">{row.sessions_total ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Used</div>
                    <div className="font-medium">{row.sessions_used ?? 0}</div>
                  </div>
                </>
              )}
            </div>
          </details>
        ))}

        {visible.length === 0 && (
          <div className="text-sm text-gray-500 border rounded-xl p-3 bg-white">
            No results with current filters.
          </div>
        )}
      </div>
    </section>
  )
}
