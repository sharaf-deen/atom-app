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
type Candidate={id:string;plan:string;start_date:string|null;end_date:string|null;amount:number|null;amount_due:number|null;created_at:string;status:string}
async function eligibleRenewalSubscriptions(admin:ReturnType<typeof createSupabaseAdminClient>,r:any):Promise<Candidate[]>{
 const {data,error}=await admin.from('subscriptions')
  .select('id,member_id,plan,start_date,end_date,status,amount,amount_due,created_at')
  .eq('member_id',r.member_id).eq('plan',r.plan)
  .gte('created_at',r.created_at).order('created_at',{ascending:false}).limit(30)
 if(error)throw error
 const ids=(data||[]).map(x=>x.id)
 const {data:linked,error:linkedError}=ids.length?await admin.from('membership_renewal_requests')
  .select('completed_subscription_id').in('completed_subscription_id',ids):{data:[],error:null}
 if(linkedError)throw linkedError
 const used=new Set((linked||[]).map(x=>x.completed_subscription_id))
 const {data:ledger,error:ledgerError}=ids.length
  ? await admin.from('subscription_payments').select('subscription_id,amount,member_id').in('subscription_id',ids)
  : {data:[],error:null}
 if(ledgerError)throw ledgerError
 // A verified upload or a typed reference is NOT an accounting entry.
 // Require the existing subscription payment ledger to agree with the new subscription.
 const ledgerAmounts=new Map<string,number>()
 const ledgerCounts=new Map<string,number>()
 for(const payment of ledger||[]){
  if(payment.member_id!==r.member_id)continue
  ledgerAmounts.set(payment.subscription_id,(ledgerAmounts.get(payment.subscription_id)||0)+Number(payment.amount||0))
  ledgerCounts.set(payment.subscription_id,(ledgerCounts.get(payment.subscription_id)||0)+1)
 }

 const {data:source}=r.source_subscription_id
  ? await admin.from('subscriptions').select('end_date,status').eq('id',r.source_subscription_id).maybeSingle()
  : {data:null}
 return (data||[]).filter(x=>
   x.id!==r.source_subscription_id && !used.has(x.id) &&
   ['active','expired'].includes(x.status) &&
   Math.abs(Number(x.amount??0)+Number(x.amount_due??0)-Number(r.approved_price_egp))<=0.01 &&
   // A ready-to-renew request is fully paid: outstanding dues cannot masquerade as a settled renewal.
   Number(x.amount_due??0)<=0.01 &&
   Math.abs(Number(x.amount??0)-Number(r.payment_verified_amount_egp??0))<=0.01 &&
   // Do not complete a renewal if its financial ledger is absent or inconsistent.
   (Number(x.amount??0)===0 ||
     ((ledgerCounts.get(x.id)||0)>0 &&
      Math.abs((ledgerAmounts.get(x.id)||0)-Number(x.amount??0))<=0.01)) &&
   (!source || source.status!=='active' || !source.end_date || !x.start_date || x.start_date>source.end_date)
 ).map(x=>({id:x.id,plan:x.plan,start_date:x.start_date,end_date:x.end_date,
   amount:x.amount,amount_due:x.amount_due,created_at:x.created_at,status:x.status}))
}
export async function GET(req:Request){
 const auth=await adminActor();if(auth.error)return auth.error
 const admin=createSupabaseAdminClient()
 const url=new URL(req.url)
 const requestId=url.searchParams.get('request_id')
 if(requestId){
  if(!UUID.test(requestId))return json(400,{ok:false,error:'INVALID_REQUEST_ID'})
  const {data:r,error}=await admin.from('membership_renewal_requests').select('*').eq('id',requestId).maybeSingle()
  if(error)return json(500,{ok:false,error:'READ_FAILED'})
  if(!r)return json(404,{ok:false,error:'NOT_FOUND'})
  if(r.status!=='ready_to_renew')return json(409,{ok:false,error:'NOT_READY'})
  try{
   const candidates=await eligibleRenewalSubscriptions(admin,r)
   return json(200,{ok:true,candidates})
  }catch{return json(500,{ok:false,error:'CANDIDATE_LOOKUP_FAILED'})}
 }
 const status=url.searchParams.get('status')
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
  // Discover eligible subscriptions on the server; the client never types a UUID.
  let candidates:Candidate[]
  try{candidates=await eligibleRenewalSubscriptions(admin,r)}
  catch{return json(500,{ok:false,error:'CANDIDATE_LOOKUP_FAILED'})}
  const selectedId=String(body?.subscription_id||'')
  if(!UUID.test(selectedId)||!candidates.some(c=>c.id===selectedId))
   return json(409,{ok:false,error:'NO_ELIGIBLE_SUBSCRIPTION'})
  const subscriptionId=selectedId
  // Bank/InstaPay receipt evidence and subscription ledger entries do not establish
  // that the originating bank transaction has been reconciled without duplication.
  // Require explicit audited Super Admin attestation before manual completion.
  const reconciliationConfirmed=body?.bank_reconciliation_confirmed===true
  const reconciliationReference=typeof body?.bank_reconciliation_reference==='string'
   ? body.bank_reconciliation_reference.trim().slice(0,300):''
  if(['instapay','bank_transfer'].includes(r.preferred_payment_method)){
   if(!reconciliationConfirmed||!reconciliationReference)
    return json(409,{ok:false,error:'BANK_RECONCILIATION_CONFIRMATION_REQUIRED'})
   if(reconciliationReference.toLowerCase().startsWith('staging-test')||
      reconciliationReference.toLowerCase().startsWith('test-'))
    return json(409,{ok:false,error:'TEST_REFERENCE_NOT_ALLOWED_FOR_COMPLETION'})
   patch.admin_note=[
    String(r.admin_note||'').trim(),
    '[Renewal finance check] Super Admin confirmed bank/InstaPay source reviewed and no duplicate allocation. '+
     'Payment reference: '+reconciliationReference
   ].filter(Boolean).join('\n').slice(0,3000)
  }
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
