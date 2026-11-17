'use client'

import { useState } from 'react'

type Candidate = {source: string; id: string; date: string; amount: number; evidence: string}
type Match = {
  transaction: {row: number; date: string; settlement_date: string; amount_cents: number; approval_code: string; batch: string}
  status: 'reference_candidate' | 'single_candidate' | 'ambiguous' | 'unmatched'
  candidates: Candidate[]
}
type Result = {
  ok: boolean
  totals: {cib_transactions: number; cib_gross: number; atom_card_records: number; atom_card_gross: number}
  aggregate: Record<Match['status'],number>
  matches: Match[]
  warning: string
}

const money = (v:number) => new Intl.NumberFormat('en-EG', {minimumFractionDigits:2,maximumFractionDigits:2}).format(v)
const statuses: Record<Match['status'],string> = {
  reference_candidate:'Reference candidate — review',
  single_candidate:'One amount/date candidate — unverified',
  ambiguous:'Ambiguous — manual review',
  unmatched:'No candidate found',
}

export default function CibPaymentPreviewUploader() {
  const [file,setFile] = useState<File|null>(null)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [result,setResult] = useState<Result|null>(null)
  const [filter,setFilter] = useState('all')
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file || loading) return
    setLoading(true);setError('');setResult(null)
    try {
      const form = new FormData()
      form.set('transactions',file)
      const response = await fetch('/api/admin/banking/cib-payment-preview',{method:'POST',body:form,cache:'no-store'})
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.details??json.error??'Comparison failed')
      setResult(json)
    } catch(e) {setError(e instanceof Error?e.message:'Comparison failed')}
    finally {setLoading(false)}
  }

  const filtered = result?.matches.filter(m=>filter==='all'||filter===m.status)??[]
  return <section className="space-y-4 rounded-2xl border bg-white p-5">
    <h2 className="text-lg font-semibold">CIB individual card payments ↔ ATOM payments</h2>
    <p className="text-sm text-slate-600">Assisted review only. CIB gross amounts are compared to card records in Memberships, Store and Other Income. Date differences of up to one calendar day are allowed. These matches are not automatically confirmed.</p>
    <form onSubmit={submit} className="flex flex-col items-start gap-3">
      <label className="w-full space-y-2 text-sm font-medium">
        <span>Daily Transactions Report (CSV)</span>
        <input type="file" required accept=".csv,text/csv" className="block w-full rounded-xl border p-3"
          onChange={e=>{setFile(e.target.files?.[0]??null);setResult(null)}}/>
      </label>
      <button type="submit" disabled={!file||loading} className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {loading?'Comparing…':'Find ATOM payment candidates'}
      </button>
    </form>
    {error?<p role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{error}</p>:null}
    {result?<div className="space-y-4" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ['CIB transactions',String(result.totals.cib_transactions)],
          ['CIB gross','EGP '+money(result.totals.cib_gross)],
          ['ATOM card records',String(result.totals.atom_card_records)],
          ['ATOM gross','EGP '+money(result.totals.atom_card_gross)]
        ] as const).map(([label,value])=><div key={label} className="rounded-xl border p-3">
          <p className="text-xs text-slate-600">{label}</p><p className="text-lg font-semibold">{value}</p>
        </div>)}
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.warning}</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">Show:
        <select value={filter} onChange={e=>setFilter(e.target.value)} className="rounded-lg border p-2">
          <option value="all">All ({result.matches.length})</option>
          {(Object.keys(statuses) as Match['status'][]).map(s=>
            <option key={s} value={s}>{statuses[s]} ({result.aggregate[s]})</option>)}
        </select>
      </label>
      <div className="space-y-2">
        {filtered.map(m=><details key={m.transaction.row} className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {m.transaction.date} · EGP {money(m.transaction.amount_cents/100)} · Batch {m.transaction.batch}
            {' · '}{statuses[m.status]} ({m.candidates.length})
          </summary>
          <div className="mt-3 space-y-2 text-xs">
            <p>CIB approval: {m.transaction.approval_code||'not provided'} · Settlement: {m.transaction.settlement_date}</p>
            {m.candidates.length?
              <div className="overflow-x-auto"><table className="w-full text-left">
                <thead><tr className="border-b"><th className="p-2">ATOM source</th><th className="p-2">ATOM record</th><th className="p-2">Date</th><th className="p-2">Gross EGP</th><th className="p-2">Basis</th></tr></thead>
                <tbody>{m.candidates.map(c=><tr className="border-b" key={c.source+c.id}>
                  <td className="p-2">{c.source}</td><td className="p-2 font-mono">{c.id.slice(0,8)}…</td>
                  <td className="p-2">{c.date}</td><td className="p-2">{money(c.amount)}</td><td className="p-2">{c.evidence}</td>
                </tr>)}</tbody>
              </table></div>:<p>No compatible ATOM card record found. Investigate other payment sources and recording errors before creating any new payment.</p>}
          </div>
        </details>)}
      </div>
    </div>:null}
  </section>
}
