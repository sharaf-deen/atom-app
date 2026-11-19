'use client'
import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
type Request={id:string;member_id:string;plan:string;status:string;version:number;created_at:string;catalog_price_egp:number;quoted_price_egp:number;approved_price_egp:number|null;preferred_payment_method:string;payment_verified_amount_egp:number|null;payment_verification_reference:string|null;completed_subscription_id:string|null;member_comment:string|null}
const money=(n:number)=>new Intl.NumberFormat('en-EG',{style:'currency',currency:'EGP'}).format(n)
const STATUSES=['all','pending_review','changes_requested','awaiting_payment','payment_verification','ready_to_renew','completed','rejected','cancelled']
export default function AdminMembershipRenewals(){
 const [rows,setRows]=useState<Request[]>([]),[names,setNames]=useState<Record<string,string>>({}),[status,setStatus]=useState('all')
 const [selected,setSelected]=useState<string>(''),[reason,setReason]=useState(''),[approvedPrice,setApprovedPrice]=useState(''),[verifiedAmount,setVerifiedAmount]=useState(''),[verificationReference,setVerificationReference]=useState(''),[subscriptionId,setSubscriptionId]=useState('')
 const [candidates,setCandidates]=useState<Array<{id:string;start_date:string|null;end_date:string|null;amount:number|null;amount_due:number|null;created_at:string}>>([])
 const [candidateLoading,setCandidateLoading]=useState(false)
 const [bankReconciliationConfirmed,setBankReconciliationConfirmed]=useState(false)
 const [bankReconciliationReference,setBankReconciliationReference]=useState('')
 const [proofs,setProofs]=useState<any[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const row=rows.find(r=>r.id===selected)||null
 const totals=useMemo(()=>rows.reduce((o,r)=>{o[r.status]=(o[r.status]||0)+1;return o},{} as Record<string,number>),[rows])
 async function reload(){const res=await fetch('/api/admin/membership-renewal-requests',{cache:'no-store'});const j=await res.json();if(!res.ok)throw Error(j.error||'Unable to load');setRows(j.requests||[]);setNames(j.names||{})}
 useEffect(()=>{void reload().catch(e=>setError(e.message))},[])
 async function loadCandidates(id:string){
  setCandidateLoading(true);setCandidates([])
  try{
   const res=await fetch('/api/admin/membership-renewal-requests?request_id='+encodeURIComponent(id),{cache:'no-store'})
   const j=await res.json()
   if(!res.ok)throw Error(j.error||'Unable to load renewals')
   const list=j.candidates||[]
   setCandidates(list)
   setSubscriptionId(list.length===1?list[0].id:'')
  }catch(e:any){setError(e.message||'Unable to load eligible subscriptions')}
  finally{setCandidateLoading(false)}
 }
 async function choose(id:string){
  setBankReconciliationConfirmed(false);setBankReconciliationReference('')
  setSelected(id);setError('');setNotice('');setProofs([])
  const res=await fetch('/api/membership-renewal-requests/proofs?request_id='+encodeURIComponent(id),{cache:'no-store'})
  const j=await res.json();if(res.ok)setProofs(j.proofs||[])
  const candidate=rows.find(r=>r.id===id)
  setApprovedPrice(String(candidate?.approved_price_egp??candidate?.quoted_price_egp??''))
  setVerifiedAmount(String(candidate?.payment_verified_amount_egp??''))
  setVerificationReference(candidate?.payment_verification_reference||'')
  setSubscriptionId(candidate?.completed_subscription_id||'')
  if(candidate?.status==='ready_to_renew')await loadCandidates(id)
  else setCandidates([])
 }
 async function reviewProof(proof:any,outcome:'verified'|'rejected'){
  if(!row)return;let amount=0;let explanation=''
  if(outcome==='verified'){const entered=prompt('Verified received amount (EGP)',String(proof.declared_amount_egp||''));if(entered===null)return;amount=Number(entered);if(!Number.isFinite(amount)||amount<=0){setError('Invalid amount');return}}
  else{const entered=prompt('Why was this proof rejected?');if(!entered)return;explanation=entered}
  setBusy(true);setError('')
  try{
   const res=await fetch('/api/membership-renewal-requests/proofs',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof_id:proof.id,outcome,verified_amount_egp:amount,reason:explanation})})
   const j=await res.json();if(!res.ok)throw Error(j.error||'Review failed')
   await choose(row.id);setNotice('Receipt '+outcome+'. Payment confirmation remains a separate step.')
  }catch(e:any){setError(e.message||'Review failed')}finally{setBusy(false)}
 }
 async function act(action:string){
  if(!row)return;setBusy(true);setError('');setNotice('')
  try{
   const res=await fetch('/api/admin/membership-renewal-requests',{method:'PATCH',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,version:row.version,action,
     reason,approved_price_egp:Number(approvedPrice),verified_amount_egp:Number(verifiedAmount),
     payment_verification_reference:verificationReference,subscription_id:subscriptionId,
     bank_reconciliation_confirmed:bankReconciliationConfirmed,bank_reconciliation_reference:bankReconciliationReference})})
   const j=await res.json();if(!res.ok)throw Error(j.error||'Action failed')
   setNotice('Action saved: '+j.request.status);setReason('');await reload()
   if(j.request.status==='ready_to_renew')await loadCandidates(row.id)
   if(j.request.status==='completed')setCandidates([])
  }catch(e:any){setError(e.message||'Action failed')}
  finally{setBusy(false)}
 }
 return <main className="mx-auto max-w-6xl space-y-5 px-3 py-5">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div><h1 className="text-2xl font-semibold">Membership Renewal Requests</h1>
    <p className="text-sm text-gray-600">Super Admin review and manual fulfillment.</p></div>
   <Link href="/admin" className="rounded-lg border px-4 py-2 text-sm">Admin</Link>
  </div>
  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
   {['pending_review','awaiting_payment','ready_to_renew','completed'].map(k=><div key={k} className="rounded-xl border p-4">
    <strong className="text-2xl">{totals[k]||0}</strong><p className="text-xs capitalize text-gray-500">{k.replace(/_/g,' ')}</p></div>)}
  </div>
  <div className="grid gap-4 lg:grid-cols-2">
   <section className="space-y-3">
    <label className="block text-sm">Filter by status <select className="mt-1 w-full rounded-lg border p-2" value={status} onChange={e=>setStatus(e.target.value)}>
     {STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></label>
    {rows.filter(r=>status==='all'||r.status===status).map(r=><button key={r.id}
      onClick={()=>void choose(r.id)} className={'block w-full rounded-xl border p-4 text-left '+(selected===r.id?'border-slate-900':'')}>
      <div className="flex flex-wrap justify-between gap-2"><strong>{names[r.member_id]||r.member_id}</strong><span className="text-xs">{r.status.replace(/_/g,' ')}</span></div>
      <p className="mt-1 text-sm">{r.plan} · {money(r.quoted_price_egp)} · {new Date(r.created_at).toLocaleDateString('en-GB')}</p>
     </button>)}
   </section>
   <section className="rounded-2xl border p-4 space-y-4">
    {!row?<p className="text-sm text-gray-600">Select a request to review.</p>:<>
     <h2 className="font-semibold">Request review</h2>
     <p className="break-all text-xs text-gray-500">ID: {row.id}</p>
     <div className="text-sm space-y-1">
      <p>Member: {names[row.member_id]||row.member_id}</p>
      <Link href={'/members/'+encodeURIComponent(row.member_id)} className="underline text-blue-700">Open member profile for manual renewal</Link>
      <p>Plan: {row.plan} / Payment: {row.preferred_payment_method}</p>
      <p>Catalog: {money(row.catalog_price_egp)} · Quoted: {money(row.quoted_price_egp)}</p>
      <p>Approved: {row.approved_price_egp!==null?money(row.approved_price_egp):'Not approved'}</p>
      <p>Member note: {row.member_comment||'None'}</p>
     </div>
     <div className="space-y-2">
      <label className="block text-sm">Internal reason / explanation
       <textarea className="mt-1 w-full rounded-lg border p-2" value={reason} onChange={e=>setReason(e.target.value)} rows={2}/></label>
      {['pending_review','changes_requested'].includes(row.status)?<>
       <label className="block text-sm">Approved price (EGP)
        <input className="mt-1 w-full rounded-lg border p-2" value={approvedPrice} type="number" step="0.01" onChange={e=>setApprovedPrice(e.target.value)}/></label>
       <div className="flex flex-wrap gap-2">{[['approve','Approve'],['changes_requested','Request changes'],['reject','Reject']].map(([a,l])=>
        <button disabled={busy} key={a} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>void act(a)}>{l}</button>)}</div>
      </>:null}
      {['awaiting_payment','payment_verification'].includes(row.status)?<>
       <label className="block text-sm">Verified total received (EGP)
        <input className="mt-1 w-full rounded-lg border p-2" type="number" step="0.01" value={verifiedAmount} onChange={e=>setVerifiedAmount(e.target.value)}/></label>
       <label className="block text-sm">Bank/CIB/cash transaction reference (required)
        <input className="mt-1 w-full rounded-lg border p-2" value={verificationReference} onChange={e=>setVerificationReference(e.target.value)}/></label>
       <p className="text-xs text-amber-700">Manually verify real receipt of funds before confirming. This does not create a financial entry.</p>
       <button disabled={busy} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>void act('verify_payment')}>Confirm verified payment</button>
      </>:null}
      {row.status==='ready_to_renew'?<>
       <p className="text-sm">First, renew the membership manually using the existing member profile. Then select the newly created subscription below. This step does not create a subscription or record payment.</p>
       <button className="rounded-lg border px-3 py-2 text-sm" disabled={busy||candidateLoading} onClick={()=>void loadCandidates(row.id)}>Refresh eligible renewals</button>
       {candidateLoading?<p className="text-sm">Checking subscriptions...</p>:null}
       {candidates.length===0&&!candidateLoading?<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No matching new subscription found. Do not create a fictitious payment to complete this test.</p>:null}
       {candidates.length>0?<label className="block text-sm">Newly created subscription
        <select className="mt-1 w-full rounded-lg border p-2" value={subscriptionId} onChange={e=>setSubscriptionId(e.target.value)}>
         <option value="">Choose matching renewal</option>
         {candidates.map(c=><option value={c.id} key={c.id}>{c.start_date||'—'} → {c.end_date||'—'} · {money(Number(c.amount||0))} received · {money(Number(c.amount_due||0))} due</option>)}
        </select></label>:null}
              {['instapay','bank_transfer'].includes(row.preferred_payment_method)?<div className="rounded-lg border bg-slate-50 p-3 space-y-2">
         <p className="font-semibold text-sm">Mandatory bank reconciliation review</p>
         <p className="text-xs text-gray-600">Check the bank/InstaPay entry against the existing Banking reconciliation, Subscription Payments and External Income. Confirm that this receipt was not allocated or counted twice.</p>
         <label className="block text-sm">Verified bank or InstaPay transaction reference
           <input className="mt-1 w-full rounded-lg border p-2" value={bankReconciliationReference} maxLength={300}
            onChange={e=>setBankReconciliationReference(e.target.value)} placeholder="Verified bank transaction reference" /></label>
         <label className="flex items-start gap-2 text-sm">
           <input type="checkbox" checked={bankReconciliationConfirmed} onChange={e=>setBankReconciliationConfirmed(e.target.checked)} />
           I checked the bank/InstaPay source and confirmed this payment was not duplicated or allocated elsewhere.
         </label>
        </div>:null}
<button disabled={busy||candidateLoading||!subscriptionId||(['instapay','bank_transfer'].includes(row.preferred_payment_method)&&(!bankReconciliationConfirmed||!bankReconciliationReference.trim()))} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>{if(window.confirm('Confirm that the selected subscription was manually renewed and its payment accounted for correctly?'))void act('complete')}}>Confirm manual renewal and complete</button>
      </>:null}
     </div>
     <div className="border-t pt-3 space-y-2"><h3 className="font-semibold">Payment receipts</h3>
      {proofs.length?proofs.map(p=><div key={p.id} className="rounded-lg border p-2 text-sm">
       <span>{p.original_filename} · {p.review_status} · {p.declared_amount_egp??'—'} EGP</span>
       {p.url?<a className="ml-2 underline" target="_blank" rel="noopener noreferrer" href={p.url}>View file</a>:null}
       {p.review_status==='pending'?<div className="mt-2 flex gap-2"><button className="rounded-lg border px-2 py-1" disabled={busy} onClick={()=>void reviewProof(p,'verified')}>Verify receipt</button><button className="rounded-lg border px-2 py-1 text-red-700" disabled={busy} onClick={()=>void reviewProof(p,'rejected')}>Reject receipt</button></div>:null}
      </div>):<p className="text-sm text-gray-600">No uploaded receipts.</p>}
     </div>
    </>}
   </section>
  </div>
  {error?<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>:null}
  {notice?<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{notice}</p>:null}
 </main>
}
