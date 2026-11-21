'use client'
import { useState } from 'react'
import Link from 'next/link'
const PLANS=[{id:'1w',name:'1 week'},{id:'1m',name:'1 month'},{id:'3m',name:'3 months'},{id:'6m',name:'6 months'},{id:'12m',name:'12 months'}]
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
 async function calculate() {
  setLoading(true);setError('');setQuote(null)
  try{
   const args=new URLSearchParams({subscription_id:id.trim(),target_plan:target,payment_date:paymentDate})
   const res=await fetch('/api/admin/membership-upgrades/quote?'+args.toString(),{cache:'no-store'})
   const data=await res.json()
   if(!res.ok||!data.ok)throw new Error(data.error||'Unable to calculate upgrade')
   setQuote(data)
  }catch(e:any){setError(e.message||'Preview failed')}
  finally{setLoading(false)}
 }
 return <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
  <div>
   <h1 className="text-2xl font-semibold">Membership Upgrade — Preview</h1>
   <p className="mt-2 text-sm text-gray-600">Super Admin only. This preview does not change memberships, post payments, or issue invoices.</p>
  </div>
  <form onSubmit={e=>{e.preventDefault();void calculate()}} className="space-y-4 rounded-2xl border p-5">
   <label className="block text-sm font-medium">Current subscription ID
    <input className="mt-1 block w-full rounded-xl border p-3 text-sm" required value={id} onChange={e=>setId(e.target.value)} placeholder="Select an active subscription from a member profile"/>
   </label>
   <label className="block text-sm font-medium">Upgrade to
    <select className="mt-1 block w-full rounded-xl border p-3" value={target} onChange={e=>setTarget(e.target.value)}>{PLANS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
   </label>
   <label className="block text-sm font-medium">Payment Date (can be in the past)
    <input type="date" className="mt-1 block w-full rounded-xl border p-3" value={paymentDate} max={today} required onChange={e=>setPaymentDate(e.target.value)}/>
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
    <div><dt className="text-sm text-gray-500">Previously collected</dt><dd>{money(quote.quote.capturedPaidEGP)}</dd></div>
    <div><dt className="text-sm text-gray-500">Unused credit</dt><dd>{money(quote.quote.creditEGP)}</dd></div>
    <div><dt className="text-sm text-gray-500">New plan price</dt><dd>{money(quote.quote.targetPriceEGP)}</dd></div>
    <div><dt className="text-sm text-gray-500">Payment Date</dt><dd>{quote.payment_date}</dd></div>
    <div><dt className="text-sm text-gray-500">Upgrade effective date</dt><dd>{quote.quote.effectiveDate}</dd></div>
    <div><dt className="text-sm text-gray-500">Additional payment required</dt><dd className="text-xl font-bold">{money(quote.quote.paymentDueEGP)}</dd></div>
   </dl>
   <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Preview only — final approval and activation are not yet enabled. Never record the unused credit as a second payment.</p>
   <Link href={'/members/'+encodeURIComponent(quote.member_id)} className="text-sm underline">Back to member profile</Link>
  </section>}
 </main>
}
