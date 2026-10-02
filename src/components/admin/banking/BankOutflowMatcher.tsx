'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type OutflowSource = {
  kind: 'expense' | 'staff_payroll_payment' | 'membership_refund'
  id: string
  date: string
  label: string
  sublabel: string
  amount: number
  payment_method: string | null
  active_matched_amount: number
}

export type OutflowMatch = {
  id: string
  bank_transaction_id: string
  source_kind: OutflowSource['kind']
  source_id: string
  matched_amount: number
  note: string | null
  matched_at: string
}

function fmtMoney(v:number){try{return new Intl.NumberFormat('en-EG',{style:'currency',currency:'EGP',maximumFractionDigits:2}).format(v)}catch{return `${v.toFixed(2)} EGP`}}
function fmtDate(v:string){const d=new Date(`${v}T12:00:00Z`);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(d)}
function distance(a:string,b:string){return Math.abs(Math.round((new Date(`${a}T12:00:00Z`).getTime()-new Date(`${b}T12:00:00Z`).getTime())/86400000))}
function kindLabel(k:OutflowSource['kind']){return k==='expense'?'Expense':k==='staff_payroll_payment'?'Payroll':'Membership refund'}

export default function BankOutflowMatcher(props:{
  transactionId:string
  transactionDate:string
  transactionAmount:number
  activeMatches:OutflowMatch[]
  sources:OutflowSource[]
}) {
  const router=useRouter()
  const [sourceKey,setSourceKey]=useState('')
  const [amount,setAmount]=useState('')
  const [note,setNote]=useState('')
  const [reasons,setReasons]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)

  const matched=props.activeMatches.reduce((s,r)=>s+r.matched_amount,0)
  const remaining=Math.max(0,props.transactionAmount-matched)

  const candidates=useMemo(()=>props.sources.map(s=>{
    const sourceRemaining=Math.max(0,s.amount-s.active_matched_amount)
    const days=distance(props.transactionDate,s.date)
    const exact=Math.abs(sourceRemaining-remaining)<0.01
    let score=exact?100:0
    if(days===0)score+=40
    else if(days===1)score+=30
    else if(days<=3)score+=20
    else if(days<=7)score+=10
    return {...s,sourceRemaining,days,exact,score,key:`${s.kind}:${s.id}`}
  }).filter(s=>s.sourceRemaining>0.009&&(s.days<=14||s.exact))
    .sort((a,b)=>b.score-a.score||a.days-b.days).slice(0,15),[props.sources,props.transactionDate,remaining])

  const selected=candidates.find(s=>s.key===sourceKey)||null

  function choose(key:string){
    setSourceKey(key)
    const s=candidates.find(x=>x.key===key)
    setAmount(s?Math.min(remaining,s.sourceRemaining).toFixed(2):'')
  }

  async function call(body:Record<string,unknown>){
    const r=await fetch('/api/admin/banking/outflows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    const d=await r.json()
    if(!r.ok||!d?.ok)throw new Error(d?.details||d?.error||'Outflow reconciliation failed.')
    return d
  }

  async function match(){
    if(!selected||!amount||busy)return
    setBusy(true);setNotice(null);setError(null)
    try{
      await call({action:'match',bank_transaction_id:props.transactionId,source_kind:selected.kind,source_id:selected.id,matched_amount:Number(amount),note})
      setSourceKey('');setAmount('');setNote('');setNotice('Bank debit matched to ATOM outflow.');router.refresh()
    }catch(e:any){setError(String(e?.message??e))}finally{setBusy(false)}
  }

  async function release(id:string){
    const reason=String(reasons[id]??'').trim()
    if(!reason||busy)return
    setBusy(true);setNotice(null);setError(null)
    try{
      await call({action:'release',match_id:id,reason});setNotice('Match released. Audit history preserved.');router.refresh()
    }catch(e:any){setError(String(e?.message??e))}finally{setBusy(false)}
  }

  return <details className="mt-3 rounded-xl border bg-slate-50/60 px-3 py-2">
    <summary className="cursor-pointer text-sm font-semibold">Outflow reconciliation · {fmtMoney(matched)} / {fmtMoney(props.transactionAmount)}</summary>
    <div className="mt-3 space-y-4">
      {props.activeMatches.map(m=>{
        const s=props.sources.find(x=>x.kind===m.source_kind&&x.id===m.source_id)
        return <div key={m.id} className="rounded-xl border bg-white p-3">
          <div className="flex flex-wrap justify-between gap-2">
            <div><p className="text-sm font-semibold">{s?`${kindLabel(s.kind)} · ${s.label}`:`${kindLabel(m.source_kind)} · ${m.source_id.slice(0,8)}`}</p><p className="text-xs text-[hsl(var(--muted))]">{s?fmtDate(s.date):''}{m.note?` · ${m.note}`:''}</p></div>
            <p className="font-semibold text-rose-700">{fmtMoney(m.matched_amount)}</p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={reasons[m.id]??''} onChange={e=>setReasons(r=>({...r,[m.id]:e.target.value}))} placeholder="Reason to release…" maxLength={500} className="flex-1 rounded-xl border px-3 py-2 text-sm"/>
            <button type="button" disabled={busy||!String(reasons[m.id]??'').trim()} onClick={()=>void release(m.id)} className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-40">Release match</button>
          </div>
        </div>
      })}

      {remaining>0.009?<div className="space-y-3">
        <p className="text-xs text-[hsl(var(--muted))]">Remaining {fmtMoney(remaining)}. Candidates are ranked by amount and date proximity; nothing is matched automatically.</p>
        <label className="block space-y-1 text-sm"><span className="font-medium">ATOM outflow</span>
          <select value={sourceKey} onChange={e=>choose(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2">
            <option value="">Choose candidate…</option>
            {candidates.map(s=><option key={s.key} value={s.key}>{kindLabel(s.kind)} · {fmtDate(s.date)} · {s.label} · remaining {fmtMoney(s.sourceRemaining)}{s.exact?' · exact amount':''}</option>)}
          </select>
        </label>
        {selected?<div className="grid gap-2 rounded-xl border bg-white p-3 text-xs sm:grid-cols-4">
          <div><span className="text-[hsl(var(--muted))]">Type</span><br/><strong>{kindLabel(selected.kind)}</strong></div>
          <div><span className="text-[hsl(var(--muted))]">Date</span><br/><strong>{fmtDate(selected.date)}</strong></div>
          <div><span className="text-[hsl(var(--muted))]">Amount</span><br/><strong>{fmtMoney(selected.amount)}</strong></div>
          <div><span className="text-[hsl(var(--muted))]">Remaining</span><br/><strong>{fmtMoney(selected.sourceRemaining)}</strong></div>
        </div>:null}
        <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
          <label className="space-y-1 text-sm"><span className="font-medium">Matched amount</span><input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full rounded-xl border px-3 py-2"/></label>
          <label className="space-y-1 text-sm"><span className="font-medium">Note</span><input value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="Optional note…" className="w-full rounded-xl border px-3 py-2"/></label>
          <button type="button" disabled={busy||!selected||!amount||Number(amount)<=0} onClick={()=>void match()} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy?'Matching…':'Confirm match'}</button>
        </div>
        {!candidates.length?<p className="text-sm text-amber-800">No matching ATOM outflow found in the candidate window.</p>:null}
      </div>:<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">This bank debit is fully matched.</div>}
      {notice?<p className="text-sm font-medium text-emerald-700">{notice}</p>:null}
      {error?<p className="text-sm font-medium text-rose-700">{error}</p>:null}
    </div>
  </details>
}
