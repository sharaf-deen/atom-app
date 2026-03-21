'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import SettleDueDialog from '@/components/SettleDueDialog'
import { Table } from '@/components/ui/Table'
import type { OutstandingDueRow } from '../types'

type PaymentMethod = 'cash' | 'instapay' | 'card' | 'bank_transfer' | 'other'

type SortKey = 'due_desc' | 'due_asc' | 'paid_at_desc' | 'paid_at_asc' | 'name_asc'
type FocusKey = 'all' | 'high_due' | 'missing_paid_at'

function fmtMoney(v: number) {
  const n = Number(v ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(2)} EGP`
  }
}

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const dt = new Date(v)
  if (Number.isNaN(dt.getTime())) return v
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function normMethod(v?: string | null): PaymentMethod {
  const s = String(v ?? '').toLowerCase()
  if (s === 'cash' || s === 'instapay' || s === 'card' || s === 'bank_transfer') return s
  return 'other'
}

function humanMethod(v?: string | null) {
  const m = normMethod(v)
  switch (m) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'InstaPay'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return v || '—'
  }
}

function humanPlan(v?: string | null) {
  switch (v) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return 'Sessions'
    default:
      return v ? String(v) : 'Membership'
  }
}

function toneClasses(kind: 'neutral' | 'warning' | 'danger' | 'success') {
  if (kind === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (kind === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (kind === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClasses(tone)}`}>
      {children}
    </span>
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-[hsl(var(--muted))]">{hint}</div>
    </div>
  )
}

