'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type DirectIncomeSource = {
  id: string
  kind: 'store_sale' | 'external_income'
  date: string
  label: string
  amount: number
  method: string
  matched: boolean
}
export type DirectIncomeMatch = {
  id: string
  bank_transaction_id: string
  source_kind: string
  source_id: string
  matched_amount: number
  matched_at: string
  note: string
}
type Props = {
  bankTransactionId: string
  transactionDate: string
  amount: number
  category: string | null
  classificationStatus: string
  batchMatched: number
  matches: DirectIncomeMatch[]
  sources: DirectIncomeSource[]
}
const formatMoney = (n: number) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
const daysApart = (a: string, b: string) =>
  Math.abs(Math.round((new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86400000))

export default function BankDirectIncomeMatcher(props: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'store_sale' | 'external_income' | 'new_small_income'>('store_sale')
  const [sourceId, setSourceId] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState(false)
  const [releaseReasons, setReleaseReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const active = props.matches.length > 0
  const candidates = useMemo(() => props.sources
    .filter(s => s.kind === mode && !s.matched &&
      Math.abs(s.amount - props.amount) < 0.009 &&
      daysApart(s.date, props.transactionDate) <= 14)
    .sort((a, b) => daysApart(a.date, props.transactionDate) - daysApart(b.date, props.transactionDate))
    .slice(0, 40), [props.sources, mode, props.amount, props.transactionDate])
  const smallEligible = props.amount <= 500 &&
    props.classificationStatus === 'confirmed' &&
    ['other_income', 'store_income'].includes(props.category ?? '')
  const canMatch = !busy && !active && props.batchMatched < 0.009 &&
    verified && note.trim().length >= 15 &&
    (mode === 'new_small_income' ? smallEligible && title.trim().length >= 5 : !!sourceId)

  async function perform(body: Record<string, unknown>) {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/banking/direct-income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok || !result.ok) throw new Error(result.details || result.error || 'Action failed')
      setMessage(body.action === 'release' ? 'Match released; audit preserved.' : 'Income match confirmed.')
      setSourceId('')
      setNote('')
      setVerified(false)
      router.refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to complete action') }
    finally { setBusy(false) }
  }
  return <details className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 px-3 py-3">
    <summary className="cursor-pointer text-sm font-semibold">
      Direct Store / Small Income reconciliation · {active ? 'Matched' : 'Review'}
    </summary>
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-xs text-slate-600">
        Link a verified existing Store sale to this credit, or explicitly record a real small receipt
        and match it in one atomic action. No subscription or payment batch is created.
      </p>
      {props.matches.map(m => <div key={m.id} className="rounded-xl border bg-white p-3">
        <p className="font-semibold">{m.source_kind === 'store_sale' ? 'Store sale' : 'Small / external income'} · {formatMoney(m.matched_amount)}</p>
        <p className="mt-1 text-xs text-slate-600">{m.note}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="flex-1 rounded-xl border px-3 py-2" placeholder="Reason for release (10+ characters)"
            value={releaseReasons[m.id] ?? ''} onChange={e => setReleaseReasons(prev => ({ ...prev, [m.id]: e.target.value }))}/>
          <button type="button" className="rounded-xl border px-3 py-2 disabled:opacity-40"
            disabled={busy || (releaseReasons[m.id] ?? '').trim().length < 10}
            onClick={() => void perform({ action: 'release', match_id: m.id, reason: releaseReasons[m.id] })}>
            Release match
          </button>
        </div>
      </div>)}
      {!active && props.batchMatched < 0.009 ? <>
        <label className="block space-y-1">
          <span className="font-medium">Income source</span>
          <select className="w-full rounded-xl border bg-white px-3 py-2" value={mode}
            onChange={e => { setMode(e.target.value as typeof mode); setSourceId(''); setVerified(false) }}>
            <option value="store_sale">Existing paid Store sale</option>
            <option value="external_income">Existing external income</option>
            <option value="new_small_income">Record and match small income (up to EGP 500)</option>
          </select>
        </label>
        {mode !== 'new_small_income' ? <label className="block space-y-1">
          <span className="font-medium">Verified source — exact amount, within 14 days</span>
          <select className="w-full rounded-xl border bg-white px-3 py-2" value={sourceId}
            onChange={e => { setSourceId(e.target.value); setVerified(false) }}>
            <option value="">Choose existing income…</option>
            {candidates.map(s => <option key={s.id} value={s.id}>
              {s.date} · {s.label} · {formatMoney(s.amount)} · {s.method}
            </option>)}
          </select>
          {!candidates.length ? <p className="text-xs text-amber-800">No eligible recorded income for this credit.</p> : null}
        </label> : <>
          {!smallEligible ? <p className="text-xs text-amber-800">
            Small-income booking requires a confirmed Other Income / Store category and a bank credit of at most EGP 500.
          </p> : null}
          <label className="block space-y-1">
            <span className="font-medium">Actual item or service sold</span>
            <input className="w-full rounded-xl border px-3 py-2" maxLength={140}
              placeholder="Example: Juice sold to Imran Semenov"
              value={title} onChange={e => setTitle(e.target.value)}/>
          </label>
          <p className="text-xs text-slate-600">
            This explicitly creates one external income record for {formatMoney(props.amount)}.
            Do not use if the sale already exists elsewhere in ATOM.
          </p>
        </>}
        <label className="block space-y-1">
          <span className="font-medium">Bank reference and supporting evidence</span>
          <input className="w-full rounded-xl border px-3 py-2" maxLength={500}
            placeholder="Describe payer, item, date, bank reference and evidence (15–500 characters)"
            value={note} onChange={e => setNote(e.target.value)}/>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)}/>
          <span>I independently verified the bank credit and income source. This income has not already been matched or duplicated.</span>
        </label>
        <button type="button" className="rounded-xl bg-black px-4 py-2 font-semibold text-white disabled:opacity-40"
          disabled={!canMatch} onClick={() => void perform({
            action: 'match', bank_transaction_id: props.bankTransactionId,
            mode, source_id: mode === 'new_small_income' ? null : sourceId,
            title: mode === 'new_small_income' ? title.trim() : null,
            note: note.trim(), verified: true,
          })}>
          {busy ? 'Saving…' : mode === 'new_small_income' ? 'Record & match small income' : 'Confirm direct match'}
        </button>
      </> : null}
      {!active && props.batchMatched >= 0.009 ? <p className="text-xs text-amber-800">
        This credit is already allocated to a payment batch. Release that match before direct reconciliation.
      </p> : null}
      {message ? <p role="status" className="rounded-xl border bg-white p-3">{message}</p> : null}
    </div>
  </details>
}
