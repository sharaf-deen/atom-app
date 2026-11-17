'use client'

import { useEffect, useMemo, useState } from 'react'

type Payment = {source:string;id:string;amount:number;date:string}
type CibRow = {row:number;date:string;settlement_date:string;amount_cents:number;approval_code:string;batch:string}
type CandidateMatch = {transaction:CibRow;candidates:Payment[]}
type GroupReview = {row:number;groups:Array<{payments:Payment[];conflicts_with_other_cib_rows:boolean}>}
type Approval = {
  id:string;terminal_batch:string;transaction_date:string;approval_code:string;gross_cents:number;
  approved_at:string;approved_by:string;evidence_note:string;released_at:string|null;release_reason:string|null;
  cib_card_approval_items:Array<{source_kind:string;source_id:string;amount_cents:number}>
}
const money=(v:number)=>new Intl.NumberFormat('en-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)
export default function CibReviewApprovalPanel({matches,grouped}:{matches:CandidateMatch[];grouped:GroupReview[]}) {
  const [selectedRow,setSelectedRow]=useState('')
  const [selectedPaymentKeys,setSelectedPaymentKeys]=useState<string[]>([])
  const [evidence,setEvidence]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const [approvals,setApprovals]=useState<Approval[]>([])
  const [releaseId,setReleaseId]=useState('')
  const [releaseReason,setReleaseReason]=useState('')
  const transaction=matches.find(m=>String(m.transaction.row)===selectedRow)?.transaction
  const group=grouped.find(g=>String(g.row)===selectedRow)
  const choices=useMemo(()=>{
    const unique=new Map<string,Payment>()
    for(const candidate of matches.find(m=>String(m.transaction.row)===selectedRow)?.candidates??[])
      unique.set(candidate.source+':'+candidate.id,candidate)
    for(const option of group?.groups??[]) for(const payment of option.payments)
      unique.set(payment.source+':'+payment.id,payment)
    return [...unique.values()]
  },[matches,group,selectedRow])
  const selected=choices.filter(p=>selectedPaymentKeys.includes(p.source+':'+p.id))
  const gross=selected.reduce((n,p)=>n+Math.round(p.amount*100),0)
  const valid=Boolean(transaction&&gross===transaction.amount_cents&&selected.length>=1&&selected.length<=4&&evidence.trim().length>=12)
  async function refresh(){
    const response=await fetch('/api/admin/banking/cib-card-approvals',{cache:'no-store'})
    const body=await response.json()
    if(!response.ok||!body.ok)throw Error(body.error??'Unable to retrieve approvals')
    setApprovals(body.approvals??[])
  }
  useEffect(()=>{void refresh().catch(()=>setError('Approval history unavailable; check the database migration.'))},[])
  async function approve(){
    if(!transaction||!valid||saving)return
    setSaving(true);setError('');setMessage('')
    try{
      const response=await fetch('/api/admin/banking/cib-card-approvals',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          batch:transaction.batch,transaction_date:transaction.date,
          settlement_date:transaction.settlement_date,approval_code:transaction.approval_code,
          gross_cents:transaction.amount_cents,
          items:selected.map(p=>({source:p.source,id:p.id})),evidence_note:evidence.trim()
        })
      })
      const body=await response.json()
      if(!response.ok||!body.ok)throw Error(body.details??body.error??'Approval rejected')
      setMessage('Allocation approved in the audit ledger; no financial transaction was created.')
      setSelectedPaymentKeys([]);setEvidence('');await refresh()
    }catch(e){setError(e instanceof Error?e.message:'Approval rejected')}
    finally{setSaving(false)}
  }
  async function release(){
    if(!releaseId||releaseReason.trim().length<12||saving)return
    setSaving(true);setError('');setMessage('')
    try{
      const response=await fetch('/api/admin/banking/cib-card-approvals',{
        method:'DELETE',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:releaseId,reason:releaseReason.trim()})
      })
      const body=await response.json()
      if(!response.ok||!body.ok)throw Error(body.details??body.error??'Release rejected')
      setMessage('Allocation released; history retained.')
      setReleaseId('');setReleaseReason('');await refresh()
    }catch(e){setError(e instanceof Error?e.message:'Release rejected')}
    finally{setSaving(false)}
  }
  return <section className="space-y-3 rounded-2xl border bg-white p-5">
    <h3 className="text-lg font-semibold">CIB Reconciliation — Review &amp; Approval</h3>
    <p className="text-sm text-slate-600">Super Admin only. Explicit attestation with independent receipt evidence. This audit ledger does not change Banking, Payments, subscriptions or payroll. A payment may belong to only one active approval.</p>
    <p className="text-sm">Active approvals: <strong>{approvals.filter(a=>!a.released_at).length}</strong> · Released: {approvals.filter(a=>a.released_at).length}</p>
    <label className="block space-y-1 text-sm"><span>Choose CIB card transaction</span>
      <select value={selectedRow} onChange={e=>{setSelectedRow(e.target.value);setSelectedPaymentKeys([]);setEvidence('')}} className="w-full rounded-lg border p-2">
        <option value="">Select transaction</option>
        {matches.map(m=><option key={m.transaction.row} value={String(m.transaction.row)}>
          {m.transaction.date} · EGP {money(m.transaction.amount_cents/100)} · {m.transaction.approval_code} · CSV row {m.transaction.row}
        </option>)}
      </select>
    </label>
    {transaction?<div className="space-y-2 rounded-xl border p-3 text-sm">
      <p><strong>CIB:</strong> {transaction.date} · {transaction.batch} · Authorization {transaction.approval_code} · Gross EGP {money(transaction.amount_cents/100)}</p>
      <p className="text-xs text-amber-800">Candidate dates and sums are not sufficient documentary proof. Check receipts and existing approvals before confirmation.</p>
      {group?.groups.length?<div className="space-y-1">
        <strong>{group.groups.length} suggested grouped combinations</strong>
        {group.groups.map((g,i)=><button key={i} type="button" className="block rounded-lg border px-3 py-2 text-left text-xs" onClick={()=>setSelectedPaymentKeys(g.payments.map(p=>p.source+':'+p.id))}>
          Load group {i+1}: {g.payments.map(p=>money(p.amount)).join(' + ')}
          {g.conflicts_with_other_cib_rows?' · Conflicts with other CIB candidates':''}
        </button>)}
      </div>:null}
      <div className="space-y-1"><strong>Choose 1–4 ATOM source payments</strong>
        {choices.length===0?<p>No candidate available for this CIB row.</p>:choices.map(p=>{
          const key=p.source+':'+p.id
          return <label key={key} className="flex items-center gap-2 rounded-lg border p-2">
            <input type="checkbox" checked={selectedPaymentKeys.includes(key)} onChange={e=>setSelectedPaymentKeys(old=>e.target.checked?[...old,key]:old.filter(v=>v!==key))}/>
            <span>{p.source} · {p.date} · EGP {money(p.amount)} · {p.id.slice(0,8)}…</span>
          </label>
        })}
      </div>
      <p className={gross===transaction.amount_cents?'font-semibold text-green-700':'font-semibold text-amber-800'}>Selected gross EGP {money(gross/100)} / CIB EGP {money(transaction.amount_cents/100)}</p>
      <label className="block space-y-1"><span>Independent receipt evidence / reasoning (required, minimum 12 characters)</span>
        <textarea value={evidence} onChange={e=>setEvidence(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-lg border p-2" placeholder="Explain the verified receipt or terminal reference. Do not enter full card numbers."/>
      </label>
      <button type="button" disabled={!valid||saving} onClick={approve} className="rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">Approve reviewed allocation</button>
    </div>:null}
    {error?<p role="alert" className="rounded-lg border border-red-300 p-3 text-sm text-red-800">{error}</p>:null}
    {message?<p role="status" className="rounded-lg border p-3 text-sm">{message}</p>:null}
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer font-semibold">Approval history ({approvals.length})</summary>
      <div className="mt-3 space-y-2 text-xs">{approvals.map(a=><div className="rounded-lg border p-3" key={a.id}>
        <p><strong>{a.released_at?'Released':'Approved'}</strong> · {a.transaction_date} · {a.terminal_batch} · CIB {a.approval_code} · EGP {money(a.gross_cents/100)}</p>
        <p>ATOM: {a.cib_card_approval_items.map(i=>i.source_kind+' '+i.source_id.slice(0,8)+'…').join(' + ')}</p>
        <p>Approved {new Date(a.approved_at).toLocaleString()} by {a.approved_by.slice(0,8)}…</p>
        <p>Evidence: {a.evidence_note}</p>
        {a.released_at?<p>Released: {a.release_reason}</p>:<button type="button" className="rounded-lg border px-3 py-1" onClick={()=>{setReleaseId(a.id);setReleaseReason('')}}>Release allocation</button>}
      </div>)}</div>
      {releaseId?<div className="mt-3 space-y-2 text-sm">
        <p>Release reason (minimum 12 characters; preserved in audit history)</p>
        <textarea value={releaseReason} onChange={e=>setReleaseReason(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-lg border p-2"/>
        <button type="button" disabled={saving||releaseReason.trim().length<12} className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50" onClick={release}>Confirm release</button>
        <button type="button" className="ml-2 rounded-lg border px-3 py-2" onClick={()=>setReleaseId('')}>Cancel</button>
      </div>:null}
    </details>
  </section>
}
