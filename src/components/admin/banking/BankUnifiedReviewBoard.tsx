'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Movement = {
  id: string
  account_id?: string
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
  oppositeMovements?: Movement[]
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

export default function BankUnifiedReviewBoard({ direction, movements, oppositeMovements = [], sources, activeMatchedByTransaction }: Props) {
  const [filter, setFilter] = useState<'candidates' | 'transfer' | 'exceptions'>('candidates')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const router = useRouter()
  const report = useMemo(() => {
    const available = movements.filter(m => m.currency === 'EGP' && cents(m.amount) > cents(activeMatchedByTransaction[m.id] ?? 0))
    const eligible = sources.filter(s => cents(s.available) > 0)
    const ranked = available.map(m => {
      const remainder = cents(m.amount) - cents(activeMatchedByTransaction[m.id] ?? 0)
      const options = eligible.filter(s => cents(s.available) === remainder && dayDiff(m.transaction_date, s.date) <= 7)
        .map(s => ({ ...s, gap: dayDiff(m.transaction_date, s.date) }))
        .sort((a, b) => a.gap - b.gap)
      const possibleTransfers = oppositeMovements.filter(other => other.account_id && m.account_id && other.account_id !== m.account_id &&
        other.currency === m.currency && cents(other.amount) === cents(m.amount) && dayDiff(m.transaction_date, other.transaction_date) <= 3)
      const inferredTransfer = m.category_code === 'internal_transfer'
      // Do not promote a plausible reference/date into uniqueness while alternatives exist.
      return { movement: m, remainder: remainder / 100, options, inferredTransfer, possibleTransfers, candidates: options }
    })
    const occurrences = new Map<string, number>()
    for (const r of ranked) {
      for (const c of r.candidates) occurrences.set(c.id, (occurrences.get(c.id) ?? 0) + 1)
    }
    const candidates = ranked.filter(r => !r.inferredTransfer && (direction === 'outflow' || r.movement.category_code === 'membership_income') && cents(activeMatchedByTransaction[r.movement.id] ?? 0) === 0 && r.candidates.length === 1 && occurrences.get(r.candidates[0].id) === 1 && r.candidates[0].gap <= 7)
    const transfers = ranked.filter(r => r.inferredTransfer)
    const exceptions = ranked.filter(r => !r.inferredTransfer && !candidates.includes(r))
    return { candidates, transfers, exceptions, all: ranked }
  }, [movements, oppositeMovements, sources, activeMatchedByTransaction, direction])
  const reviewable = report.candidates.filter(r => direction === 'outflow'
    ? ['expense', 'staff_payroll_payment', 'membership_refund'].includes(r.candidates[0].kind)
    : r.candidates[0].kind === 'payment batch')
  const chosen = reviewable.filter(r => selected.includes(r.movement.id))
  async function confirmBulk() {
    if (busy || !verified || reason.trim().length < 10 || chosen.length < 1 || chosen.length > 50) return
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch(direction === 'income' ? '/api/admin/banking/reconciliation/bulk-v2' : '/api/admin/banking/outflows/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verified: true,
          reason: reason.trim(),
          pairs: chosen.map(r => direction === 'income' ? {
            bank_transaction_id: r.movement.id,
            batch_id: r.candidates[0].id,
          } : {
            bank_transaction_id: r.movement.id,
            source_id: r.candidates[0].id,
            source_kind: r.candidates[0].kind,
          }),
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(String(data?.error ?? 'BULK_MATCH_FAILED'))
      setNotice(`Matched ${data.result.matched_count} bank transactions. Audit records preserved.`)
      setSelected([])
      setReason('')
      setVerified(false)
      router.refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Bulk confirmation failed')
    } finally {
      setBusy(false)
    }
  }
  const rows = filter === 'candidates' ? report.candidates : filter === 'transfer' ? report.transfers : report.exceptions
  const visible = rows.filter(r => [r.movement.description, r.movement.reference, r.movement.counterparty, String(r.movement.amount)]
    .some(v => normalize(v).includes(normalize(query)))).slice(0, expanded ? 200 : 20)

  return <section className="space-y-3 rounded-2xl border border-sky-200 bg-white p-4 shadow-soft">
    <h2 className="text-lg font-bold">Banking 2I · Unified review worklist · {direction === 'income' ? 'Income' : 'Outflow'}</h2>
    <p className="text-sm text-slate-600">Read-only suggestions based on remaining amount, date and available ATOM records. The same review rules apply to both reconciliation pages. No money is posted or classified here.</p>
    <p className="text-xs text-amber-800">Card settlement batches are excluded from automatic bulk income suggestions: settlements may combine payments. Transfer category labels require opposite-account bank evidence before they can be treated as verified transfers.</p>
    <div className="grid grid-cols-3 gap-2 text-sm">
      <button type="button" onClick={() => setFilter('candidates')} aria-pressed={filter === 'candidates'} className={`rounded-xl border p-3 text-left ${filter === 'candidates' ? 'border-blue-500 bg-blue-50' : ''}`}>
        <span className="block text-xs text-slate-500">One candidate</span><strong>{report.candidates.length}</strong>
      </button>
      <button type="button" onClick={() => setFilter('transfer')} aria-pressed={filter === 'transfer'} className={`rounded-xl border p-3 text-left ${filter === 'transfer' ? 'border-blue-500 bg-blue-50' : ''}`}>
        <span className="block text-xs text-slate-500">Unverified transfer labels</span><strong>{report.transfers.length}</strong>
      </button>
      <button type="button" onClick={() => setFilter('exceptions')} aria-pressed={filter === 'exceptions'} className={`rounded-xl border p-3 text-left ${filter === 'exceptions' ? 'border-blue-500 bg-blue-50' : ''}`}>
        <span className="block text-xs text-slate-500">Exceptions</span><strong>{report.exceptions.length}</strong>
      </button>
    </div>
    {filter === 'candidates' && reviewable.length > 0 ?
      <button type="button" disabled={busy} onClick={() => setSelected(
        reviewable.length <= 50 && reviewable.every(r => selected.includes(r.movement.id))
          ? [] : reviewable.slice(0, 50).map(r => r.movement.id)
      )} className="rounded-xl border px-3 py-2 text-sm">
        {reviewable.length <= 50 && reviewable.every(r => selected.includes(r.movement.id))
          ? 'Clear selected candidates' : `Select first ${Math.min(reviewable.length, 50)} candidates for review`}
      </button> : null}
    <input aria-label="Filter review worklist" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by reference, description or amount..." className="w-full rounded-xl border p-2 text-sm"/>
    <div className="space-y-2">
      {visible.map(r => <div key={r.movement.id} className="rounded-xl border p-3 text-sm">
        {filter === 'candidates' && reviewable.some(item => item.movement.id === r.movement.id) ?
          <label className="mb-2 flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={busy || (selected.length >= 50 && !selected.includes(r.movement.id))}
              checked={selected.includes(r.movement.id)}
              onChange={event => setSelected(prev => event.target.checked
                ? [...prev, r.movement.id]
                : prev.filter(id => id !== r.movement.id))}/>
            Include in verified bulk review
          </label> : null}
        <div className="flex flex-wrap justify-between gap-2"><strong>{r.movement.transaction_date} · {money(r.remainder)}</strong>
          <a className="text-blue-700 underline" href={direction === 'income' ? `#credit-${r.movement.id}` : `#debit-${r.movement.id}`}>Inspect original transaction</a></div>
        <p className="mt-1 break-words">{r.movement.description}</p>
        <p className="text-xs text-slate-500">{r.movement.counterparty ?? 'No counterparty'} · {r.movement.reference ?? 'No bank reference'}</p>
        {filter === 'candidates' ? <p className="mt-1 text-xs text-blue-800">Potential {r.candidates[0].kind}: {r.candidates[0].label} · {r.candidates[0].date} · {r.candidates[0].gap} day(s) apart. Review evidence before confirming.</p> :
          filter === 'transfer' ? <p className="mt-1 text-xs text-amber-800">Unconfirmed classification only. {r.possibleTransfers.length === 1 ? `Potential opposite movement: ${r.possibleTransfers[0].transaction_date} · ${r.possibleTransfers[0].reference ?? r.possibleTransfers[0].id.slice(0, 8)} in another account. Independently verify both accounts.` : r.possibleTransfers.length > 1 ? `${r.possibleTransfers.length} possible opposite-account movements; ambiguous.` : 'No opposite-account bank movement found in the three-day window. Do not assume this is an internal transfer.'}</p> :
          <p className="mt-1 text-xs text-amber-800">{r.options.length ? `${r.options.length} possible source record(s); no unique verified pairing.` : 'No equal remaining amount in the seven-day source window.'}</p>}
      </div>)}
      {!visible.length ? <p className="rounded-xl bg-slate-50 p-3 text-sm">No transactions in this group.</p> : null}
    </div>
    {filter === 'candidates' && reviewable.length > 0 ?
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <h3 className="font-semibold">Super Admin bulk confirmation — {chosen.length} {direction === 'income' ? 'credit(s)' : 'debit(s)'} · {money(chosen.reduce((sum,r) => sum + r.remainder, 0))}</h3>
        <p>Only fully unmatched, exactly equal one-to-one pairs are eligible. Date tolerance: seven days. Similar amounts and dates are suggestions, not payment evidence. Inspect bank and ATOM records individually before confirming the selection.</p>
        <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={480}
          rows={2} placeholder="Evidence reviewed, bank references and supporting records (10–480 characters)"
          className="w-full rounded-xl border bg-white p-2"/>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)}/>
          I independently verified the bank transaction, source record and references for every selected pair.
        </label>
        <button type="button" disabled={busy || !verified || reason.trim().length < 10 || chosen.length < 1 || chosen.length > 50}
          onClick={() => void confirmBulk()}
          className="rounded-xl bg-black px-3 py-2 font-semibold text-white disabled:opacity-40">
          {busy ? 'Confirming…' : `Confirm ${chosen.length} atomic ${direction} matches`}
        </button>
      </div> : null}
    {notice ? <p role="status" className="rounded-xl border p-3 text-sm">{notice}</p> : null}
    {rows.length > 20 ? <button type="button" onClick={() => setExpanded(v => !v)} className="rounded-xl border px-3 py-2 text-sm">{expanded ? 'Show first 20' : `Show more (${Math.min(rows.length, 200)} max)`}</button> : null}
    <p className="text-xs text-amber-900">Candidate counts are informational, not proof. Source records may be filtered by the selected month. Transfers are not income or expenses; there is no automatic approval, posting or salary calculation.</p>
  </section>
}
