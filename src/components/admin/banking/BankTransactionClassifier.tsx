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
  categories: BankCategory[]
}

export default function BankTransactionClassifier({
  transactionId,
  direction,
  currentCategory,
  currentStatus,
  currentNote,
  categories,
}: Props) {
  const router = useRouter()
  const [category, setCategory] = useState(currentCategory ?? '')
  const [status, setStatus] = useState<'unclassified' | 'suggested' | 'confirmed'>(currentStatus)
  const [note, setNote] = useState(currentNote ?? '')
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

  async function saveConfirmed() {
    if (!category || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await call({
        action: 'classify',
        transaction_id: transactionId,
        category_code: category,
        status: 'confirmed',
        note,
      })
      setStatus('confirmed')
      setNotice('Classification confirmed.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally {
      setBusy(false)
    }
  }

  async function suggest() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const data = await call({ action: 'suggest', transaction_id: transactionId })
      if (!data.suggestion) {
        setNotice('No rule matched this transaction.')
      } else {
        setCategory(data.suggestion.category_code ?? '')
        setStatus('suggested')
        setNote(data.suggestion.classification_note ?? '')
        setNotice(`Suggestion: ${data.rule?.name ?? 'rule match'}`)
        router.refresh()
      }
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await call({ action: 'clear', transaction_id: transactionId })
      setCategory('')
      setStatus('unclassified')
      setNote('')
      setNotice('Classification cleared.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-slate-50/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">Classification</summary>

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-xl border bg-white px-3 py-2"
            >
              <option value="">Choose category…</option>
              {allowed.map((row) => (
                <option key={row.code} value={row.code}>{row.label}</option>
              ))}
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

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Internal note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder="Optional note…"
            className="w-full rounded-xl border bg-white px-3 py-2"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void suggest()}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Suggest
          </button>
          <button
            type="button"
            disabled={busy || !category}
            onClick={() => void saveConfirmed()}
            className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirm category
          </button>
          <button
            type="button"
            disabled={busy || (!category && status === 'unclassified')}
            onClick={() => void clear()}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        {notice ? <p className="text-xs font-medium text-emerald-700">{notice}</p> : null}
        {error ? <p className="text-xs font-medium text-rose-700">{error}</p> : null}
      </div>
    </details>
  )
}
