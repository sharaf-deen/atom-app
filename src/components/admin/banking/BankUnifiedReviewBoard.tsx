'use client'

import { useMemo, useState } from 'react'

type Movement = {
  id: string
  transaction_date: string
  amount: number
  currency: string
  description: string
  reference: string | null
  counterparty: string | null
  category_code: string | null
}
type Candidate = { id: string; date: string; amount: number; label: string; kind: string; available: number }
type Props = {
  direction: 'income' | 'outflow'
  movements: Movement[]
  sources: Candidate[]
  activeMatchedByTransaction: Record<string, number>
}

const cents = (n: number) => Math.round(Number(n) * 100)
function dayDiff(a: string, b: string) {
  const x = Date.parse(a.slice(0, 10) + 'T12:00:00Z')
  const y = Date.parse(b.slice(0, 10) + 'T12:00:00Z')
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(Math.round((x - y) / 86400000)) : 999
}
function money(n: number) { return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n) }
function normalize(s: string | null) { return String(s ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') }

export default function BankUnifiedReviewBoard({ direction, movements, sources, activeMatchedByTransaction }: Props) {
  const [filter, setFilter] = useState<'candidates' | 'transfer' | 'exceptions'>('candidates')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const report = useMemo(() => {
    const available = movements.filter(m => m.currency === 'EGP' && cents(m.amount) > cents(activeMatchedByTransaction[m.id] ?? 0))
    const eligible = sources.filter(s => cents(s.available) > 0)
    const ranked = available.map(m => {
      const remainder = cents(m.amount) - cents(activeMatchedByTransaction[m.id] ?? 0)
      const options = eligible.filter(s => cents(s.available) === remainder && dayDiff(m.transaction_date, s.date) <= 7)
        .map(s => ({ ...s, gap: dayDiff(m.transaction_date, s.date) }))
        .sort((a, b) => a.gap - b.gap)
      const inferredTransfer = m.category_code === 'internal_transfer'
      const refs = [m.reference, m.counterparty].filter(Boolean).map(normalize)
      const matchingReference = options.filter(s => refs.some(ref => ref.length >= 5 && normalize(s.label).includes(ref)))
      const strongest = matchingReference.length === 1 ? matchingReference : options.filter(s => s.gap <= 1)
      return { movement: m, remainder: remainder / 100, options, inferredTransfer, candidates: strongest }
    })
    const occurrences = new Map<string, number>()
    for (const r of ranked) {
      for (const c of r.candidates) occurrences.set(c.id, (occurrences.get(c.id) ?? 0) + 1)
    }
    const candidates = ranked.filter(r => !r.inferredTransfer && r.candidates.length === 1 && occurrences.get(r.candidates[0].id) === 1)
    const transfers = ranked.filter(r => r.inferredTransfer)
    const exceptions = ranked.filter(r => !r.inferredTransfer && !candidates.includes(r))
    return { candidates, transfers, exceptions, all: ranked }
  }, [movements, sources, activeMatchedByTransaction])
  const rows = filter === 'candidates' ? report.candidates : filter === 'transfer' ? report.transfers : report.exceptions
  const visible = rows.filter(r => [r.movement.description, r.movement.reference, r.movement.counterparty, String(r.movement.amount)]
    .some(v => normalize(v).includes(normalize(query)))).slice(0, expanded ? 200 : 20)

  return <section className="space-y-3 rounded-2xl border border-sky-200 bg-white p-4 shadow-soft">
    <h2 className="text-lg font-bold">Banking 2I · Unified review worklist · {direction === 'income' ? 'Income' : 'Outflow'}</h2>
    <p className="text-sm text-slate-600">Read-only suggestions based on remaining amount, date and available ATOM records. The same review rules apply to both reconciliation pages. No money is posted or classified here.</p>
    <div className="grid grid-cols-3 gap-2 text-sm">
      <button type="button" onClick={() => setFilter('candidates')} aria-pressed={filter === 'candidates'} className={`rounded-xl border p-3 text-left ${filter === 'candidates' ? 'border-blue-500 bg-blue-50' : ''}`}>
        <span className="block text-xs text-slate-500">One candidate</span><strong>{report.candidates.length}</strong>
      </button>
      <button type="button" onClick={() => setFilter('transfer')} aria-pressed={filter === 'transfer'} className={`rounded-xl border p-3 text-left ${filter === 'transfer' ? 'border-blue-500 bg-blue-50' : ''}`}>
        <span className="block text-xs text-slate-500">Transfer labels to verify</span><strong>{report.transfers.length}</strong>
      </button>
      <button type="button" onClick={() => setFilter('exceptions')} aria-pressed={filter === 'exceptions'} className={`rounded-xl border p-3 text-left ${filter === 'exceptions' ? 'border-blue-500 bg-blue-50' : ''}`}>
        <span className="block text-xs text-slate-500">Exceptions</span><strong>{report.exceptions.length}</strong>
      </button>
    </div>
    <input aria-label="Filter review worklist" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by reference, description or amount..." className="w-full rounded-xl border p-2 text-sm"/>
    <div className="space-y-2">
      {visible.map(r => <div key={r.movement.id} className="rounded-xl border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{r.movement.transaction_date} · {money(r.remainder)}</strong>
          <a className="text-blue-700 underline" href={direction === 'income' ? `#credit-${r.movement.id}` : `#debit-${r.movement.id}`}>Inspect original transaction</a></div>
        <p className="mt-1 break-words">{r.movement.description}</p>
        <p className="text-xs text-slate-500">{r.movement.counterparty ?? 'No counterparty'} · {r.movement.reference ?? 'No bank reference'}</p>
        {filter === 'candidates' ? <p className="mt-1 text-xs text-blue-800">Potential {r.candidates[0].kind}: {r.candidates[0].label} · {r.candidates[0].date} · {r.candidates[0].gap} day(s) apart. Review evidence before confirming.</p> :
          filter === 'transfer' ? <p className="mt-1 text-xs text-amber-800">Unconfirmed classification only. Verify the matching movement in another ATOM-owned bank account.</p> :
          <p className="mt-1 text-xs text-amber-800">{r.options.length ? `${r.options.length} possible source record(s); no unique verified pairing.` : 'No equal remaining amount in the seven-day source window.'}</p>}
      </div>)}
      {!visible.length ? <p className="rounded-xl bg-slate-50 p-3 text-sm">No transactions in this group.</p> : null}
    </div>
    {rows.length > 20 ? <button type="button" onClick={() => setExpanded(v => !v)} className="rounded-xl border px-3 py-2 text-sm">{expanded ? 'Show first 20' : `Show more (${Math.min(rows.length, 200)} max)`}</button> : null}
    <p className="text-xs text-amber-900">Candidate counts are informational, not proof. Source records may be filtered by the selected month. Transfers are not income or expenses; there is no automatic approval, posting or salary calculation.</p>
  </section>
}
