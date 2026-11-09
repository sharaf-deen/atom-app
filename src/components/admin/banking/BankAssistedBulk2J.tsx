'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Credit = {
  id: string; transaction_date: string; description: string; reference: string | null
  amount: number; currency: string; category_code: string | null; matched: number
}
type Batch = {
  id: string; business_date: string | null; payment_method: string
  validation_mode?: string; counted_amount: number; difference_amount: number
  legacy_matched: boolean; active_matched_amount: number
}
type Selection = { batchId: string; evidence: string; verified: boolean }
type Props = { credits: Credit[]; batches: Batch[] }

const cents = (n: number) => Math.round(Number(n) * 100)
const day = (s: string) => Math.floor(Date.parse(s.slice(0, 10) + 'T12:00:00Z') / 86400000)
const distance = (a: string, b: string) => Math.abs(day(a) - day(b))
const money = (n: number) => new Intl.NumberFormat('en-EG', {style: 'currency', currency: 'EGP'}).format(n)
const isSwitch = (description: string) => /ATM Switch\s*File\s*Upload/i.test(description)

export default function BankAssistedBulk2J({ credits, batches }: Props) {
  const router = useRouter()
  const [choices, setChoices] = useState<Record<string, Selection>>({})
  const [reason, setReason] = useState('')
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [showAllCib, setShowAllCib] = useState(false)
  const active = useMemo(() => credits.filter(c => c.currency === 'EGP' && cents(c.amount - c.matched) > 0), [credits])
  const available = useMemo(() => batches.filter(b => b.validation_mode === 'daily' &&
    b.business_date && cents(b.counted_amount) > 0 && cents(b.difference_amount) === 0 &&
    cents(b.active_matched_amount) === 0 && !b.legacy_matched), [batches])
  const instant = useMemo(() => active.filter(c => c.matched === 0 &&
    c.description.toLowerCase().startsWith('ipn inward') &&
    (c.category_code === null || c.category_code === 'membership_income')).map(c => ({
      credit: c, options: available.filter(b => b.payment_method === 'instapay' &&
        cents(b.counted_amount) === cents(c.amount) && distance(b.business_date!, c.transaction_date) <= 3)
      .sort((x, y) => distance(x.business_date!, c.transaction_date) - distance(y.business_date!, c.transaction_date))
  })), [active, available])
  const cib = useMemo(() => active.filter(c => c.matched === 0 && isSwitch(c.description)).map(c => ({
    credit: c,
    options: available.filter(b => b.payment_method === 'card' &&
      day(b.business_date!) <= day(c.transaction_date) &&
      day(c.transaction_date) - day(b.business_date!) <= 7 &&
      cents(b.counted_amount) > cents(c.amount) &&
      c.amount / b.counted_amount >= 0.97)
      .map(b => ({...b, estimatedDifference: b.counted_amount - c.amount,
        estimatedPct: (b.counted_amount - c.amount) / b.counted_amount * 100}))
      .sort((a, b) => a.estimatedPct - b.estimatedPct)
      .slice(0, 5),
  })), [active, available])

  function setChoice(id: string, patch: Partial<Selection>) {
    setChoices(current => ({
      ...current, [id]: {...{batchId: '', evidence: '', verified: false}, ...current[id], ...patch}
    }))
    setApproved(false)
  }
  const selected = instant.filter(r => r.options.some(b => b.id === choices[r.credit.id]?.batchId) &&
    choices[r.credit.id]?.verified && (choices[r.credit.id]?.evidence.trim().length ?? 0) >= 15)
  const selectedBatchIds = selected.map(r => choices[r.credit.id].batchId)
  const noDuplicates = new Set(selectedBatchIds).size === selectedBatchIds.length
  const total = selected.reduce((sum, row) => sum + row.credit.amount, 0)
  const ready = !busy && approved && noDuplicates && selected.length > 0 &&
    selected.length <= 50 && reason.trim().length >= 10 && reason.trim().length <= 480

  async function confirm() {
    if (!ready) return
    setBusy(true); setNotice('')
    try {
      const response = await fetch('/api/admin/banking/reconciliation/bulk-v3', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          verified: true, reason: reason.trim(),
          pairs: selected.map(row => ({
            bank_transaction_id: row.credit.id,
            batch_id: choices[row.credit.id].batchId,
            evidence: choices[row.credit.id].evidence.trim(),
          })),
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) throw new Error(String(payload?.error ?? 'BULK_MATCH_FAILED'))
      setNotice(`Matched ${payload.result.matched_count} verified InstaPay credits. Audit history retained.`)
      setChoices({}); setReason(''); setApproved(false)
      router.refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Bulk matching failed') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-4 shadow-soft">
    <div>
      <h2 className="text-lg font-bold">Banking 2J · Assisted bulk reconciliation &amp; CIB settlements</h2>
      <p className="text-sm text-slate-600">One review page for matched evidence. Nothing is approved automatically. Existing Banking 2H and 2I controls remain available.</p>
    </div>
    <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Open InstaPay</p><strong>{instant.length}</strong></div>
      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">With candidate batch</p><strong>{instant.filter(r=>r.options.length>0).length}</strong></div>
      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">CIB Switch credits (unverified)</p><strong>{cib.length}</strong></div>
      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">CIB net bank amount</p><strong>{money(cib.reduce((n,r)=>n+r.credit.amount,0))}</strong></div>
    </div>
    <div className="space-y-3">
      <h3 className="font-semibold">InstaPay — explicit pair-by-pair evidence, one final approval</h3>
      <p className="text-xs text-amber-800">A proposed amount/date is not proof. For each pair, identify the payer/member from bank or receipt evidence, select its batch and attest you checked it. A batch cannot be used twice. No preselected pairs.</p>
      <div className="max-h-[620px] space-y-2 overflow-y-auto">
        {instant.map(r => {
          const selectedBatch = choices[r.credit.id]?.batchId ?? ''
          const state = choices[r.credit.id]
          return <div key={r.credit.id} className="rounded-xl border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <div><strong>{r.credit.transaction_date} · {money(r.credit.amount)}</strong>
                <p className="font-mono text-xs text-slate-600">{r.credit.reference ?? 'No bank reference'}</p></div>
              <a href={`#credit-${r.credit.id}`} className="text-blue-700 underline">Bank record</a>
            </div>
            <p className="mt-1 break-words text-xs text-slate-600">{r.credit.description}</p>
            {r.options.length ? <>
              <label className="mt-2 block text-xs font-medium">Validated InstaPay payment batch</label>
              <select className="mt-1 w-full rounded-lg border p-2" value={selectedBatch}
                onChange={e => setChoice(r.credit.id,{batchId:e.target.value,verified:false})}>
                <option value="">Choose only after checking the payer and supporting records</option>
                {r.options.map(b => <option key={b.id} value={b.id}>{b.business_date} · {money(b.counted_amount)} · batch {b.id.slice(0,8)}</option>)}
              </select>
              {selectedBatch ? <>
                <input className="mt-2 w-full rounded-lg border p-2 text-xs" maxLength={480}
                  placeholder="Required: payer/member or third-party relationship and source of proof (15+ characters)"
                  value={state?.evidence ?? ''} onChange={e=>setChoice(r.credit.id,{evidence:e.target.value})}/>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={state?.verified ?? false} onChange={e=>setChoice(r.credit.id,{verified:e.target.checked})}/>
                  I verified this particular bank credit and ATOM batch using independent evidence.
                </label>
              </> : null}
            </> : <p className="mt-2 text-xs text-amber-800">No exact validated InstaPay batch within three days. Requires separate investigation.</p>}
          </div>
        })}
        {!instant.length ? <p className="text-sm text-slate-500">No open InstaPay credits.</p> : null}
      </div>
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <strong>{selected.length} independently verified pair(s) · {money(total)}</strong>
        {!noDuplicates ? <p className="text-rose-700">One payment batch was selected more than once. Resolve the duplicate.</p> : null}
        <textarea className="w-full rounded-lg border p-2" rows={2} maxLength={480}
          value={reason} onChange={e=>{setReason(e.target.value);setApproved(false)}}
          placeholder="Mandatory shared audit reason, references and verification method (10–480 characters)"/>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>
          Super Admin approval: I have reviewed each selected pair and accept atomic posting of these existing payment matches.
        </label>
        <button type="button" disabled={!ready} onClick={()=>void confirm()}
          className="rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-40">
          {busy ? 'Confirming…' : `Confirm ${selected.length} verified InstaPay matches`}
        </button>
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </div>
    <div className="space-y-2 border-t pt-4">
      <h3 className="font-semibold">CIB card settlements — analytical preview only</h3>
      <p className="text-xs text-amber-800">These are ATM Switch credits, not proven internal transfers. Comparisons use a 0–3% hypothetical deduction and a settlement lag of up to seven days. Fee estimates are NOT confirmed bank fees and no matching, expense or classification is written here.</p>
      {(showAllCib ? cib : cib.slice(0,8)).map(r=><div key={r.credit.id} className="rounded-xl border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{r.credit.transaction_date} · net {money(r.credit.amount)}</strong><a className="text-blue-700 underline" href={`#credit-${r.credit.id}`}>Bank entry</a></div>
        <p className="text-xs text-slate-600">{r.credit.reference ?? 'No reference'}</p>
        {r.options.length ? <div className="mt-2 space-y-1 text-xs">
          {r.options.map(b=><p key={b.id}>Possible card batch {b.business_date} · gross {money(b.counted_amount)} · illustrative difference {money(b.estimatedDifference)} ({b.estimatedPct.toFixed(2)}%)</p>)}
        </div> : <p className="mt-2 text-xs text-amber-800">No plausible single card batch found; possible multiple-batch settlement or missing evidence.</p>}
      </div>)}
      {cib.length>8 && <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={()=>setShowAllCib(v=>!v)}>{showAllCib?'Show first 8':`Show all ${cib.length} CIB credits`}</button>}
      <p className="text-xs text-slate-500">Merchant settlement statement is required before final fee posting. Original payment revenue must never be posted a second time.</p>
    </div>
  </section>
}
