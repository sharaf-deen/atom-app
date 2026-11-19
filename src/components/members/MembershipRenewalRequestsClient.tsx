'use client'
import { useEffect,useState } from 'react'
import Link from 'next/link'

type Quote={plan:string;catalog_price_egp:number;quoted_price_egp:number;promotion:{title:string}|null}
type RequestRow={id:string;plan:string;status:string;version:number;quoted_price_egp:number;approved_price_egp:number|null;preferred_payment_method:string;created_at:string;member_comment:string|null}
const PLANS=[['1w','1 Week'],['1m','1 Month'],['3m','3 Months'],['6m','6 Months'],['12m','12 Months']]
const METHODS=[['instapay','InstaPay'],['bank_transfer','Bank transfer'],['card','Card — at academy'],['cash','Cash — at academy']]
const money=(n:number)=>new Intl.NumberFormat('en-EG',{style:'currency',currency:'EGP'}).format(n)
export default function MembershipRenewalRequestsClient(){
 const [plan,setPlan]=useState('6m'),[method,setMethod]=useState('instapay'),[comment,setComment]=useState('')
 const [quote,setQuote]=useState<Quote|null>(null),[requests,setRequests]=useState<RequestRow[]>([])
 const [support,setSupport]=useState<string|null>(null),[events,setEvents]=useState<any[]>([])
 const [receipt,setReceipt]=useState<File|null>(null),[declaredAmount,setDeclaredAmount]=useState(''),[paymentReference,setPaymentReference]=useState(''),[proofs,setProofs]=useState<any[]>([])
 const [activeId,setActiveId]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const openRequest=requests.find(r=>!['cancelled','rejected','completed'].includes(r.status))
 async function refresh(){
  const r=await fetch('/api/membership-renewal-requests',{cache:'no-store'})
  const j=await r.json()
  if(r.ok){setRequests(j.requests||[]);setSupport(j.supportWhatsApp||null)}
 }
 useEffect(()=>{void refresh()},[])
 useEffect(()=>{let cancelled=false
  fetch('/api/membership-renewal-requests?quote='+encodeURIComponent(plan),{cache:'no-store'})
   .then(r=>r.json()).then(j=>{if(!cancelled)setQuote(j.ok?j.quote:null)}).catch(()=>{if(!cancelled)setQuote(null)})
  return()=>{cancelled=true}
 },[plan])
 async function openDetail(id:string){setActiveId(id);const [r,p]=await Promise.all([fetch('/api/membership-renewal-requests?id='+id,{cache:'no-store'}),fetch('/api/membership-renewal-requests/proofs?request_id='+id,{cache:'no-store'})]);const j=await r.json();const pj=await p.json();setEvents(r.ok?j.events||[]:[]);setProofs(p.ok?pj.proofs||[]:[])}
 async function submit(){
  setError('');setNotice('');setLoading(true)
  try{
   const r=await fetch('/api/membership-renewal-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan,payment_method:method,comment})})
   const j=await r.json()
   if(!r.ok)throw Error(j.error||'Submission failed')
   setNotice('Request submitted. No membership has been renewed or payment recorded.')
   await refresh();if(j.request?.id){await openDetail(j.request.id);if(receipt)await uploadReceipt(j.request.id)}
  }catch(e:any){setError(e?.message||'Could not submit request')}
  finally{setLoading(false)}
 }
 async function change(action:'cancel'|'edit',r:RequestRow){
  setError('');setNotice('');setLoading(true)
  try{
   const res=await fetch('/api/membership-renewal-requests',{method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:r.id,version:r.version,action,plan,payment_method:method,comment})})
   const j=await res.json();if(!res.ok)throw Error(j.error||'Update failed')
   setNotice(action==='cancel'?'Request cancelled. Any existing payment must be handled separately.':'Request updated and resubmitted.')
   await refresh();await openDetail(r.id)
  }catch(e:any){setError(e?.message||'Unable to update')}
  finally{setLoading(false)}
 }
 async function uploadReceipt(id:string){
  if(!receipt)return;setLoading(true);setError('');setNotice('')
  try{
   const form=new FormData();form.set('request_id',id);form.set('file',receipt)
   if(declaredAmount.trim())form.set('declared_amount_egp',declaredAmount)
   if(paymentReference.trim())form.set('reference',paymentReference)
   const r=await fetch('/api/membership-renewal-requests/proofs',{method:'POST',body:form})
   const j=await r.json();if(!r.ok)throw Error(j.error||'Upload failed')
   setNotice('Receipt uploaded for manual verification; no payment has been recorded.')
   setReceipt(null);setDeclaredAmount('');setPaymentReference('')
   await openDetail(id)
  }catch(e:any){setError(e.message||'Upload failed')}finally{setLoading(false)}
 }
 const viewed=requests.find(r=>r.id===activeId)??openRequest??requests[0]
 const wa=viewed&&support?('https://wa.me/'+support+'?text='+encodeURIComponent(
  'Hello Coach Sharaf, I would like an update on my membership renewal request.\nRequest ID: '+viewed.id+'\nPlan: '+viewed.plan+'\nStatus: '+viewed.status+'\nThank you.')):null
 return <main className="mx-auto max-w-4xl space-y-6 px-3 py-5">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h1 className="text-2xl font-semibold">Membership Renewal Requests</h1>
    <p className="mt-1 text-sm text-gray-600">Request a renewal; only Super Admin can approve and fulfill it.</p></div>
   <Link href="/profile" className="rounded-xl border px-4 py-2 text-sm">Back to profile</Link>
  </div>
  <section className="rounded-2xl border p-5 space-y-4">
   <h2 className="font-semibold">Request a renewal</h2>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-sm"><span>Membership</span><select className="w-full rounded-lg border p-2" value={plan} onChange={e=>setPlan(e.target.value)}>{PLANS.map(([v,t])=><option value={v} key={v}>{t}</option>)}</select></label>
    <label className="space-y-1 text-sm"><span>Preferred payment method</span><select className="w-full rounded-lg border p-2" value={method} onChange={e=>setMethod(e.target.value)}>{METHODS.map(([v,t])=><option value={v} key={v}>{t}</option>)}</select></label>
   </div>
   <div className="rounded-xl bg-gray-50 p-3 text-sm">
    {quote?<><div>Catalog price: {money(quote.catalog_price_egp)}</div>
      {quote.promotion?<div>Indicative promotion: {quote.promotion.title}</div>:null}
      <div className="font-semibold">Indicative total: {money(quote.quoted_price_egp)}</div></>:<div>Price currently unavailable. Please contact the academy.</div>}
    <p className="mt-1 text-xs text-gray-600">Final price, discounts and payment are subject to Super Admin verification.</p>
   </div>
   <label className="block text-sm space-y-1"><span>Comment (optional)</span><textarea className="w-full rounded-lg border p-2" rows={2} maxLength={1000} value={comment} onChange={e=>setComment(e.target.value)}/></label>
   {method==='instapay'||method==='bank_transfer'?<div className="space-y-2"><p className="text-sm text-gray-600">If you already paid, attach your receipt now (optional). It will be uploaded right after the request is created.</p><input type="file" accept="image/jpeg,image/png,application/pdf" aria-label="Optional receipt with renewal request" className="block w-full text-sm" onChange={e=>setReceipt(e.target.files?.[0]||null)}/></div>:<p className="text-sm text-gray-600">Card and cash payments are taken at the academy only.</p>}
   <button className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50" disabled={loading||!quote||!!openRequest} onClick={submit}>Submit renewal request</button>
   {openRequest?<p className="text-sm text-amber-800">You already have an open request. You may update it before approval.</p>:null}
  </section>
  {error?<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
  {notice?<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{notice}</p>:null}
  <section className="space-y-3"><h2 className="font-semibold">My requests</h2>
   {requests.length===0?<p className="text-sm text-gray-600">No renewal requests yet.</p>:requests.map(r=><div key={r.id} className="rounded-xl border p-4 space-y-2">
     <div className="flex flex-wrap justify-between gap-2"><strong>{PLANS.find(p=>p[0]===r.plan)?.[1]||r.plan}</strong><span className="rounded-full bg-gray-100 px-3 py-1 text-xs">{r.status.replace(/_/g,' ')}</span></div>
     <p className="text-sm">Quoted: {money(r.quoted_price_egp)} · Approved: {r.approved_price_egp===null?'Pending':money(r.approved_price_egp)}</p>
     <p className="break-all text-xs text-gray-500">Request ID: {r.id}</p>
     <div className="flex flex-wrap gap-2">
      <button className="rounded-lg border px-3 py-2 text-sm" onClick={()=>void openDetail(r.id)}>View status</button>
      {['pending_review','changes_requested'].includes(r.status)?<>
       <button disabled={loading} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>void change('edit',r)}>Update using selections above</button>
       <button disabled={loading} className="rounded-lg border px-3 py-2 text-sm text-red-700" onClick={()=>{if(confirm('Cancel this renewal request? Payments will not be refunded automatically.'))void change('cancel',r)}}>Cancel</button>
      </>:null}
     </div>
    </div>)}
  </section>
  {viewed?<section className="rounded-2xl border p-4 space-y-3">
   <h2 className="font-semibold">Request progress — {viewed.status.replace(/_/g,' ')}</h2>
   {events.length&&activeId===viewed.id?<ol className="space-y-2 text-sm">{events.map(e=><li key={e.id}>{new Date(e.created_at).toLocaleString('en-GB')} · {e.member_summary||e.event_type}</li>)}</ol>:<p className="text-sm text-gray-600">Select View status for the history.</p>}
   {['instapay','bank_transfer'].includes(viewed.preferred_payment_method)&&!['cancelled','rejected','completed'].includes(viewed.status)?<div className="rounded-lg border p-3 space-y-2">
    <h3 className="font-semibold text-sm">Submit payment receipt (optional)</h3>
    <input aria-label="Payment receipt" type="file" accept="image/jpeg,image/png,application/pdf" onChange={e=>setReceipt(e.target.files?.[0]||null)} className="block w-full text-sm"/>
    <label className="block text-sm">Amount sent (EGP)
     <input value={declaredAmount} onChange={e=>setDeclaredAmount(e.target.value)} type="number" step="0.01" min="0" className="mt-1 w-full rounded-lg border p-2"/></label>
    <label className="block text-sm">Transfer reference (optional)
     <input value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
    <button disabled={!receipt||loading} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void uploadReceipt(viewed.id)}>Upload receipt</button>
    <p className="text-xs text-gray-600">Accepted: JPG, PNG, PDF (max 10 MB). No payment is confirmed by this upload.</p>
   </div>:null}
   {proofs.length&&activeId===viewed.id?<div className="space-y-2"><h3 className="font-semibold text-sm">Uploaded receipts</h3>{proofs.map(p=><div key={p.id} className="rounded-lg border p-2 text-sm">
    {p.original_filename} · {p.review_status} {p.url?<a href={p.url} target="_blank" rel="noopener noreferrer" className="underline ml-2">View</a>:null}
   </div>)}</div>:null}
   {wa?<a href={wa} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg border border-green-700 px-4 py-2 text-sm font-semibold text-green-800">Contact Super Admin on WhatsApp</a>:<p className="text-sm text-gray-600">WhatsApp contact will become available when the academy support number is configured.</p>}
  </section>:null}
 </main>
}
