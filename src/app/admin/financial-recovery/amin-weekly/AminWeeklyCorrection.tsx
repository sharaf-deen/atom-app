'use client'

import { useState } from 'react'

export default function AminWeeklyCorrection() {
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [invoice, setInvoice] = useState('')
  const [error, setError] = useState('')

  async function run(operation: 'preview' | 'apply') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/financial-recovery/amin-weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Correction failed.')
      setReady(result.ready === true)
      if (result.applied) setInvoice(result.invoiceNumber)
    } catch (error) {
      setReady(false)
      setError(error instanceof Error ? error.message : 'Correction failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Subscription correction</h1>
      <p>Amin Amin (ATOM-000607)</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Change 1 month to 1 week, from 26 November to 2 December 2026 inclusive.</li>
        <li>Keep the existing EGP 1,000 card payment and zero balance.</li>
        <li>Replace invoice INV-20261126-3F7BDF0C68 with a corrective invoice.</li>
      </ul>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {invoice ? (
        <p role="status" className="font-semibold">Correction applied. Invoice {invoice}.</p>
      ) : (
        <button type="button" disabled={busy}
          className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
          onClick={() => void run(ready ? 'apply' : 'preview')}>
          {ready ? 'Confirm correction' : 'Preview correction'}
        </button>
      )}
    </main>
  )
}
