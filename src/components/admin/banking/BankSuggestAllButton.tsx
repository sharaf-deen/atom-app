'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function BankSuggestAllButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const response = await fetch('/api/admin/banking/classification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest_all' }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Suggestion run failed.')
      setNotice(`${data.updated ?? 0} transaction(s) received a suggestion.`)
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
      >
        {busy ? 'Analyzing…' : 'Suggest classifications'}
      </button>
      {notice ? <span className="text-xs text-emerald-700">{notice}</span> : null}
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </div>
  )
}
