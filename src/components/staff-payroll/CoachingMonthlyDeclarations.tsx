'use client'
import React from 'react'
type Row={id:string;staff_name:string;payroll_task_id:string;declared_sessions:number;declared_hours:number;scheduled_assignments:number;status:string;coach_note:string;review_note:string|null}
type Model={ok:boolean;tasks:{id:string;name:string}[];declarations:Row[];isAdmin:boolean;staff:{staff_user_id:string;name:string;primary_role:string;employment_status:string}[]}
export default function CoachingMonthlyDeclarations({initialMonth,adminView}:{initialMonth:string;adminView:boolean}){
 const [month,setMonth]=React.useState(initialMonth)
 const [model,setModel]=React.useState<Model|null>(null)
 const [taskId,setTaskId]=React.useState('')
 const [staffId,setStaffId]=React.useState('')
 const [count,setCount]=React.useState('')
 const [hours,setHours]=React.useState('')
 const [note,setNote]=React.useState('')
 const [reasons,setReasons]=React.useState<Record<string,string>>({})
 const [pending,setPending]=React.useState(false)
 const [error,setError]=React.useState('')
 const [success,setSuccess]=React.useState('')
 const load=React.useCallback(async()=>{
   const res=await fetch('/api/staff-payroll/coaching-declarations?month='+encodeURIComponent(month),{cache:'no-store'})
   const data=await res.json().catch(()=>null)
   if(!res.ok||!data?.ok)throw Error(data?.error||'LOAD_FAILED')
   setModel(data)
 },[month])
 React.useEffect(()=>{setModel(null);void load().catch(e=>setError(String(e.message||e)))},[load])
 async function post(body:Record<string,unknown>){
  setPending(true);setError('');setSuccess('')
  try{
   const res=await fetch('/api/staff-payroll/coaching-declarations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
   const data=await res.json().catch(()=>null)
   if(!res.ok||!data?.ok)throw Error(data?.error||'REQUEST_FAILED')
   await load()
   setSuccess(body.action==='submit'?'WhatsApp totals recorded for Super Admin review. No salary was calculated or paid.':'Decision recorded. No salary was approved or paid.')
   if(body.action==='submit'){setCount('');setHours('');setNote('')}
  }catch(e:any){setError(String(e.message||e))}
  finally{setPending(false)}
 }
 const titleFor=(id:string)=>model?.tasks.find(t=>t.id===id)?.name??'Coaching task'
 return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
  <header className="rounded-3xl border bg-white p-5">
   <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">Staff Payroll · Monthly Coaching</span>
   <h1 className="mt-4 text-2xl font-bold">Monthly coaching declarations</h1>
   <p className="mt-2 text-sm text-black/70">Super Admin only: enter the actual coaching totals you received from staff by WhatsApp. Compare them to the schedule and QR scans, then approve the verified work. Coaches do not need an ATOM login for this. No salary is approved automatically.</p>
   <label className="mt-4 block text-sm font-medium">Payroll month <input className="ml-3 rounded-xl border p-2" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}
  {success&&<p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-800">{success}</p>}
  {!model&&<p>Loading monthly declarations…</p>}
  {model&&adminView&&<form className="grid gap-3 rounded-2xl border bg-white p-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void post({action:'submit',month,staffId,taskId,sessions:Number(count),hours:Number(hours),note})}}>
   <h2 className="sm:col-span-2 text-lg font-semibold">Record coach WhatsApp declaration</h2>
   <label className="text-sm">Staff member (canonical payroll account)<select required className="mt-1 w-full rounded-xl border p-3" value={staffId} onChange={e=>setStaffId(e.target.value)}><option value="">Choose staff</option>{model.staff.filter(x=>x.employment_status==='active').map(x=><option key={x.staff_user_id} value={x.staff_user_id}>{x.name} · {x.primary_role}</option>)}</select></label>
   <label className="text-sm">Coaching task<select required className="mt-1 w-full rounded-xl border p-3" value={taskId} onChange={e=>setTaskId(e.target.value)}><option value="">Choose task</option>{model.tasks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   <label className="text-sm">Sessions taught<input required className="mt-1 w-full rounded-xl border p-3" type="number" step={1} min={1} max={250} value={count} onChange={e=>setCount(e.target.value)}/></label>
   <label className="text-sm">Total actual hours<input required className="mt-1 w-full rounded-xl border p-3" type="number" min={0.01} max={500} step={0.01} value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <label className="text-sm">WhatsApp message / replacements / comments<textarea className="mt-1 w-full rounded-xl border p-3" maxLength={1500} value={note} onChange={e=>setNote(e.target.value)} /></label>
   <button disabled={pending||!staffId||!taskId||!count||!hours} className="rounded-xl bg-black p-3 font-semibold text-white disabled:opacity-40">Record declaration for review</button>
  </form>}
  {model&&<section className="space-y-3">
   <h2 className="text-xl font-semibold">Super Admin review queue</h2>
   {model.declarations.length===0&&<p className="rounded-xl border p-4">No declarations for this month.</p>}
   {model.declarations.map(d=><article key={d.id} className="rounded-2xl border bg-white p-5">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">{d.staff_name+' · '}{titleFor(d.payroll_task_id)}</h3><span className="rounded-full border px-3 py-1 text-xs">{d.status}</span></div>
    <p className="mt-2 text-sm">{d.declared_sessions} declared classes · {d.declared_hours} hours · {d.scheduled_assignments} schedule assignments</p>
    {d.declared_sessions!==d.scheduled_assignments&&<p className="mt-1 text-sm text-amber-700">Schedule discrepancy: verify replacement or missing assignment. QR scans are optional.</p>}
    {d.coach_note&&<p className="mt-2 text-sm">Coach note: {d.coach_note}</p>}
    {d.review_note&&<p className="mt-2 text-sm">Review: {d.review_note}</p>}
    {d.status==='submitted'&&<div className="mt-4 flex flex-wrap gap-2">
      <input className="min-w-[250px] flex-1 rounded-xl border p-3" placeholder="Review reason / evidence (min 10 characters)" maxLength={1500} value={reasons[d.id]??''} onChange={e=>setReasons(p=>({...p,[d.id]:e.target.value}))}/>
      <button disabled={pending||(reasons[d.id]??'').trim().length<10} className="rounded-xl bg-black p-3 text-white disabled:opacity-40" onClick={()=>void post({action:'review',id:d.id,decision:'approve',reason:reasons[d.id]})}>Approve verified work</button>
      <button disabled={pending||(reasons[d.id]??'').trim().length<10} className="rounded-xl border p-3 disabled:opacity-40" onClick={()=>void post({action:'review',id:d.id,decision:'reject',reason:reasons[d.id]})}>Return for correction</button>
    </div>}
   </article>)}
  </section>}
 </main>
}
