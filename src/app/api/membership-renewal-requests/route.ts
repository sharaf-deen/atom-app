export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { renewalQuote, RENEWAL_METHODS } from '@/lib/membershipRenewalQuote'
import { sendRenewalNotice } from '@/lib/membershipRenewalNotifications'
import { hasLifetimeGymAccess } from '@/lib/rbac'

function respond(code:number,body:unknown){const r=NextResponse.json(body,{status:code});r.headers.set('Cache-Control','no-store');return r}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
async function userId(){
  const client=createSupabaseServerActionClient()
  const {data:{user}}=await client.auth.getUser()
  return user?.id??null
}
const publicFields='id,member_id,plan,status,preferred_payment_method,catalog_price_egp,quoted_price_egp,approved_price_egp,pricing_snapshot,member_comment,source_subscription_id,completed_subscription_id,created_at,updated_at,version'

export async function GET(req:Request){
  const actor=await userId()
  if(!actor)return respond(401,{ok:false,error:'NOT_AUTHENTICATED'})
  const admin=createSupabaseAdminClient()
  const url=new URL(req.url)
  const quotePlan=url.searchParams.get('quote')
  if(quotePlan){
    try{return respond(200,{ok:true,quote:await renewalQuote(quotePlan)})}
    catch{return respond(400,{ok:false,error:'PRICE_UNAVAILABLE'})}
  }
  const id=url.searchParams.get('id')
  if(id && !UUID.test(id))return respond(400,{ok:false,error:'INVALID_ID'})
  let query=admin.from('membership_renewal_requests').select(publicFields).eq('member_id',actor).order('created_at',{ascending:false}).limit(40)
  if(id)query=query.eq('id',id)
  const {data,error}=await query
  if(error)return respond(500,{ok:false,error:'QUERY_FAILED'})
  if(id && !(data||[]).length)return respond(404,{ok:false,error:'NOT_FOUND'})
  let events:any[]=[]
  if(id){
    const {data:history}=await admin.from('membership_renewal_events')
      .select('id,event_type,previous_status,next_status,member_summary,created_at')
      .eq('request_id',id).order('created_at',{ascending:true})
    events=history??[]
  }
  const configured=process.env.ATOM_SUPER_ADMIN_WHATSAPP||''
  const supportWhatsApp=/^[1-9][0-9]{7,14}$/.test(configured)?configured:null
  return respond(200,{ok:true,requests:data??[],events,supportWhatsApp})
}

export async function POST(req:Request){
  const actor=await userId()
  if(!actor)return respond(401,{ok:false,error:'NOT_AUTHENTICATED'})
  const body=await req.json().catch(()=>null)
  const plan=String(body?.plan??'')
  const method=String(body?.payment_method??'')
  if(!RENEWAL_METHODS.includes(method as any))return respond(400,{ok:false,error:'INVALID_PAYMENT_METHOD'})
  const note=typeof body?.comment==='string'?body.comment.trim().slice(0,1000):null
  try{
    const admin=createSupabaseAdminClient()
    const {data:profile}=await admin.from('profiles').select('user_id,archived_at,role').eq('user_id',actor).maybeSingle()
    if(!profile||profile.archived_at||hasLifetimeGymAccess(profile.role as any))return respond(403,{ok:false,error:'PROFILE_NOT_ELIGIBLE'})
    // Avoid creating new financial records here. The user is requesting a renewal, not paying.
    const quote=await renewalQuote(plan)
    const {data:latest}=await admin.from('subscriptions')
      .select('id').eq('member_id',actor).order('created_at',{ascending:false}).limit(1).maybeSingle()
    const {data,error}=await admin.from('membership_renewal_requests').insert({
      member_id:actor,requested_by:actor,last_actor_id:actor,
      source_subscription_id:latest?.id||null,plan:quote.plan,package_id:quote.package_id,
      preferred_payment_method:method,catalog_price_egp:quote.catalog_price_egp,
      quoted_price_egp:quote.quoted_price_egp,pricing_snapshot:quote.pricing_snapshot,
      member_comment:note,status:'pending_review'
    }).select('id,status,quoted_price_egp').single()
    if(error?.code==='23505')return respond(409,{ok:false,error:'OPEN_REQUEST_EXISTS'})
    if(error)return respond(500,{ok:false,error:'SAVE_FAILED'})
    try{await sendRenewalNotice({memberId:actor,actorId:actor,requestId:data.id,status:'pending_review',toAdmin:true})}catch(e){console.error('renewal notification failed',e)}
    return respond(201,{ok:true,request:data})
  }catch(e:any){
    if(e?.message==='INVALID_PLAN'||e?.message==='PACKAGE_PRICE_UNAVAILABLE'||e?.message==='INVALID_CATALOG_PRICE')
      return respond(400,{ok:false,error:e.message})
    return respond(500,{ok:false,error:'SUBMISSION_FAILED'})
  }
}

export async function PATCH(req:Request){
  const actor=await userId()
  if(!actor)return respond(401,{ok:false,error:'NOT_AUTHENTICATED'})
  const body=await req.json().catch(()=>null)
  const id=String(body?.id||'')
  const version=Number(body?.version)
  if(!UUID.test(id)||!Number.isInteger(version)||version<1)return respond(400,{ok:false,error:'INVALID_REQUEST'})
  const admin=createSupabaseAdminClient()
  const {data:existing}=await admin.from('membership_renewal_requests')
    .select('id,plan,status,member_id,version,pricing_snapshot').eq('id',id).eq('member_id',actor).maybeSingle()
  if(!existing)return respond(404,{ok:false,error:'NOT_FOUND'})
  if(!['pending_review','changes_requested'].includes(existing.status))
    return respond(409,{ok:false,error:'ALREADY_REVIEWED'})
  let patch:any={version:version+1,last_actor_id:actor}
  if(body?.action==='cancel'){
    patch.status='cancelled';patch.cancelled_at=new Date().toISOString()
  }else if(body?.action==='edit'){
    const method=String(body?.payment_method??'')
    if(!RENEWAL_METHODS.includes(method as any))return respond(400,{ok:false,error:'INVALID_PAYMENT_METHOD'})
    let quote
    try{quote=await renewalQuote(String(body?.plan??''))}catch{return respond(400,{ok:false,error:'PRICE_UNAVAILABLE'})}
    patch={...patch,status:'pending_review',plan:quote.plan,
      package_id:quote.package_id,catalog_price_egp:quote.catalog_price_egp,
      quoted_price_egp:quote.quoted_price_egp,pricing_snapshot:quote.pricing_snapshot,
      preferred_payment_method:method,
      member_comment:typeof body?.comment==='string'?body.comment.trim().slice(0,1000):null}
  }else{return respond(400,{ok:false,error:'INVALID_ACTION'})}
  const {data,error}=await admin.from('membership_renewal_requests').update(patch)
    .eq('id',id).eq('member_id',actor).eq('version',version)
    .in('status',['pending_review','changes_requested'])
    .select('id,status,version').maybeSingle()
  if(error)return respond(500,{ok:false,error:'UPDATE_FAILED'})
  if(!data)return respond(409,{ok:false,error:'STALE_REQUEST'})
  try{await sendRenewalNotice({memberId:actor,actorId:actor,requestId:id,status:data.status,toAdmin:true})}catch(e){console.error('renewal notification failed',e)}
  return respond(200,{ok:true,request:data})
}
