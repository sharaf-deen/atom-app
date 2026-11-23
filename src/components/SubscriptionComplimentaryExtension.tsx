'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Grant = {
  id: string
  days: number
  reason: string
  internal_note: string | null
  granted_at: string
  previous_end_date: string
  resulting_end_date: string
  reversed_at: string | null
  reversal_reason: string | null
}
type Subscription = { end_date: string | null; paid_end_date: string | null; status: string | null }

const reasonOptions = [
  ['Goodwill gesture','Goodwill gesture'],
  ['Academy closure','Academy closure'],
  ['Administrative compensation','Administrative compensation'],
  ['Loyalty reward','Loyalty reward'],
  ['Other','Other'],
]
function addDays(base: string, days: number): string {
  const [y,m,d] = base.split('-').map(Number)
  const next = new Date(Date.UTC(y,m-1,d))
  next.setUTCDate(next.getUTCDate()+days)
  return next.toISOString().slice(0,10)
}

export default function SubscriptionComplimentaryExtension({ subscriptionId }: { subscriptionId: string }) {
  const router=useRouter()
  const [open,setOpen]=useState(false)
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [subscription,setSubscription]=useState<Subscription|null>(null)
  const [history,setHistory]=useState<Grant[]>([])
  const [days,setDays]=useState('7')
  const [reason,setReason]=useState('Goodwill gesture')
  const [note,setNote]=useState('')
  const requestKey=useRef<string|null>(null)

  useEffect(()=>{
    if(!open)return
    let mounted=true
    setLoading(true)
    setError('')
    fetch('/api/subscriptions/complimentary-extension?subscription_id='+encodeURIComponent(subscriptionId),{cache:'no-store'})
      .then(async r=>{const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'History unavailable');return j})
      .then(j=>{if(mounted){setSubscription(j.subscription);setHistory(j.history)}})
      .catch(e=>{if(mounted)setError(String(e.message||e))})
      .finally(()=>{if(mounted)setLoading(false)})
    return()=>{mounted=false}
  },[open,subscriptionId])

  async function reload() {
    const r=await fetch('/api/subscriptions/complimentary-extension?subscription_id='+encodeURIComponent(subscriptionId),{cache:'no-store'})
    const j=await r.json()
    if(!r.ok||!j.ok)throw new Error(j.error||'History unavailable')
    setSubscription(j.subscription)
    setHistory(j.history)
    router.refresh()
  }

  async function grant() {
    const count=Number(days)
    if(!Number.isInteger(count)||count<1||count>365){setError('Choose 1 to 365 days.');return}
    if(!subscription?.end_date||subscription.status!=='active'){setError('An active subscription is required.');return}
    const next=addDays(subscription.end_date,count)
    if(!window.confirm('Grant '+count+' free days? Expiry: '+subscription.end_date+' → '+next+'. Payment: 0 EGP.'))return
    setBusy(true);setError('')
    if(!requestKey.current)requestKey.current=crypto.randomUUID()
    try{
      const r=await fetch('/api/subscriptions/complimentary-extension',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'grant',subscription_id:subscriptionId,days:count,reason,note,request_key:requestKey.current})
      })
      const j=await r.json()
      if(!r.ok||!j.ok)throw new Error(j.error||'Grant failed')
      requestKey.current=null
      setNote('')
      await reload()
    }catch(e:any){setError(String(e?.message||e))}
    finally{setBusy(false)}
  }

  async function reverse(grantId:string) {
    const explanation=window.prompt('Reason for reversing these complimentary days (required):')
    if(explanation===null)return
    if(explanation.trim().length<3){setError('Reversal reason must have at least 3 characters.');return}
    if(!window.confirm('Reverse this gift? The end date will be reduced; this cannot be undone without a new grant.'))return
    setBusy(true);setError('')
    try{
      const r=await fetch('/api/subscriptions/complimentary-extension',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'reverse',grant_id:grantId,reason:explanation})
      })
      const j=await r.json()
      if(!r.ok||!j.ok)throw new Error(j.error||'Reversal failed')
      await reload()
    }catch(e:any){setError(String(e?.message||e))}
    finally{setBusy(false)}
  }
  return <>
    <button type="button" disabled={busy} onClick={()=>setOpen(true)}
      className="inline-flex items-center rounded-xl border px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
      Grant Extra Days
    </button>
    {open&&<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Grant Extra Days">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-lg">Grant Extra Days</h3>
          <button type="button" disabled={busy} className="text-sm underline" onClick={()=>setOpen(false)}>Close</button>
        </div>
        {loading?<p className="text-sm">Loading…</p>:<>
          <div className="rounded-xl bg-gray-50 border p-3 text-sm space-y-1">
            <p>Access expiry: <strong>{subscription?.end_date||'—'}</strong></p>
            <p>Paid contract expiry: <strong>{subscription?.paid_end_date||subscription?.end_date||'—'}</strong></p>
            <p>Financial impact: <strong>0 EGP</strong></p>
          </div>
          {subscription?.status==='active'&&subscription.end_date&&<>
            <label className="block text-sm font-medium">Free days (1–365)
              <input type="number" min={1} max={365} step={1} value={days} onChange={e=>setDays(e.target.value)}
                className="mt-1 block w-full rounded-lg border p-2" />
            </label>
            <label className="block text-sm font-medium">Reason
              <select value={reason} onChange={e=>setReason(e.target.value)}
                className="mt-1 block w-full rounded-lg border p-2">
                {reasonOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Internal note (optional)
              <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}
                className="mt-1 block w-full rounded-lg border p-2" rows={2}/>
            </label>
            <p className="text-sm">New expiry preview: <strong>{
              Number.isInteger(Number(days))&&Number(days)>0&&Number(days)<=365
                ?addDays(subscription.end_date,Number(days)):'—'}</strong></p>
            <button type="button" disabled={busy} onClick={grant}
              className="w-full rounded-xl bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy?'Saving…':'Confirm complimentary extension'}
            </button>
          </>}
          {error&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
          <div className="border-t pt-3">
            <h4 className="font-semibold">Grant history</h4>
            {history.length===0?<p className="text-sm text-gray-500 mt-2">No grants recorded.</p>
              :<div className="space-y-2 mt-2">{history.map(g=><div key={g.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong>+{g.days} days · {g.reason}</strong>
                  {g.reversed_at?<span className="text-gray-500">Reversed</span>:
                    <button type="button" disabled={busy} onClick={()=>reverse(g.id)}
                      className="text-rose-700 underline">Reverse</button>}
                </div>
                <p>{g.previous_end_date} → {g.resulting_end_date}</p>
                <p className="text-gray-500">{new Date(g.granted_at).toLocaleString()}</p>
                {g.internal_note&&<p>{g.internal_note}</p>}
                {g.reversal_reason&&<p>Reversal: {g.reversal_reason}</p>}
              </div>)}</div>}
          </div>
        </>}
      </div>
    </div>}
  </>
}
