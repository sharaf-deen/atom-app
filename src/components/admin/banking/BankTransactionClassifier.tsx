'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type BankCategory = {
  code: string
  label: string
  direction_scope: 'credit' | 'debit' | 'both'
}

type Props = {
  transactionId: string
  direction: 'credit' | 'debit'
  currentCategory: string | null
  currentStatus: 'unclassified' | 'suggested' | 'confirmed'
  currentNote: string | null
  currentConfidence: number | null
  currentReason: string | null
  currentRuleId: string | null
  categories: BankCategory[]
}

function confidenceLabel(value: number | null) {
  if (value == null) return null
  if (value >= 0.9) return `High · ${Math.round(value * 100)}%`
  if (value >= 0.75) return `Medium · ${Math.round(value * 100)}%`
  return `Low · ${Math.round(value * 100)}%`
}

export default function BankTransactionClassifier({
  transactionId,
  direction,
  currentCategory,
  currentStatus,
  currentNote,
  currentConfidence,
  currentReason,
  currentRuleId,
  categories,
}: Props) {
  const router = useRouter()
  const [category, setCategory] = useState(currentCategory ?? '')
  const [status, setStatus] = useState<'unclassified' | 'suggested' | 'confirmed'>(currentStatus)
  const [note, setNote] = useState(currentNote ?? '')
  const [confidence, setConfidence] = useState<number | null>(currentConfidence)
  const [reason, setReason] = useState(currentReason ?? '')
  const [ruleId, setRuleId] = useState(currentRuleId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allowed = categories.filter((row) => row.direction_scope === 'both' || row.direction_scope === direction)

  async function call(body: Record<string, unknown>) {
    const response = await fetch('/api/admin/banking/classification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Bank classification failed.')
    return data
  }

  async function confirm() {
    if (!category || busy) return
    setBusy(true); setNotice(null); setError(null)
    try {
      await call({ action: 'classify', transaction_id: transactionId, category_code: category, note })
      setStatus('confirmed'); setConfidence(1); setReason('Confirmed manually by Super Admin'); setRuleId(null)
      setNotice('Classification confirmed.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally { setBusy(false) }
  }

  async function suggest() {
    if (busy) return
    setBusy(true); setNotice(null); setError(null)
    try {
      const data = await call({ action: 'suggest', transaction_id: transactionId })
      if (!data.suggestion) {
        setNotice('No active rule matched this transaction.')
      } else {
        setCategory(data.suggestion.category_code ?? '')
        setStatus('suggested')
        setNote(data.suggestion.classification_note ?? '')
        setConfidence(Number(data.suggestion.classification_confidence ?? 0))
        setReason(data.suggestion.classification_reason ?? '')
        setRuleId(data.suggestion.classification_rule_id ?? null)
        setNotice(`Suggestion: ${data.rule?.name ?? 'rule match'}`)
        router.refresh()
      }
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally { setBusy(false) }
  }

  async function learn() {
    if (!category || busy) return
    setBusy(true); setNotice(null); setError(null)
    try {
      const data = await call({ action: 'learn', transaction_id: transactionId, category_code: category })
      setNotice(`Learning rule saved. ${data.suggested ?? 0} similar transaction(s) suggested for review.`)
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally { setBusy(false) }
  }

  async function confirmRuleMatches() {
    if (!ruleId || busy) return
    setBusy(true); setNotice(null); setError(null)
    try {
      const data = await call({ action: 'confirm_rule_matches', rule_id: ruleId })
      setNotice(`${data.confirmed ?? 0} suggested transaction(s) confirmed from this rule.`)
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally { setBusy(false) }
  }

  async function clear() {
    if (busy) return
    setBusy(true); setNotice(null); setError(null)
    try {
      await call({ action: 'clear', transaction_id: transactionId })
      setCategory(''); setStatus('unclassified'); setNote(''); setConfidence(null); setReason(''); setRuleId(null)
      setNotice('Classification cleared.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally { setBusy(false) }
  }

  const confLabel = confidenceLabel(confidence)

  return (
    <details className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-slate-50/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">
        Classification
        {status === 'suggested' && confLabel ? <span className="ml-2 text-xs font-medium text-amber-700">{confLabel}</span> : null}
      </summary>

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-xl border bg-white px-3 py-2">
              <option value="">Choose category…</option>
              {allowed.map((row) => <option key={row.code} value={row.code}>{row.label}</option>)}
            </select>
          </label>

          <div className="space-y-1 text-sm">
            <span className="font-medium">Status</span>
            <div className={`rounded-xl border px-3 py-2 ${
              status === 'confirmed'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : status === 'suggested'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-white text-slate-700'
            }`}>
              {status === 'confirmed' ? 'Confirmed' : status === 'suggested' ? 'Suggested' : 'Unclassified'}
            </div>
          </div>
        </div>

        {status === 'suggested' && reason ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">{confLabel ?? 'Rule suggestion'}</div>
            <div className="mt-1">{reason}</div>
          </div>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Internal note</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Optional note…" className="w-full rounded-xl border bg-white px-3 py-2" />
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || status === 'confirmed'} onClick={() => void suggest()} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40">
            Suggest
          </button>
          <button type="button" disabled={busy || !category} onClick={() => void confirm()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Confirm category
          </button>
          <button type="button" disabled={busy || !category} onClick={() => void learn()} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 disabled:opacity-40">
            Learn from this
          </button>
          {status === 'suggested' && ruleId ? (
            <button type="button" disabled={busy} onClick={() => void confirmRuleMatches()} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-40">
              Confirm all from this rule
            </button>
          ) : null}
          <button type="button" disabled={busy || (!category && status === 'unclassified')} onClick={() => void clear()} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40">
            Clear
          </button>
        </div>

        <p className="text-xs text-[hsl(var(--muted))]">
          Learning creates a review rule from this transaction. It suggests similar transactions but never confirms them automatically.
        </p>

        {notice ? <p className="text-xs font-medium text-emerald-700">{notice}</p> : null}
        {error ? <p className="text-xs font-medium text-rose-700">{error}</p> : null}
      </div>
    </details>
  )
}
