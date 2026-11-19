export const runtime='nodejs'
export const dynamic='force-dynamic'
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { sendRenewalNotice } from '@/lib/membershipRenewalNotifications'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
function json(status:number,body:unknown){const r=NextResponse.json(body,{status});r.headers.set('Cache-Control','no-store');return r}
async function adminActor(){
 const supa=createSupabaseServerActionClient()
 const {data:{user}}=await supa.auth.getUser()
 if(!user)return {error:json(401,{ok:false,error:'NOT_AUTHENTICATED'})}
 const {data:profile}=await supa.from('profiles').select('role').eq('user_id',user.id).maybeSingle()
 if(profile?.role!=='super_admin')return {error:json(403,{ok:false,error:'FORBIDDEN'})}
 return {actor:user.id}
}
export async function GET(req:Request){
 const auth=await adminActor();if(auth.error)return auth.error
 const admin=createSupabaseAdminClient()
 const status=new URL(req.url).searchParams.get('status')
 let q=admin.from('membership_renewal_requests').select('*').order('created_at',{ascending:false}).limit(200)
 if(status&&status!=='all')q=q.eq('status',status)
 const {data,error}=await q
 if(error)return json(500,{ok:false,error:'QUERY_FAILED'})
 const memberIds=Array.from(new Set((data||[]).map((x:any)=>x.member_id)))
 const names:Record<string,string>={}
 if(memberIds.length){
  const {data:profiles}=await admin.from('profiles').select('user_id,member_id,first_name,last_name').in('user_id',memberIds)
  for(const p of profiles||[])names[p.user_id]=[p.member_id,p.first_name,p.last_name].filter(Boolean).join(' · ')
 }
 return json(200,{ok:true,requests:data??[],names})
}
export async function PATCH(req:Request){
 const auth=await adminActor();if(auth.error)return auth.error
 const actor=auth.actor!
 const body=await req.json().catch(()=>null)
 const id=String(body?.id||'');const version=Number(body?.version);const action=String(body?.action||'')
 if(!UUID.test(id)||!Number.isInteger(version)||version<1)return json(400,{ok:false,error:'INVALID_REQUEST'})
 const admin=createSupabaseAdminClient()
 const {data:r,error:readError}=await admin.from('membership_renewal_requests').select('*').eq('id',id).maybeSingle()
 if(readError)return json(500,{ok:false,error:'READ_FAILED'})
 if(!r)return json(404,{ok:false,error:'NOT_FOUND'})
 if(r.version!==version)return json(409,{ok:false,error:'STALE_REQUEST'})
 const reason=typeof body?.reason==='string'?body.reason.trim().slice(0,1000):''
 const patch:any={version:version+1,last_actor_id:actor}
 if(action==='approve'){
  if(!['pending_review','changes_requested'].includes(r.status))return json(409,{ok:false,error:'INVALID_STATUS'})
  const price=Number(body?.approved_price_egp)
  if(!Number.isFinite(price)||price<0||price>100000000)return json(400,{ok:false,error:'INVALID_PRICE'})
  if(price!==Number(r.quoted_price_egp)&&!reason)return json(400,{ok:false,error:'PRICE_ADJUSTMENT_REASON_REQUIRED'})
  Object.assign(patch,{status:'awaiting_payment',approved_price_egp:price,approved_by:actor,
    approved_at:new Date().toISOString(),decision_reason:reason||null})
 }else if(action==='reject'||action==='changes_requested'){
  if(!['pending_review','changes_requested'].includes(r.status)||!reason)return json(409,{ok:false,error:'REASON_OR_STATUS_REQUIRED'})
  Object.assign(patch,{status:action==='reject'?'rejected':'changes_requested',decision_reason:reason})
 }else if(action==='verify_payment'){
  if(!['awaiting_payment','payment_verification'].includes(r.status))return json(409,{ok:false,error:'INVALID_STATUS'})
  const reference=String(body?.payment_verification_reference||'').trim().slice(0,300)
  const amount=Number(body?.verified_amount_egp)
  if(!reference||!Number.isFinite(amount)||amount<0||amount>100000000)return json(400,{ok:false,error:'VERIFICATION_REFERENCE_REQUIRED'})
  // Evidence is checked manually against Banking / InstaPay / CIB or a recorded academy cash receipt.
  // This operation creates no subscription, invoice, or payment transaction.
  Object.assign(patch,{status:Math.abs(amount-Number(r.approved_price_egp))<=0.01?'ready_to_renew':'payment_verification',
   payment_verified_at:new Date().toISOString(),payment_verified_by:actor,
   payment_verification_reference:reference,payment_verified_amount_egp:amount})
 }else if(action==='complete'){
  if(r.status!=='ready_to_renew')return json(409,{ok:false,error:'NOT_READY'})
  const subscriptionId=String(body?.subscription_id||'')
  if(!UUID.test(subscriptionId)||subscriptionId===r.source_subscription_id)return json(400,{ok:false,error:'INVALID_FULFILLMENT_SUBSCRIPTION'})
  const {data:sub}=await admin.from('subscriptions').select('id,member_id,plan,amount,amount_due,created_at').eq('id',subscriptionId).maybeSingle()
  if(!sub||sub.member_id!==r.member_id||sub.plan!==r.plan||!sub.created_at||new Date(sub.created_at).getTime()<new Date(r.created_at).getTime())return json(409,{ok:false,error:'SUBSCRIPTION_MISMATCH'})
  if(Math.abs(Number(sub.amount??0)+Number(sub.amount_due??0)-Number(r.approved_price_egp))>0.01)
   return json(409,{ok:false,error:'SUBSCRIPTION_PRICE_MISMATCH'})
  Object.assign(patch,{status:'completed',completed_subscription_id:subscriptionId,
   completed_by:actor,completed_at:new Date().toISOString()})
 }else{return json(400,{ok:false,error:'INVALID_ACTION'})}
 const {data:updated,error}=await admin.from('membership_renewal_requests').update(patch)
   .eq('id',id).eq('version',version).eq('status',r.status).select('id,status,version').maybeSingle()
 if(error?.code==='23505')return json(409,{ok:false,error:'ALREADY_LINKED'})
 if(error)return json(500,{ok:false,error:'UPDATE_FAILED'})
 if(!updated)return json(409,{ok:false,error:'STALE_REQUEST'})
 try{await sendRenewalNotice({memberId:r.member_id,actorId:actor,requestId:r.id,status:updated.status})}catch(e){console.error('renewal notification failed',e)}
 return json(200,{ok:true,request:updated})
}
