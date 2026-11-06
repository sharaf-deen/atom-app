'use client'

import { useMemo, useState } from 'react'
import type { BankPaymentBatch, BankPaymentMatch } from './BankPaymentMatcher'

type Credit = {
  id: string
  transaction_date: string
  amount: number
  reference: string | null
  category_code: string | null
  classification_status: string
}

type Props = {
  credits: Credit[]
  batches: BankPaymentBatch[]
  activeMatches: BankPaymentMatch[]
}

const cents = (v: number) => Math.round(Number(v) * 100)
const day = (v: string) => Math.floor(Date.parse(v + 'T12:00:00Z') / 86400000)
const money = (v: number) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)

export default function BankBulkReconciliationPreview({ credits, batches, activeMatches }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [showReview, setShowReview] = useState(false)

  const data = useMemo(() => {
    const matched = new Map<string, number>()
    for (const m of activeMatches) matched.set(m.bank_transaction_id, (matched.get(m.bank_transaction_id) ?? 0) + Number(m.matched_amount))
    const availableCredits = credits.filter(c => cents(c.amount - (matched.get(c.id) ?? 0)) > 0)
    const availableBatches = batches.filter(b =>
      b.payment_method === 'instapay' &&
      !b.legacy_matched && b.business_date &&
      cents(b.counted_amount - b.active_matched_amount) > 0
    )
    const options = availableCredits.map(c => {
      const remainder = cents(c.amount - (matched.get(c.id) ?? 0))
      const candidates = availableBatches.filter(b =>
        cents(b.counted_amount - b.active_matched_amount) === remainder &&
        Math.abs(day(c.transaction_date) - day(String(b.business_date))) <= 1
      )
      return { credit: c, candidates, remainder }
    })
    const reverse = new Map<string, number>()
    for (const item of options) for (const b of item.candidates) reverse.set(b.id, (reverse.get(b.id) ?? 0) + 1)
    const safe = options.filter(o =>
      o.credit.category_code === 'membership_income' &&
      o.candidates.length === 1 && reverse.get(o.candidates[0].id) === 1
    ).map(o => ({ ...o, batch: o.candidates[0] }))
    const needsReview = options.filter(o =>
      o.credit.category_code !== 'internal_transfer' &&
      !safe.some(s => s.credit.id === o.credit.id)
    )
    return {
      safe,
      needsReview,
      internal: options.filter(o => o.credit.category_code === 'internal_transfer'),
      unmatched: availableCredits.length,
    }
  }, [credits, batches, activeMatches])

  const approved = data.safe.filter(row => selected.includes(row.credit.id))
  const selectedTotal = approved.reduce((sum, row) => sum + row.credit.amount, 0)

  return (
    <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/40 p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Banking 2H · Smart bulk preview</h2>
          <p className="mt-1 text-sm text-slate-700">
            Read-only simulation. Exact remaining amount, payment within one day, and unique credit-to-batch pairing.
            Suggested classifications require manual review before matching.
          </p>
        </div>
        <span className="rounded-full border border-sky-300 px-3 py-1 text-xs font-bold text-sky-900">SIMULATION ONLY · NO WRITES</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div className="rounded-xl bg-white p-3"><div className="text-xs text-slate-500">Credits to review</div><strong>{data.unmatched}</strong></div>
        <div className="rounded-xl bg-white p-3"><div className="text-xs text-slate-500">Unique candidates</div><strong>{data.safe.length}</strong></div>
        <div className="rounded-xl bg-white p-3"><div className="text-xs text-slate-500">Internal transfers suggested</div><strong>{data.internal.length}</strong></div>
        <div className="rounded-xl bg-white p-3"><div className="text-xs text-slate-500">Other / ambiguous</div><strong>{data.needsReview.length}</strong></div>
      </div>
      {data.safe.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">Candidates for human review</strong>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selected.length === data.safe.length} onChange={e => setSelected(e.target.checked ? data.safe.map(s => s.credit.id) : [])} />
              Select all unique candidates
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-slate-50 text-xs"><tr><th className="p-2">Review</th><th className="p-2">Bank date / reference</th><th className="p-2">Credit</th><th className="p-2">Validation date</th><th className="p-2">Batch</th><th className="p-2">Open</th></tr></thead>
              <tbody>
                {data.safe.map(row => <tr className="border-t" key={row.credit.id}>
                  <td className="p-2"><input type="checkbox" aria-label={`Select credit ${row.credit.reference ?? row.credit.id}`} checked={selected.includes(row.credit.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, row.credit.id] : prev.filter(id => id !== row.credit.id))}/></td>
                  <td className="p-2">{row.credit.transaction_date}<div className="font-mono text-xs">{row.credit.reference ?? 'No reference'}</div></td>
                  <td className="p-2 font-semibold">{money(row.credit.amount)}</td>
                  <td className="p-2">{row.batch.business_date}</td>
                  <td className="p-2 font-mono text-xs">{row.batch.id.slice(0, 8)}</td>
                  <td className="p-2"><a className="font-semibold text-blue-700 underline" href={`#credit-${row.credit.id}`}>Inspect</a></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>
      ) : <p className="rounded-xl bg-white p-3 text-sm">No strictly unique, classified membership candidates in this date range.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 text-sm">
        <div><strong>{approved.length} selected · {money(selectedTotal)}</strong><div className="text-xs text-slate-600">Selections are not saved. No matches are created.</div></div>
        <button type="button" onClick={() => setShowReview(!showReview)} className="rounded-lg border px-3 py-2 font-semibold">{showReview ? 'Hide' : 'Show'} exceptions</button>
      </div>
      {showReview ? <div className="rounded-xl bg-white p-3 text-sm">
        <p><strong>{data.needsReview.length}</strong> non-internal credits require separate investigation, including ambiguous amounts, dates, methods or missing validation batches.</p>
        <p className="mt-1"><strong>{data.internal.length}</strong> internal-transfer suggestions are excluded from income proposals; their classifications are not automatically confirmed.</p>
      </div> : null}
      <p className="text-xs text-amber-900">Bulk write is intentionally disabled until a transactional PostgreSQL RPC, concurrency tests, and explicit Super Admin confirmation are validated on Staging. Do not treat any candidate as a confirmed bank match.</p>
    </section>
  )
}
