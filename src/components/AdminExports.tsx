// src/components/AdminExports.tsx
'use client'

import { useMemo, useState } from 'react'

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` // YYYY-MM-DD
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export default function AdminExports() {
  const [from, setFrom] = useState<string>(addDays(todayLocal(), -30))
  const [to, setTo] = useState<string>(todayLocal())

  const valid = useMemo(() => {
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  }, [from, to])

  const subsUrl = useMemo(() => {
    const p = new URLSearchParams({ from, to })
    return `/api/admin/export/subscriptions?${p.toString()}`
  }, [from, to])

  const attUrl = useMemo(() => {
    const p = new URLSearchParams({ from, to })
    return `/api/admin/export/attendance?${p.toString()}`
  }, [from, to])

  // Nouveau: export “Active now” (pas de période)
  const activeNowUrl = '/api/admin/export/active-now'

  return (
    <section className="rounded-xl border bg-white p-4 space-y-3">
      <h2 className="text-lg font-semibold">Exports</h2>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </label>

        <div className="ml-auto flex flex-wrap gap-2">
          <a
            href={subsUrl}
            className={`px-3 py-2 rounded border ${valid ? 'hover:bg-gray-50' : 'bg-gray-200 text-gray-500 pointer-events-none'}`}
            title="Export subscriptions (CSV)"
          >
            Export subscriptions (CSV)
          </a>
          <a
            href={attUrl}
            className={`px-3 py-2 rounded border ${valid ? 'hover:bg-gray-50' : 'bg-gray-200 text-gray-500 pointer-events-none'}`}
            title="Export attendance (CSV)"
          >
            Export attendance (CSV)
          </a>
          <a
            href={activeNowUrl}
            className="px-3 py-2 rounded border hover:bg-gray-50"
            title="Export subscriptions active now (CSV)"
          >
            Export active now (CSV)
          </a>
        </div>
      </div>

      <ul className="text-xs text-gray-500 list-disc pl-5 space-y-1">
        <li><b>Subscriptions</b> export filters by paid_at within the selected range.</li>
        <li><b>Attendance</b> export filters by date within the selected range.</li>
        <li><b>Active now</b> export filters by <code>start_date ≤ today ≤ end_date</code>, sessions with <code>end_date ≥ today</code> and remaining sessions &gt; 0.</li>
      </ul>
    </section>
  )
}
