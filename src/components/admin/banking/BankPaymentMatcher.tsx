'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type BankPaymentBatch = {
  id: string
  payment_method: string
  business_date: string | null
  expected_amount: number
  counted_amount: number
  difference_amount: number
  validated_at: string
  legacy_matched: boolean
  active_matched_amount: number
}

export type BankPaymentMatch = {
  id: string
  bank_transaction_id: string
  batch_id: string
  matched_amount: number
  note: string | null
  matched_at: string
}

type Props = {
  transactionId: string
  transactionDate: string
  transactionAmount: number
  activeMatches: BankPaymentMatch[]
  batches: BankPaymentBatch[]
}

function dateDistance(a: string, b: string | null) {
  if (!b) return 999
  const aa = new Date(`${a}T12:00:00Z`).getTime()
  const bb = new Date(`${b}T12:00:00Z`).getTime()
  return Math.abs(Math.round((aa - bb) / 86400000))
}

function fmtMoney(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} EGP`
  }
}

function fmtDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date)
}

function methodLabel(value: string) {
  if (value === 'bank_transfer') return 'Bank transfer'
  if (value === 'instapay') return 'Instapay'
  if (value === 'card') return 'Card'
  if (value === 'cash') return 'Cash'
  return value
}

export default function BankPaymentMatcher(props: Props) {
  const router = useRouter()
  const [batchId, setBatchId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [releaseReason, setReleaseReason] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const matchedAmount = props.activeMatches.reduce((sum, row) => sum + Number(row.matched_amount ?? 0), 0)
  const bankRemaining = Math.max(0, props.transactionAmount - matchedAmount)

  const candidateBatches = useMemo(() => {
    return props.batches
      .filter((batch) => {
        if (batch.legacy_matched) return false
        return Math.max(0, batch.counted_amount - batch.active_matched_amount) > 0.009
      })
      .map((batch) => {
        const remaining = Math.max(0, batch.counted_amount - batch.active_matched_amount)
        const distance = dateDistance(props.transactionDate, batch.business_date)
        const exact = Math.abs(remaining - bankRemaining) < 0.01
        let score = exact ? 100 : 0
        if (distance === 0) score += 40
        else if (distance === 1) score += 30
        else if (distance <= 3) score += 20
        else if (distance <= 7) score += 10
        if (['bank_transfer', 'instapay', 'card'].includes(batch.payment_method)) score += 5
        return { ...batch, remaining, distance, exact, score }
      })
      .filter((batch) => batch.distance <= 14 || batch.exact)
      .sort((a, b) => b.score - a.score || a.distance - b.distance)
      .slice(0, 12)
  }, [props.batches, props.transactionDate, bankRemaining])

  const selected = candidateBatches.find((row) => row.id === batchId) ?? null

  function chooseBatch(id: string) {
    setBatchId(id)
    const row = candidateBatches.find((candidate) => candidate.id === id)
    setAmount(row ? Math.min(bankRemaining, row.remaining).toFixed(2) : '')
  }

  async function call(body: Record<string, unknown>) {
    const response = await fetch('/api/admin/banking/reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Reconciliation action failed.')
    return data
  }

  async function match() {
    if (!batchId || !amount || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await call({
        action: 'match',
        bank_transaction_id: props.transactionId,
        batch_id: batchId,
        matched_amount: Number(amount),
        note,
      })
      setBatchId('')
      setAmount('')
      setNote('')
      setNotice('Bank credit matched to payment batch.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally {
      setBusy(false)
    }
  }

  async function release(matchId: string) {
    const reason = String(releaseReason[matchId] ?? '').trim()
    if (!reason || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await call({ action: 'release', match_id: matchId, reason })
      setNotice('Match released. Audit history preserved.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-slate-50/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">
        Payment reconciliation · {fmtMoney(matchedAmount)} / {fmtMoney(props.transactionAmount)}
      </summary>

      <div className="mt-3 space-y-4">
        {props.activeMatches.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Active matches</p>
            {props.activeMatches.map((match) => {
              const batch = props.batches.find((row) => row.id === match.batch_id)
              return (
                <div key={match.id} className="rounded-xl border bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {batch ? `${methodLabel(batch.payment_method)} · ${fmtDate(batch.business_date)}` : `Batch ${match.batch_id.slice(0, 8)}`}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted))]">Batch {match.batch_id.slice(0, 8)}{match.note ? ` · ${match.note}` : ''}</p>
                    </div>
                    <p className="font-semibold text-emerald-700">{fmtMoney(match.matched_amount)}</p>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={releaseReason[match.id] ?? ''}
                      onChange={(event) => setReleaseReason((current) => ({ ...current, [match.id]: event.target.value }))}
                      placeholder="Reason to release this match…"
                      maxLength={500}
                      className="flex-1 rounded-xl border px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={busy || !String(releaseReason[match.id] ?? '').trim()}
                      onClick={() => void release(match.id)}
                      className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-40"
                    >
                      Release match
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {bankRemaining > 0.009 ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Match remaining bank credit</p>
              <p className="text-xs text-[hsl(var(--muted))]">
                Remaining {fmtMoney(bankRemaining)}. Candidates are ranked by amount and date proximity; nothing is matched automatically.
              </p>
            </div>

            <label className="block space-y-1 text-sm">
              <span className="font-medium">Payment batch</span>
              <select value={batchId} onChange={(event) => chooseBatch(event.target.value)} className="w-full rounded-xl border bg-white px-3 py-2">
                <option value="">Choose candidate…</option>
                {candidateBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {methodLabel(batch.payment_method)} · {fmtDate(batch.business_date)} · remaining {fmtMoney(batch.remaining)}{batch.exact ? ' · exact amount' : ''}
                  </option>
                ))}
              </select>
            </label>

            {selected ? (
              <div className="grid gap-2 rounded-xl border bg-white p-3 text-xs sm:grid-cols-4">
                <div><span className="text-[hsl(var(--muted))]">Method</span><br /><strong>{methodLabel(selected.payment_method)}</strong></div>
                <div><span className="text-[hsl(var(--muted))]">Business date</span><br /><strong>{fmtDate(selected.business_date)}</strong></div>
                <div><span className="text-[hsl(var(--muted))]">Batch counted</span><br /><strong>{fmtMoney(selected.counted_amount)}</strong></div>
                <div><span className="text-[hsl(var(--muted))]">Batch remaining</span><br /><strong>{fmtMoney(selected.remaining)}</strong></div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Matched amount</span>
                <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-xl border bg-white px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Note</span>
                <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional reconciliation note…" className="w-full rounded-xl border bg-white px-3 py-2" />
              </label>
              <button type="button" disabled={busy || !batchId || !amount || Number(amount) <= 0} onClick={() => void match()} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? 'Matching…' : 'Confirm match'}
              </button>
            </div>

            {!candidateBatches.length ? (
              <p className="text-sm text-amber-800">No active payment batch within the candidate window. Validate the payment scope first or widen your review period.</p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">This bank credit is fully matched.</div>
        )}

        {notice ? <p className="text-sm font-medium text-emerald-700">{notice}</p> : null}
        {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
      </div>
    </details>
  )
}
