'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
const PLANS=[{id:'1m',name:'1 month'},{id:'3m',name:'3 months'},{id:'6m',name:'6 months'},{id:'12m',name:'12 months'}]
type Quote={
  ok:boolean;error?:string; preview_only?:boolean;
  from_plan:string;to_plan:string;member_id:string;payment_date:string;quoted_at:string;
  quote:{totalDays:number;daysRemaining:number;capturedPaidEGP:number;creditEGP:number;targetPriceEGP:number;paymentDueEGP:number;effectiveDate:string}
}
const money=(n:number)=>new Intl.NumberFormat('en-EG',{style:'currency',currency:'EGP'}).format(n)
export default function AdminMembershipUpgradePreview({subscriptionId,today}:{subscriptionId:string;today:string}) {
 const [id,setId]=useState(subscriptionId)
 const [target,setTarget]=useState('3m')
 const [paymentDate,setPaymentDate]=useState(today)
 const [quote,setQuote]=useState<Quote|null>(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(false)
 const [applying,setApplying]=useState(false)
 const [paymentMethod,setPaymentMethod]=useState('instapay')
 const [bankReference,setBankReference]=useState('')
 const [approvalNote,setApprovalNote]=useState('')
 const [receiptAttested,setReceiptAttested]=useState(false)
 const [applied,setApplied]=useState<{subscription_id:string;upgrade_id:string;payment_id:string|null}|null>(null)
 const requestKey=useRef<string|null>(null)
 async function calculate() {
  setLoading(true);setError('');setQuote(null);setApplied(null);requestKey.current=null;setReceiptAttested(false)
  try{
   const args=new URLSearchParams({subscription_id:id.trim(),target_plan:target,payment_date:paymentDate})
   const res=await fetch('/api/admin/membership-upgrades/quote?'+args.toString(),{cache:'no-store'})
   const data=await res.json()
   if(!res.ok||!data.ok)throw new Error(data.error||'Unable to calculate upgrade')
   setQuote(data)
  }catch(e:any){setError(e.message||'Preview failed')}
  finally{setLoading(false)}
 }
 async function approveAndApply() {
  if(!quote)return
  if(!window.confirm('Approve upgrade and record the actual payment on '+quote.payment_date+'? This replaces the active membership and cannot be undone automatically.'))return
  setApplying(true);setError('')
  try {
   if(!requestKey.current)requestKey.current=crypto.randomUUID()
   const res=await fetch('/api/admin/membership-upgrades/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    subscription_id:id.trim(),target_plan:target,payment_date:quote.payment_date,payment_method:paymentMethod,
    request_key:requestKey.current,expected_credit_egp:quote.quote.creditEGP,expected_payment_egp:quote.quote.paymentDueEGP,
    receipt_attested:receiptAttested,bank_reference:bankReference,approval_note:approvalNote,
   })})
   const data=await res.json()
   if(!res.ok||!data.ok)throw new Error(data.error||'Upgrade not applied')
   setApplied(data.result)
  }catch(e:any){setError(e.message||'Upgrade failed; check status before trying again')}
  finally{setApplying(false)}
 }
 return <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
  <div>
   <h1 className="text-2xl font-semibold">Membership Upgrade — Super Admin</h1>
   <p className="mt-2 text-sm text-gray-600">First preview the financial credit and supplement. Only explicit Super Admin approval applies the membership upgrade and records the additional actual payment.</p>
  </div>
  <form onSubmit={e=>{e.preventDefault();void calculate()}} className="space-y-4 rounded-2xl border p-5">
   <label className="block text-sm font-medium">Current subscription ID
    <input className="mt-1 block w-full rounded-xl border p-3 text-sm" required value={id} onChange={e=>{setId(e.target.value);setQuote(null)}} placeholder="Select an active subscription from a member profile"/>
   </label>
   <label className="block text-sm font-medium">Upgrade to
    <select className="mt-1 block w-full rounded-xl border p-3" value={target} onChange={e=>{setTarget(e.target.value);setQuote(null)}}>{PLANS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
   </label>
   <label className="block text-sm font-medium">Payment Date (can be in the past)
    <input type="date" className="mt-1 block w-full rounded-xl border p-3" value={paymentDate} max={today} required onChange={e=>{setPaymentDate(e.target.value);setQuote(null)}}/>
   </label>
   <p className="text-xs text-gray-600">The payment date is independent of the upgrade effective date. Backdating a payment will not backdate the membership period.</p>
   <button type="submit" disabled={loading} className="rounded-xl bg-black px-4 py-2.5 font-medium text-white disabled:opacity-50">{loading?'Calculating…':'Calculate remaining credit'}</button>
  </form>
  {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}
  {quote&&<section className="space-y-3 rounded-2xl border p-5">
   <h2 className="text-lg font-semibold">Calculated preview</h2>
   <dl className="grid gap-3 sm:grid-cols-2">
    <div><dt className="text-sm text-gray-500">Current → target</dt><dd className="font-medium">{quote.from_plan} → {quote.to_plan}</dd></div>
    <div><dt className="text-sm text-gray-500">Current coverage remaining</dt><dd className="font-medium">{quote.quote.daysRemaining} / {quote.quote.totalDays} days</dd></div>
    <div><dt className="text-sm text-gray-500">Cash received + existing carried credit</dt><dd>{money(quote.quote.capturedPaidEGP)}</dd></div>
    <div><dt className="text-sm text-gray-500">Unused credit</dt><dd>{money(quote.quote.creditEGP)}</dd></div>
    <div><dt className="text-sm text-gray-500">New plan price</dt><dd>{money(quote.quote.targetPriceEGP)}</dd></div>
    <div><dt className="text-sm text-gray-500">Payment Date</dt><dd>{quote.payment_date}</dd></div>
    <div><dt className="text-sm text-gray-500">Upgrade effective date</dt><dd>{quote.quote.effectiveDate}</dd></div>
    <div><dt className="text-sm text-gray-500">Additional payment required</dt><dd className="text-xl font-bold">{money(quote.quote.paymentDueEGP)}</dd></div>
   </dl>
   <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Credit is a transfer of previously paid value, not new revenue. Only the additional amount will be recorded as a new payment.</p>
   {!applied&&<div className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Approve and apply — Super Admin only</h3>
    <label className="block text-sm">Additional payment method
     <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} className="mt-1 block w-full rounded-xl border p-3">
      <option value="instapay">InstaPay</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option>
     </select>
    </label>
    {['instapay','bank_transfer'].includes(paymentMethod)&&<label className="block text-sm">Bank / InstaPay transaction reference
      <input value={bankReference} onChange={e=>setBankReference(e.target.value)} className="mt-1 block w-full rounded-xl border p-3" required placeholder="Reference from actual received transfer"/>
    </label>}
    <label className="block text-sm">Approval note (optional)
      <textarea value={approvalNote} onChange={e=>setApprovalNote(e.target.value)} className="mt-1 block w-full rounded-xl border p-3" rows={2}/>
    </label>
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={receiptAttested} onChange={e=>setReceiptAttested(e.target.checked)} className="mt-1"/>
      <span>I approve this upgrade and confirm that the additional amount of {money(quote.quote.paymentDueEGP)} has actually been received and checked against the chosen payment method and date. I have verified no duplicate payment has been recorded.</span>
    </label>
    <button type="button" disabled={applying||!receiptAttested||(['instapay','bank_transfer'].includes(paymentMethod)&&bankReference.trim().length<3)} onClick={()=>void approveAndApply()} className="rounded-xl bg-black px-4 py-2.5 font-medium text-white disabled:opacity-40">{applying?'Applying upgrade…':'Approve, record payment & activate'}</button>
   </div>}
   {applied&&<div className="space-y-2 rounded-xl border border-green-300 bg-green-50 p-4" role="status">
    <p className="font-semibold text-green-900">Upgrade applied successfully</p>
    <p className="text-sm text-green-900">New subscription: {applied.subscription_id}</p>
    <p className="text-sm text-green-900">Additional payment record: {applied.payment_id||'No additional payment required'}</p>
   </div>}
   <Link href={'/members/'+encodeURIComponent(quote.member_id)} className="text-sm underline">Back to member profile</Link>
  </section>}
 </main>
}
