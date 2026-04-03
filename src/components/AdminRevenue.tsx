// src/components/AdminRevenue.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'
type RevenueMode = 'cash' | 'recognized'
type RevenueResp =
  | {
      ok: true
      range: { from: string; to: string; days: number }
      revenue_mode?: RevenueMode
      totals: { sum: number; by_plan: Record<Plan, number> }
      daily: Array<{ date: string; sum: number }>
      monthly?: Array<{ month: string; sum: number }>
      note?: string
    }
  | {
      ok: false
      error: string
      details?: string
    }

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
function fmtCurrency(n: number) {
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(2)}`
  }
}
function classCard() {
  return 'rounded-xl border bg-white p-4'
}
function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, 1))
  return dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function AdminRevenue() {
  const [from, setFrom] = useState(addDays(todayLocal(), -29))
  const [to, setTo] = useState(todayLocal())
  const [mode, setMode] = useState<RevenueMode>('cash')
  const [data, setData] = useState<RevenueResp | null>(null)
  const [loading, setLoading] = useState(false)

  const valid = useMemo(
    () => /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to,
    [from, to]
  )

  async function load() {
    if (!valid) return
    setLoading(true)
    setData(null)
    try {
      const p = new URLSearchParams({ from, to, type: 'revenue', mode })
      const r = await fetch(`/api/admin/stats/revenue?${p.toString()}`, { cache: 'no-store' })
      const j = await r.json()
      setData(j)
    } catch (e: any) {
      setData({ ok: false, error: e?.message || 'NETWORK_ERROR' } as any)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pathD = useMemo(() => {
    if (!data || !('daily' in data) || data.daily.length === 0) return ''
    const daily = data.daily
    const W = 720, H = 180, P = 8
    const max = Math.max(1, ...daily.map((d) => d.sum))
    const dx = (W - 2 * P) / Math.max(1, daily.length - 1)
    const normY = (v: number) => H - P - (v / max) * (H - 2 * P)
    const pts = daily.map((d, i) => [P + i * dx, normY(d.sum)] as const)
    return pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ')
  }, [data])

  const monthlyPathD = useMemo(() => {
    if (!data || !('monthly' in data) || !(data.monthly?.length)) return ''
    const monthly = data.monthly
    const W = 720, H = 180, P = 8
    const max = Math.max(1, ...monthly.map((d) => d.sum))
    const dx = (W - 2 * P) / Math.max(1, monthly.length - 1)
    const normY = (v: number) => H - P - (v / max) * (H - 2 * P)
    const pts = monthly.map((d, i) => [P + i * dx, normY(d.sum)] as const)
    return pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ')
  }, [data])

  const totals = data && data.ok ? data.totals : null
  const resolvedMode: RevenueMode = data && data.ok && data.revenue_mode ? data.revenue_mode : mode

  return (
    <section className={classCard()}>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-lg font-semibold">Revenue</h2>
          <p className="text-xs text-gray-500">
            {resolvedMode === 'recognized'
              ? 'Monthly recognition view for subscriptions, with freeze-aware spreading.'
              : 'Cash collected by period, by plan, and daily curve.'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-xs text-gray-600">View</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as RevenueMode)} className="px-2 py-1 border rounded">
              <option value="cash">Cash basis</option>
              <option value="recognized">Monthly recognition</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-600">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1 border rounded" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-600">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1 border rounded" />
          </label>
          <button
            onClick={load}
            disabled={!valid || loading}
            className={`px-3 py-2 rounded border ${!valid || loading ? 'bg-gray-200 text-gray-500' : 'hover:bg-gray-50'}`}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {data && data.ok && data.note ? (
        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">{data.note}</div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-gray-500">{resolvedMode === 'recognized' ? 'Recognized revenue' : 'Total revenue'}</div>
          <div className="text-xl font-semibold">{totals ? fmtCurrency(totals.sum) : '—'}</div>
        </div>
        {(['1m', '3m', '6m', '12m', 'sessions'] as Plan[]).map((p) => (
          <div key={p} className="rounded-lg border p-3">
            <div className="text-xs text-gray-500">Plan {p}</div>
            <div className="text-lg font-medium">{totals ? fmtCurrency(totals.by_plan[p] || 0) : '—'}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        {data && data.ok && resolvedMode === 'recognized' && data.monthly && data.monthly.length > 0 ? (
          <div className="rounded-lg border p-3">
            <div className="text-xs text-gray-500 mb-2">Monthly recognition ({data.range.from} → {data.range.to})</div>
            <svg viewBox="0 0 720 200" className="w-full h-48">
              <rect x="0" y="0" width="720" height="200" fill="white" />
              <line x1="8" y1="180" x2="712" y2="180" stroke="#ddd" strokeWidth="1" />
              <path d={monthlyPathD} fill="none" stroke="#111" strokeWidth="2" />
            </svg>
          </div>
        ) : data && data.ok && data.daily.length > 0 ? (
          <div className="rounded-lg border p-3">
            <div className="text-xs text-gray-500 mb-2">Daily totals ({data.range.from} → {data.range.to})</div>
            <svg viewBox="0 0 720 200" className="w-full h-48">
              <rect x="0" y="0" width="720" height="200" fill="white" />
              {data.daily.map((d, i) =>
                i % 7 === 0 ? (
                  <line
                    key={`gx-${i}`}
                    x1={8 + (i * (720 - 16)) / Math.max(1, data.daily.length - 1)}
                    y1="10"
                    x2={8 + (i * (720 - 16)) / Math.max(1, data.daily.length - 1)}
                    y2="180"
                    stroke="#eee"
                    strokeWidth="1"
                  />
                ) : null
              )}
              <line x1="8" y1="180" x2="712" y2="180" stroke="#ddd" strokeWidth="1" />
              <path d={pathD} fill="none" stroke="#111" strokeWidth="2" />
            </svg>
          </div>
        ) : (
          <div className="rounded-lg border p-3 text-sm text-gray-500">{loading ? 'Loading…' : 'No data.'}</div>
        )}
      </div>

      {data && data.ok && resolvedMode === 'recognized' && data.monthly && data.monthly.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Month</th>
                <th className="text-left px-3 py-2">Recognized revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((row) => (
                <tr key={row.month} className="border-t">
                  <td className="px-3 py-2">{monthLabel(row.month)}</td>
                  <td className="px-3 py-2">{fmtCurrency(row.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data && data.ok && data.daily.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="px-3 py-2">{d.date}</td>
                  <td className="px-3 py-2">{fmtCurrency(d.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
