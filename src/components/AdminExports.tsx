// src/components/AdminExports.tsx
'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { addDaysDateOnly, cairoTodayDateOnly } from '@/lib/cairoTime'

type SubscriptionView = 'cash' | 'recognized'

function linkClass(disabled: boolean, variant: 'solid' | 'outline' = 'outline') {
  const base = 'inline-flex min-h-[42px] touch-manipulation items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium transition disabled:pointer-events-none'
  const style =
    variant === 'solid'
      ? 'bg-black text-white hover:opacity-95'
      : 'border border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]/80'
  return `${base} ${style} ${disabled ? 'pointer-events-none opacity-50' : ''}`
}

function viewLabel(view: SubscriptionView) {
  return view === 'cash' ? 'Cash basis' : 'Monthly recognition'
}

export default function AdminExports() {
  const [from, setFrom] = useState<string>(() => addDaysDateOnly(cairoTodayDateOnly(), -30))
  const [to, setTo] = useState<string>(() => cairoTodayDateOnly())
  const [subscriptionsView, setSubscriptionsView] = useState<SubscriptionView>('cash')

  const valid = useMemo(() => {
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  }, [from, to])

  const subsCsvUrl = useMemo(() => {
    const p = new URLSearchParams({ from, to, view: subscriptionsView })
    return `/api/admin/export/subscriptions?${p.toString()}`
  }, [from, to, subscriptionsView])

  const subsPdfUrl = useMemo(() => {
    const p = new URLSearchParams({ from, to, view: subscriptionsView })
    return `/api/admin/export/subscriptions-pdf?${p.toString()}`
  }, [from, to, subscriptionsView])

  const attUrl = useMemo(() => {
    const p = new URLSearchParams({ from, to })
    return `/api/admin/export/attendance?${p.toString()}`
  }, [from, to])

  const activeNowUrl = '/api/admin/export/active-now'

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-soft space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Exports</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Export the exact operational view you need.</p>
        </div>
        <div className="rounded-2xl border bg-[hsl(var(--bg))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
          Dashboard exports use Cairo dates.
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border p-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select
          label="Subscriptions view"
          value={subscriptionsView}
          onChange={(e) => setSubscriptionsView(e.target.value as SubscriptionView)}
        >
          <option value="cash">Cash basis</option>
          <option value="recognized">Monthly recognition</option>
        </Select>
        <div className="grid gap-2">
          <div className="text-xs font-medium text-[hsl(var(--muted))]">Quick range</div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { const t = cairoTodayDateOnly(); setTo(t); setFrom(addDaysDateOnly(t, -6)) }}>
              7D
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { const t = cairoTodayDateOnly(); setTo(t); setFrom(addDaysDateOnly(t, -29)) }}>
              30D
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { const t = cairoTodayDateOnly(); setTo(t); setFrom(addDaysDateOnly(t, -89)) }}>
              90D
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Subscriptions</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">{viewLabel(subscriptionsView)}</p>
          </div>
          <div className="rounded-2xl border bg-[hsl(var(--bg))] px-3 py-2 text-sm">
            <div className="font-medium">Current view</div>
            <div className="mt-1 text-[hsl(var(--muted))]">
              {from} → {to} · {viewLabel(subscriptionsView)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={subsCsvUrl} className={linkClass(!valid, 'outline')} aria-disabled={!valid}>
              Export CSV
            </a>
            <a href={subsPdfUrl} className={linkClass(!valid, 'solid')} aria-disabled={!valid}>
              Export PDF
            </a>
          </div>
          <p className="text-xs text-[hsl(var(--muted))]">Uses current filters</p>
        </div>

        <div className="grid gap-3">
          <div className="rounded-2xl border p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Attendance</h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">Export the selected attendance range.</p>
            </div>
            <a href={attUrl} className={linkClass(!valid, 'outline')} aria-disabled={!valid}>
              Export CSV
            </a>
            <p className="text-xs text-[hsl(var(--muted))]">Uses current filters</p>
          </div>

          <div className="rounded-2xl border p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Active now</h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">Export the live active subscription snapshot.</p>
            </div>
            <a href={activeNowUrl} className={linkClass(false, 'outline')}>
              Export CSV
            </a>
            <p className="text-xs text-[hsl(var(--muted))]">Uses today’s Cairo date</p>
          </div>
        </div>
      </div>
    </section>
  )
}
