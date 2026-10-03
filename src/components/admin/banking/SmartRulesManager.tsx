'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BankCategory } from './BankTransactionClassifier'

export type SmartRule = {
  id:string
  name:string
  category_code:string
  direction_scope:'credit'|'debit'|'both'
  match_field:'combined'|'description'|'counterparty'|'reference'
  pattern:string
  priority:number
  confidence_score:number
  amount_min:number|null
  amount_max:number|null
  rule_origin:'system'|'cib_seed'|'manual_learning'
  is_active:boolean
  use_count:number
  last_used_at:string|null
  suggested_count:number
}

function pct(v:number){return `${Math.round(v*100)}%`}
function originLabel(v:SmartRule['rule_origin']){
  if(v==='cib_seed')return'CIB seed'
  if(v==='manual_learning')return'Learned'
  return'System'
}

export default function SmartRulesManager({rules,categories}:{rules:SmartRule[];categories:BankCategory[]}) {
  const router=useRouter()
  const [busy,setBusy]=useState<string|null>(null)
  const [notice,setNotice]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)

  async function call(body:Record<string,unknown>){
    const r=await fetch('/api/admin/banking/classification-rules',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
    })
    const d=await r.json()
    if(!r.ok||!d?.ok)throw new Error(d?.details||d?.error||'Rule update failed.')
    return d
  }

  async function toggle(rule:SmartRule){
    if(busy)return
    setBusy(rule.id);setNotice(null);setError(null)
    try{
      await call({action:'toggle',id:rule.id,is_active:!rule.is_active})
      setNotice(`${rule.name} ${rule.is_active?'disabled':'enabled'}.`)
      router.refresh()
    }catch(e:any){setError(String(e?.message??e))}finally{setBusy(null)}
  }

  async function save(rule:SmartRule,form:HTMLFormElement){
    if(busy)return
    const fd=new FormData(form)
    setBusy(rule.id);setNotice(null);setError(null)
    try{
      await call({
        action:'update',
        id:rule.id,
        name:String(fd.get('name')??''),
        category_code:String(fd.get('category_code')??''),
        direction_scope:String(fd.get('direction_scope')??''),
        match_field:String(fd.get('match_field')??''),
        pattern:String(fd.get('pattern')??''),
        priority:Number(fd.get('priority')),
        confidence_score:Number(fd.get('confidence_score'))/100,
        amount_min:String(fd.get('amount_min')??''),
        amount_max:String(fd.get('amount_max')??''),
      })
      setNotice(`${rule.name} updated.`)
      router.refresh()
    }catch(e:any){setError(String(e?.message??e))}finally{setBusy(null)}
  }

  return <div className="space-y-3">
    {notice?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>:null}
    {error?<div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>:null}

    {rules.map(rule=><details key={rule.id} className={`rounded-2xl border bg-white shadow-soft ${rule.is_active?'':'opacity-60'}`}>
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{rule.name}</strong>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{originLabel(rule.rule_origin)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${rule.confidence_score>=.9?'bg-emerald-50 text-emerald-800':rule.confidence_score>=.75?'bg-amber-50 text-amber-800':'bg-rose-50 text-rose-800'}`}>{pct(rule.confidence_score)}</span>
              {!rule.is_active?<span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Disabled</span>:null}
            </div>
            <p className="mt-1 text-xs text-[hsl(var(--muted))]">{rule.category_code.replaceAll('_',' ')} · {rule.direction_scope} · used {rule.use_count} time(s) · {rule.suggested_count} current suggestion(s)</p>
          </div>
          <button type="button" disabled={Boolean(busy)} onClick={(e)=>{e.preventDefault();void toggle(rule)}} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40">
            {rule.is_active?'Disable':'Enable'}
          </button>
        </div>
      </summary>

      <form className="grid gap-3 border-t p-4 md:grid-cols-2" onSubmit={(e)=>{e.preventDefault();void save(rule,e.currentTarget)}}>
        <label className="space-y-1 text-sm"><span className="font-medium">Rule name</span><input name="name" defaultValue={rule.name} maxLength={200} className="w-full rounded-xl border px-3 py-2"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Category</span><select name="category_code" defaultValue={rule.category_code} className="w-full rounded-xl border px-3 py-2">{categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Direction</span><select name="direction_scope" defaultValue={rule.direction_scope} className="w-full rounded-xl border px-3 py-2"><option value="credit">Credit</option><option value="debit">Debit</option><option value="both">Both</option></select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Match field</span><select name="match_field" defaultValue={rule.match_field} className="w-full rounded-xl border px-3 py-2"><option value="combined">Combined</option><option value="description">Description</option><option value="counterparty">Counterparty</option><option value="reference">Reference</option></select></label>
        <label className="space-y-1 text-sm md:col-span-2"><span className="font-medium">Regex pattern</span><input name="pattern" defaultValue={rule.pattern} maxLength={1000} className="w-full rounded-xl border px-3 py-2 font-mono text-xs"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Confidence %</span><input name="confidence_score" type="number" min="0" max="100" step="1" defaultValue={Math.round(rule.confidence_score*100)} className="w-full rounded-xl border px-3 py-2"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Priority</span><input name="priority" type="number" min="1" max="9999" step="1" defaultValue={rule.priority} className="w-full rounded-xl border px-3 py-2"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Amount min</span><input name="amount_min" type="number" min="0" step="0.01" defaultValue={rule.amount_min??''} className="w-full rounded-xl border px-3 py-2"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Amount max</span><input name="amount_max" type="number" min="0" step="0.01" defaultValue={rule.amount_max??''} className="w-full rounded-xl border px-3 py-2"/></label>
        <div className="md:col-span-2 flex justify-end"><button type="submit" disabled={Boolean(busy)} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy===rule.id?'Saving…':'Save rule'}</button></div>
      </form>
    </details>)}
  </div>
}