export default function OutstandingDuesClient({ initialRows }: { initialRows: OutstandingDueRow[] }) {
  const [q, setQ] = useState('')
  const [method, setMethod] = useState<'all' | PaymentMethod>('all')
  const [minDue, setMinDue] = useState<string>('')
  const [focus, setFocus] = useState<FocusKey>('all')
  const [sort, setSort] = useState<SortKey>('due_desc')

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const min = Number(minDue || 0)

    const out = (initialRows ?? []).filter((r) => {
      if (method !== 'all' && normMethod(r.payment_method) !== method) return false
      if (Number.isFinite(min) && min > 0 && r.due < min) return false
      if (focus === 'high_due' && Number(r.due || 0) < 1000) return false
      if (focus === 'missing_paid_at' && !!r.paid_at) return false

      if (!query) return true
      const hay = [r.name, r.email ?? '', r.phone ?? '', r.member_code ?? ''].join(' ').toLowerCase()
      return hay.includes(query)
    })

    const byDate = (s?: string | null) => {
      const t = s ? new Date(s).getTime() : 0
      return Number.isFinite(t) ? t : 0
    }

    out.sort((a, b) => {
      switch (sort) {
        case 'due_asc':
          return a.due - b.due
        case 'paid_at_desc':
          return byDate(b.paid_at) - byDate(a.paid_at)
        case 'paid_at_asc':
          return byDate(a.paid_at) - byDate(b.paid_at)
        case 'name_asc':
          return a.name.localeCompare(b.name)
        case 'due_desc':
        default:
          return b.due - a.due
      }
    })

    return out
  }, [focus, initialRows, method, minDue, q, sort])

  const totals = useMemo(() => {
    const due = filtered.reduce((acc, r) => acc + Number(r.due || 0), 0)
    const members = new Set(filtered.map((r) => r.user_id)).size
    const actionFirst = filtered.filter((r) => Number(r.due || 0) >= 1000).length
    const missingPaidAt = filtered.filter((r) => !r.paid_at).length
    return { due, members, actionFirst, missingPaidAt }
  }, [filtered])

  const hasFilters = q.trim() !== '' || method !== 'all' || minDue.trim() !== '' || focus !== 'all' || sort !== 'due_desc'

  const columns = useMemo(
    () => [
      { key: 'member', header: 'Member' },
      { key: 'membership', header: 'Membership' },
      { key: 'billing', header: 'Billing' },
      { key: 'paid_at', header: 'Last paid' },
      { key: 'actions', header: 'Actions' },
    ],
    [],
  )

  const rows = useMemo(() => {
    return filtered.map((r) => {
      const planTone = Number(r.due || 0) >= 1000 ? 'danger' : Number(r.due || 0) >= 500 ? 'warning' : 'neutral'
      const contact = [r.email ?? '', r.phone ?? ''].filter(Boolean)

      return {
        key: r.subscription_id,
        member: (
          <div className="space-y-1">
            <div className="font-medium">{r.name}</div>
            <div className="flex flex-wrap gap-1">
              {r.member_code ? <TinyBadge>{r.member_code}</TinyBadge> : null}
              {r.status ? <TinyBadge tone={planTone}>{String(r.status).replace(/_/g, ' ')}</TinyBadge> : null}
              {Number(r.due || 0) >= 1000 ? <TinyBadge tone="danger">Action first</TinyBadge> : null}
              {!r.paid_at ? <TinyBadge tone="warning">No paid date</TinyBadge> : null}
            </div>
            {contact.length ? <div className="text-xs text-[hsl(var(--muted))]">{contact.join(' · ')}</div> : null}
          </div>
        ),
        membership: (
          <div className="space-y-1">
            <div className="font-medium">{humanPlan(r.plan)}</div>
            <div className="text-xs text-[hsl(var(--muted))]">Payment method: {humanMethod(r.payment_method)}</div>
          </div>
        ),
        billing: (
          <div className="space-y-1">
            <div className="font-medium">Due {fmtMoney(r.due)}</div>
            <div className="text-xs text-[hsl(var(--muted))]">Paid {fmtMoney(r.paid)} · Total {fmtMoney(r.total)}</div>
          </div>
        ),
        paid_at: (
          <div className="space-y-1">
            <div className="font-medium">{fmtDate(r.paid_at)}</div>
            <div className="text-xs text-[hsl(var(--muted))]">Latest real payment date</div>
          </div>
        ),
        actions: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SettleDueDialog
              sub={{ id: r.subscription_id, amount: r.paid, amount_due: r.due, payment_method: r.payment_method }}
              buttonLabel="Settle due"
            />
            <Link
              prefetch={false}
              className="inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50"
              href={`/members/${r.user_id}`}
            >
              Open profile
            </Link>
          </div>
        ),
      }
    })
  }, [filtered])

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Members with due" value={String(totals.members)} hint="Unique members in the current filtered view." />
        <SummaryCard label="Total due" value={fmtMoney(totals.due)} hint="Current outstanding balance in the filtered view." />
        <SummaryCard label="Action first" value={String(totals.actionFirst)} hint="Rows with due of 1,000 EGP or more." />
        <SummaryCard label="Missing paid date" value={String(totals.missingPaidAt)} hint={totals.missingPaidAt > 0 ? 'Review payment history before closing the desk action.' : 'All visible rows already have a paid date.'} />
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="block min-w-[220px] flex-1">
            <span className="mb-1 block text-sm font-medium">Search</span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              placeholder="Name / email / phone / member id"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Payment</span>
            <select className="rounded-lg border px-3 py-2" value={method} onChange={(e) => setMethod(e.target.value as 'all' | PaymentMethod)}>
              <option value="all">All</option>
              <option value="cash">Cash</option>
              <option value="instapay">InstaPay</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Min due (EGP)</span>
            <input
              className="w-[160px] rounded-lg border px-3 py-2"
              inputMode="decimal"
              placeholder="0"
              value={minDue}
              onChange={(e) => setMinDue(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Sort</span>
            <select className="rounded-lg border px-3 py-2" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="due_desc">Due (high → low)</option>
              <option value="due_asc">Due (low → high)</option>
              <option value="paid_at_desc">Paid at (newest)</option>
              <option value="paid_at_asc">Paid at (oldest)</option>
              <option value="name_asc">Name (A → Z)</option>
            </select>
          </label>

          <button
            type="button"
            className="ml-auto rounded-lg border px-4 py-2 hover:bg-gray-50"
            onClick={() => {
              setQ('')
              setMethod('all')
              setMinDue('')
              setFocus('all')
              setSort('due_desc')
            }}
          >
            Reset
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
          <TinyBadge>{filtered.length} visible row(s)</TinyBadge>
          {method !== 'all' ? <TinyBadge>Payment: {humanMethod(method)}</TinyBadge> : null}
          {minDue.trim() ? <TinyBadge tone="warning">Min due {minDue} EGP</TinyBadge> : null}
          {q.trim() ? <TinyBadge>Search: {q.trim()}</TinyBadge> : null}
          {hasFilters ? <span>Filters are applied to both the cards and the list below.</span> : <span>Use this page to settle dues fast before opening the full member profile.</span>}
        </div>
      </div>

      <Table columns={columns} rows={rows as any[]} keyField="key" stickyTopClassName="top-0" />
    </section>
  )
}
