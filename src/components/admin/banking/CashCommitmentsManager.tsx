'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type CashCommitment = {
  id: string
  label: string
  category_code: string
  amount: number
  due_date: string
  note: string | null
  status: string
}

const CATEGORIES = [
  ['rent','Rent'],
  ['supplier','Supplier'],
  ['utilities','Utilities'],
  ['taxes','Taxes'],
  ['legal_accounting','Legal / Accounting'],
  ['federation','Federation'],
  ['marketing','Marketing'],
  ['maintenance','Maintenance'],
  ['payroll_other','Payroll / Staff other'],
  ['other','Other'],
] as const

function fmtMoney(v:number){try{return new Intl.NumberFormat('en-EG',{style:'currency',currency:'EGP',maximumFractionDigits:2}).format(v)}catch{return `${v.toFixed(2)} EGP`}}
function fmtDate(v:string){const d=new Date(`${v}T12:00:00Z`);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(d)}
function labelCategory(code:string){return CATEGORIES.find(([key])=>key===code)?.[1]??code.replaceAll('_',' ')}

export default function CashCommitmentsManager({ commitments }:{ commitments:CashCommitment[] }) {
  const router=useRouter()
  const [label,setLabel]=useState('')
  const [category,setCategory]=useState('rent')
  const [amount,setAmount]=useState('')
  const [dueDate,setDueDate]=useState('')
  const [note,setNote]=useState('')
  const [reasons,setReasons]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)

  async function call(body:Record<string,unknown>){
    const r=await fetch('/api/admin/banking/cash-commitments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    const d=await r.json()
    if(!r.ok||!d?.ok)throw new Error(d?.details||d?.error||'Cash commitment action failed.')
    return d
  }

  async function create(){
    if(!label.trim()||!amount||!dueDate||busy)return
    setBusy(true);setNotice(null);setError(null)
    try{
      await call({action:'create',label,category_code:category,amount:Number(amount),due_date:dueDate,note})
      setLabel('');setAmount('');setDueDate('');setNote('')
      setNotice('Cash commitment added.');router.refresh()
    }catch(e:any){setError(String(e?.message??e))}finally{setBusy(false)}
  }

  async function settle(id:string){
    if(busy)return
    setBusy(true);setNotice(null);setError(null)
    try{await call({action:'settle',id});setNotice('Commitment marked as settled.');router.refresh()}
    catch(e:any){setError(String(e?.message??e))}finally{setBusy(false)}
  }

  async function cancel(id:string){
    const reason=String(reasons[id]??'').trim()
    if(!reason||busy)return
    setBusy(true);setNotice(null);setError(null)
    try{await call({action:'cancel',id,reason});setNotice('Commitment cancelled.');router.refresh()}
    catch(e:any){setError(String(e?.message??e))}finally{setBusy(false)}
  }

  return <div className="space-y-4">
    <div className="rounded-2xl border bg-white p-4 shadow-soft">
      <h2 className="font-semibold">Add manual commitment</h2>
      <p className="mt-1 text-sm text-[hsl(var(--muted))]">Use this only for future obligations not already derived automatically from Payroll or Membership Refunds.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1 text-sm"><span className="font-medium">Label</span><input value={label} onChange={e=>setLabel(e.target.value)} maxLength={200} placeholder="October rent…" className="w-full rounded-xl border px-3 py-2"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Category</span><select value={category} onChange={e=>setCategory(e.target.value)} className="w-full rounded-xl border px-3 py-2">{CATEGORIES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Amount</span><input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full rounded-xl border px-3 py-2"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Due date</span><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} className="w-full rounded-xl border px-3 py-2"/></label>
        <div className="flex items-end"><button type="button" disabled={busy||!label.trim()||!amount||!dueDate} onClick={()=>void create()} className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy?'Saving…':'Add commitment'}</button></div>
      </div>
      <label className="mt-3 block space-y-1 text-sm"><span className="font-medium">Note</span><input value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} placeholder="Optional internal note…" className="w-full rounded-xl border px-3 py-2"/></label>
    </div>

    <div className="rounded-2xl border bg-white p-4 shadow-soft">
      <h2 className="font-semibold">Open manual commitments</h2>
      <div className="mt-3 space-y-2">
        {commitments.map(c=><div key={c.id} className="rounded-xl border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><strong>{c.label}</strong><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{labelCategory(c.category_code)}</span></div><p className="mt-1 text-xs text-[hsl(var(--muted))]">Due {fmtDate(c.due_date)}{c.note?` · ${c.note}`:''}</p></div>
            <div className="text-left sm:text-right"><p className="font-bold">{fmtMoney(c.amount)}</p><button type="button" disabled={busy} onClick={()=>void settle(c.id)} className="mt-1 text-xs font-semibold underline">Mark settled</button></div>
          </div>
          <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-rose-700">Cancel commitment</summary><div className="mt-2 flex gap-2"><input value={reasons[c.id]??''} onChange={e=>setReasons(r=>({...r,[c.id]:e.target.value}))} placeholder="Cancellation reason…" className="flex-1 rounded-xl border px-3 py-2 text-sm"/><button type="button" disabled={busy||!String(reasons[c.id]??'').trim()} onClick={()=>void cancel(c.id)} className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-40">Cancel</button></div></details>
        </div>)}
        {!commitments.length?<p className="text-sm text-[hsl(var(--muted))]">No open manual commitments.</p>:null}
      </div>
    </div>

    {notice?<p className="text-sm font-medium text-emerald-700">{notice}</p>:null}
    {error?<p className="text-sm font-medium text-rose-700">{error}</p>:null}
  </div>
}
