'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { OutstandingDueRow } from '../types'
import { Table } from '@/components/ui/Table'

type PaymentMethod = 'cash' | 'instapay' | 'card' | 'bank_transfer' | 'other'

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
  if (isNaN(dt.getTime())) return v
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

export default function OutstandingDuesClient({ initialRows }: { initialRows: OutstandingDueRow[] }) {
  const [q, setQ] = useState('')
  const [method, setMethod] = useState<'all' | PaymentMethod>('all')
  const [minDue, setMinDue] = useState<string>('')
  const [sort, setSort] = useState<'due_desc' | 'due_asc' | 'paid_at_desc' | 'paid_at_asc' | 'name_asc'>('due_desc')

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const min = Number(minDue || 0)

    let out = (initialRows ?? []).filter((r) => {
      if (method !== 'all' && normMethod(r.payment_method) !== method) return false
      if (Number.isFinite(min) && min > 0 && r.due < min) return false

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
  }, [initialRows, method, minDue, q, sort])

  const totals = useMemo(() => {
    const due = filtered.reduce((acc, r) => acc + Number(r.due || 0), 0)
    const members = new Set(filtered.map((r) => r.user_id)).size
    return { due, members }
  }, [filtered])

  const columns = useMemo(
    () => [
      { key: 'member', header: 'Member' },
      { key: 'contact', header: 'Contact' },
      { key: 'plan', header: 'Plan' },
      { key: 'paid', header: 'Paid' },
      { key: 'due', header: 'Due' },
      { key: 'total', header: 'Total' },
      { key: 'payment', header: 'Payment' },
      { key: 'paid_at', header: 'Paid at' },
      { key: 'open', header: 'Profile' },
    ],
    []
  )

  const rows = useMemo(() => {
    return filtered.map((r) => {
      const memberLabel = `${r.name}${r.member_code ? ` · ${r.member_code}` : ''}`
      const contact = [r.email ?? '', r.phone ?? ''].filter(Boolean).join(' · ') || '—'

      return {
        key: r.subscription_id,
        member: memberLabel,
        contact,
        plan: `${r.plan ?? '—'}${r.status ? ` · ${r.status}` : ''}`,
        paid: fmtMoney(r.paid),
        due: fmtMoney(r.due),
        total: fmtMoney(r.total),
        payment: humanMethod(r.payment_method),
        paid_at: fmtDate(r.paid_at),
        open: (
          <Link prefetch={false} className="underline" href={`/members/${r.user_id}`}>
            Open
          </Link>
        ),
      }
    })
  }, [filtered])

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-sm text-[hsl(var(--muted))]">Members with due</div>
          <div className="mt-1 text-2xl font-semibold">{totals.members}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-sm text-[hsl(var(--muted))]">Total due</div>
          <div className="mt-1 text-2xl font-semibold">{fmtMoney(totals.due)}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-sm text-[hsl(var(--muted))]">Rows</div>
          <div className="mt-1 text-2xl font-semibold">{filtered.length}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Search</span>
            <input
              className="border px-3 py-2 rounded-lg"
              placeholder="Name / email / phone / member id"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Payment</span>
            <select className="border px-3 py-2 rounded-lg" value={method} onChange={(e) => setMethod(e.target.value as any)}>
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
              className="border px-3 py-2 rounded-lg w-[160px]"
              inputMode="decimal"
              placeholder="0"
              value={minDue}
              onChange={(e) => setMinDue(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Sort</span>
            <select className="border px-3 py-2 rounded-lg" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="due_desc">Due (high → low)</option>
              <option value="due_asc">Due (low → high)</option>
              <option value="paid_at_desc">Paid at (newest)</option>
              <option value="paid_at_asc">Paid at (oldest)</option>
              <option value="name_asc">Name (A → Z)</option>
            </select>
          </label>

          <button
            type="button"
            className="ml-auto border px-4 py-2 rounded-lg hover:bg-gray-50"
            onClick={() => {
              setQ('')
              setMethod('all')
              setMinDue('')
              setSort('due_desc')
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <Table columns={columns} rows={rows as any} keyField="key" />
    </section>
  )
}
