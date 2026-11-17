'use client'

import { useState } from 'react'

type Totals = { count: number; gross: number; fees: number; net: number }
type Comparison = { date: string; merchant: Totals; transactions: Totals; status: 'matched' | 'difference' }
type Result = {
  ok: boolean; read_only: boolean; rows: { transactions: number; statements: number }
  by_sale_month: Array<{month: string} & Totals>; comparisons: Comparison[]
  matched: number; differences: number; notice: string
}

const money = (amount: number) => new Intl.NumberFormat('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)

export default function CibPreviewUploader() {
  const [transactions, setTransactions] = useState<File | null>(null)
  const [merchants, setMerchants] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!transactions || !merchants || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      const form = new FormData()
      form.set('transactions', transactions)
      form.set('merchants', merchants)
      const response = await fetch('/api/admin/banking/cib-preview', { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.details ?? data.error ?? 'Comparison failed')
      setResult(data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Comparison failed')
    } finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <form onSubmit={preview} className="space-y-4 rounded-2xl border bg-white p-5">
      <p className="text-sm text-slate-700">Export the two CIB Excel reports as CSV (UTF-8) first. Upload the transactions and merchant settlements separately. No information is saved to ATOM.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          <span>Daily Transactions Report (CSV)</span>
          <input type="file" accept=".csv,text/csv" onChange={e => { setTransactions(e.target.files?.[0] ?? null); setResult(null) }} className="block w-full rounded-xl border p-3 text-sm" required />
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>Daily Merchants Report (CSV)</span>
          <input type="file" accept=".csv,text/csv" onChange={e => { setMerchants(e.target.files?.[0] ?? null); setResult(null) }} className="block w-full rounded-xl border p-3 text-sm" required />
        </label>
      </div>
      <button className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={busy || !transactions || !merchants}>
        {busy ? 'Comparing…' : 'Preview CIB reconciliation'}
      </button>
      {error ? <p role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{error}</p> : null}
    </form>
    {result ? <section className="space-y-4" aria-live="polite">
      <div className="rounded-xl border p-4 text-sm">
        <strong>Read-only comparison:</strong> {result.rows.transactions} transactions, {result.rows.statements} merchant statements.
        <p>{result.matched} settlement dates matched · {result.differences} differences require review.</p>
        <p className="mt-1 text-slate-600">{result.notice}</p>
      </div>
      <section className="overflow-x-auto rounded-xl border p-4">
        <h2 className="mb-3 font-semibold">Transactions by sale month</h2>
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b"><th className="p-2">Month</th><th className="p-2">Count</th><th className="p-2">Gross EGP</th><th className="p-2">Fees EGP</th><th className="p-2">Net EGP</th></tr></thead>
          <tbody>{result.by_sale_month.map(row => <tr key={row.month} className="border-b">
            <td className="p-2">{row.month}</td><td className="p-2">{row.count}</td>
            <td className="p-2">{money(row.gross)}</td><td className="p-2">{money(row.fees)}</td><td className="p-2">{money(row.net)}</td>
          </tr>)}</tbody>
        </table>
      </section>
      <section className="overflow-x-auto rounded-xl border p-4">
        <h2 className="mb-3 font-semibold">Settlement day reconciliation</h2>
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b"><th className="p-2">Settlement date</th><th className="p-2">Merchant gross</th><th className="p-2">Transaction gross</th><th className="p-2">Merchant net</th><th className="p-2">Transaction net</th><th className="p-2">Result</th></tr></thead>
          <tbody>{result.comparisons.map((row,i) => <tr key={row.date+'-'+i} className="border-b">
            <td className="p-2">{row.date}</td><td className="p-2">{money(row.merchant.gross)}</td><td className="p-2">{money(row.transactions.gross)}</td>
            <td className="p-2">{money(row.merchant.net)}</td><td className="p-2">{money(row.transactions.net)}</td>
            <td className={row.status === 'matched' ? 'p-2 text-emerald-700' : 'p-2 font-bold text-rose-700'}>{row.status}</td>
          </tr>)}</tbody>
        </table>
      </section>
    </section> : null}
  </div>
}
