'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type Expense={id:string;date:string;description:string;category_key:string;amount:number}
type Exclusion={expense_id:string;excluded_amount:number;reason:string}
type Model={ok:boolean;expenses:Expense[];exclusions:Exclusion[];locked:boolean}

export default function StaffPayrollExpenseBasisAdjuster({monthStart,canWrite}:{monthStart:string;canWrite:boolean}){
  const router=useRouter()
  const [data,setData]=React.useState<Model|null>(null)
  const [expenseId,setExpenseId]=React.useState('')
  const [amount,setAmount]=React.useState('0')
  const [reason,setReason]=React.useState('')
  const [pending,setPending]=React.useState(false)
  const [error,setError]=React.useState('')
  const [message,setMessage]=React.useState('')
  const month=monthStart.slice(0,7)

  const load=React.useCallback(async()=>{
    const response=await fetch('/api/staff-payroll/expense-basis?month='+encodeURIComponent(month),{cache:'no-store'})
    const result=await response.json().catch(()=>null)
    if(!response.ok||!result?.ok) throw new Error(result?.details||result?.error||'LOAD_FAILED')
    setData(result)
    return result as Model
  },[month])
  React.useEffect(()=>{void load().catch((e)=>setError(String(e.message??e)))},[load])

  function choose(id:string){
    setExpenseId(id)
    const row=data?.exclusions.find(x=>x.expense_id===id)
    setAmount(row?String(row.excluded_amount):'0')
    setReason(row?.reason??'')
    setMessage('')
  }
  async function save(){
    if(!canWrite||!expenseId||pending)return
    setPending(true);setError('');setMessage('')
    try{
      const response=await fetch('/api/staff-payroll/expense-basis',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({month,expenseId,amount:Number(amount),reason}),
      })
      const result=await response.json().catch(()=>null)
      if(!response.ok||!result?.ok)throw new Error(result?.details||result?.error||'SAVE_FAILED')
      await load()
      router.refresh()
      setMessage('Payroll basis saved. Recalculate the official hybrid draft before approval.')
    }catch(e:any){setError(String(e.message??e))}
    finally{setPending(false)}
  }

  const selected=data?.expenses.find(x=>x.id===expenseId)
  const exclusionsTotal=(data?.exclusions??[]).reduce((sum,x)=>sum+Number(x.excluded_amount),0)
  const validAmount=Number.isFinite(Number(amount))&&Number(amount)>=0&&!!selected
    &&Number(amount)<=Number(selected?.amount??0) && Math.round(Number(amount)*100)===Number(amount)*100
  const validReason=Number(amount)===0||reason.trim().length>=20
  return <section className="rounded-2xl border border-amber-300 bg-white p-4 sm:p-5 space-y-3">
    <h3 className="text-lg font-semibold">Expense basis adjustments — payroll only</h3>
    <p className="text-sm text-black/70">Exclude documented prior-period debt from this month’s salary calculation only. Expense entries, bank transfers and accounting remain unchanged. Super Admin only.</p>
    <div className="text-sm font-medium">Existing payroll-basis exclusions: {exclusionsTotal.toLocaleString('en-EG',{minimumFractionDigits:2})} EGP</div>
    {data?.exclusions.map(x=><p key={x.expense_id} className="text-xs text-black/70">Expense {data?.expenses.find(e=>e.id===x.expense_id)?.date??x.expense_id}: {Number(x.excluded_amount).toLocaleString()} EGP · {x.reason}</p>)}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
    {canWrite&&!data?.locked&&<div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Rent payment to adjust
        <select className="mt-1 w-full rounded-xl border p-2" value={expenseId} onChange={e=>choose(e.target.value)}>
          <option value="">Select an October rent expense</option>
          {data?.expenses.map(x=><option value={x.id} key={x.id}>{x.date} · {x.description} · {Number(x.amount).toLocaleString()} EGP</option>)}
        </select>
      </label>
      <label className="text-sm">Amount excluded from payroll basis (EGP)
        <input type="number" min="0" step="0.01" max={selected?.amount} className="mt-1 w-full rounded-xl border p-2" value={amount} onChange={e=>setAmount(e.target.value)}/>
      </label>
      <label className="text-sm sm:col-span-2">Justification / evidence
        <textarea rows={2} maxLength={1500} className="mt-1 w-full rounded-xl border p-2" value={reason} onChange={e=>setReason(e.target.value)} placeholder="E.g. 20,000 EGP belongs to prior months’ outstanding rent debt; excluded from October payroll basis only."/>
      </label>
      <button type="button" className="rounded-xl bg-black p-3 text-white font-semibold disabled:opacity-40" disabled={!data||pending||!validAmount||!validReason} onClick={()=>void save()}>
        {pending?'Saving…':Number(amount)===0?'Remove adjustment':'Save adjustment (draft only)'}
      </button>
    </div>}
    <p className="text-xs text-amber-800">Changing these figures invalidates the previous payroll calculation. Recalculate the official draft before approving or paying staff. Never record the same amount twice.</p>
  </section>
}
