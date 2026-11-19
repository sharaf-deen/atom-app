export const runtime='nodejs'
export const dynamic='force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { eligibleForRenewalFulfillment } from '@/lib/renewalFulfillmentEligibility'

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const response=(status:number,data:unknown)=>{
 const res=NextResponse.json(data,{status})
 res.headers.set('Cache-Control','no-store')
 return res
}

/**
 * STAGING ONLY: Read existing request and run synthetic candidate scenarios in memory.
 * No subscription, payment, invoice, request mutation or notification is ever written.
 * This is NOT a real completion test or proof of bank reconciliation.
 */
export async function GET(req:Request){
 // Even a Super Admin cannot enable this on Production or an ordinary Preview.
 const target=process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV
 if(target!=='staging')return response(404,{ok:false,error:'NOT_FOUND'})
 const origin=req.headers.get('host')||''
 if(!origin.endsWith('.vercel.app') && !origin.startsWith('localhost:'))
   return response(404,{ok:false,error:'NOT_FOUND'})
 const supabase=createSupabaseServerActionClient()
 const {data:{user},error:authError}=await supabase.auth.getUser()
 if(authError||!user)return response(401,{ok:false,error:'NOT_AUTHENTICATED'})
 const {data:profile,error:profileError}=await supabase.from('profiles')
  .select('role').eq('user_id',user.id).maybeSingle()
 if(profileError||profile?.role!=='super_admin')
  return response(403,{ok:false,error:'FORBIDDEN'})
 const id=new URL(req.url).searchParams.get('request_id')||''
 if(!UUID.test(id))return response(400,{ok:false,error:'INVALID_ID'})
 const admin=createSupabaseAdminClient()
 const {data:r,error:readError}=await admin.from('membership_renewal_requests')
  .select('id,member_id,plan,status,created_at,source_subscription_id,approved_price_egp,payment_verified_amount_egp')
  .eq('id',id).maybeSingle()
 if(readError)return response(500,{ok:false,error:'READ_FAILED'})
 if(!r)return response(404,{ok:false,error:'REQUEST_NOT_FOUND'})
 if(r.status!=='ready_to_renew')return response(409,{ok:false,error:'NOT_READY'})
 const amount=Number(r.approved_price_egp)
 if(!Number.isFinite(amount)||amount<0||r.payment_verified_amount_egp===null)
  return response(409,{ok:false,error:'NOT_VERIFIED'})
 let source:{status:string;end_date:string|null}|null=null
 if(r.source_subscription_id){
  const {data,error}=await admin.from('subscriptions')
   .select('status,end_date').eq('id',r.source_subscription_id).maybeSingle()
  if(error)return response(500,{ok:false,error:'SOURCE_LOOKUP_FAILED'})
  source=data
 }
 const now=new Date().toISOString()
 // Simulated dates are not written. Respect the existing source's last day.
 const startDate=source?.status==='active' && source.end_date
  ? (()=>{const d=new Date(source.end_date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)})()
  : now.slice(0,10)
 const candidate={
  id:crypto.randomUUID(),member_id:r.member_id,plan:r.plan,status:'active',
  created_at:now,start_date:startDate,amount,amount_due:0
 }
 const base={request:r,candidate,source,alreadyLinked:false,
  ledgerCount:amount>0?1:0,ledgerAmount:amount}
 const checks=[
  {name:'Hypothetical fully settled subscription qualifies',pass:eligibleForRenewalFulfillment(base)},
  {name:'Missing payment ledger is blocked (paid plans)',pass:amount===0||!eligibleForRenewalFulfillment({...base,ledgerCount:0,ledgerAmount:0})},
  {name:'Incorrect paid amount is blocked',pass:!eligibleForRenewalFulfillment({...base,candidate:{...candidate,amount:amount+100}})},
  {name:'Already linked subscription is blocked',pass:!eligibleForRenewalFulfillment({...base,alreadyLinked:true})},
  {name:'Wrong member is blocked',pass:!eligibleForRenewalFulfillment({...base,candidate:{...candidate,member_id:crypto.randomUUID()}})},
  {name:'Outstanding balance is blocked',pass:!eligibleForRenewalFulfillment({...base,candidate:{...candidate,amount_due:100}})},
 ]
 return response(200,{ok:true,mode:'STAGING_READ_ONLY_SIMULATION',request_id:r.id,
  passed:checks.every(x=>x.pass),checks,simulated_amount_egp:amount,
  persisted_changes:0,
  note:'This evaluates hypothetical candidates in memory. No renewal, payment, invoice or status change occurred. It does not verify authenticated completion or bank allocation.'})
}
