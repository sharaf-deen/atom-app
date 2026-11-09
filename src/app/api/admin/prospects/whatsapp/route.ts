export const runtime='nodejs'
export const dynamic='force-dynamic'
import { NextRequest,NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {configuredWhatsApp,whatsappGraphVersion} from '@/lib/whatsappCloud'
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}})
const allowed=(role:string)=>['super_admin','admin','reception'].includes(role)
async function guard(){
 const me=await getSessionUser()
 if(!me||!allowed(me.role))return null
 return me
}
export async function GET(req:NextRequest){
 const me=await guard()
 if(!me)return json({ok:false,error:'FORBIDDEN'},403)
 const admin=createSupabaseAdminClient()
 const conversationId=new URL(req.url).searchParams.get('conversation_id')
 if(conversationId){
  if(!/^[0-9a-f-]{36}$/i.test(conversationId))return json({ok:false,error:'INVALID_CONVERSATION'},400)
  const {data,error}=await admin.from('crm_whatsapp_messages').select('id,body,direction,message_type,status,occurred_at,error_code')
    .eq('conversation_id',conversationId).order('occurred_at',{ascending:true}).limit(150)
  if(error)return json({ok:false,error:'LOAD_FAILED'},500)
  return json({ok:true,messages:data??[]})
 }
 const [templatesResult, conversationsResult]=await Promise.all([admin.from('prospect_message_templates').select('template_key,language,label,body_template').eq('channel','whatsapp').eq('is_active',true).limit(100),admin.from('crm_whatsapp_conversations').select(
 'id,wa_id,display_name,prospect_id,last_inbound_at,last_message_at,prospects(full_name,status)'
 ).order('last_message_at',{ascending:false,nullsFirst:false}).limit(100)])
 if(conversationsResult.error||templatesResult.error)return json({ok:false,error:'LOAD_FAILED'},500)
 return json({ok:true,configured:configuredWhatsApp(),conversations:conversationsResult.data??[],templates:templatesResult.data??[]})
}
export async function POST(req:NextRequest){
 const me=await guard()
 if(!me)return json({ok:false,error:'FORBIDDEN'},403)
 if(!configuredWhatsApp())return json({ok:false,error:'WHATSAPP_NOT_CONFIGURED'},503)
 let body:any
 try{body=await req.json()}catch{return json({ok:false,error:'INVALID_JSON'},400)}
 const id=String(body?.conversation_id??'')
 const key=String(body?.client_request_id??'')
 const text=String(body?.message??'').trim()
 if(!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(key) || !text || text.length>4096)
 return json({ok:false,error:'INVALID_SEND_REQUEST'},400)
 const admin=createSupabaseAdminClient()
 const {data:conv,error:lookupError}=await admin.from('crm_whatsapp_conversations')
 .select('id,wa_id,last_inbound_at,phone_number_id').eq('id',id).maybeSingle()
 if(lookupError||!conv)return json({ok:false,error:'CONVERSATION_NOT_FOUND'},404)
 if(conv.phone_number_id!==process.env.WA_PHONE_NUMBER_ID)return json({ok:false,error:'PHONE_NUMBER_MISMATCH'},409)
 const last=new Date(conv.last_inbound_at??0).getTime()
 // Send only in an active 24h service window; out-of-window templates need a separate opt-in workflow.
 if(!last || Date.now()-last>=23*3600000 || last>Date.now()+60000)
 return json({ok:false,error:'CUSTOMER_SERVICE_WINDOW_CLOSED',details:'Only approved templates with opt-in can be sent outside the WhatsApp service window.'},409)
 // Reserve a unique client request ID before invoking Meta to prevent double-click and retry duplicates.
 const {data:reservation,error:reserveError}=await admin.from('crm_whatsapp_messages').insert({
 conversation_id:id,client_request_id:key,direction:'outbound',message_type:'text',body:text,
 status:'sending',sent_by:me.id,occurred_at:new Date().toISOString()
 }).select('id').single()
 if(reserveError)return json({ok:false,error:reserveError.code==='23505'?'DUPLICATE_SEND_REQUEST':'SEND_RESERVATION_FAILED'},reserveError.code==='23505'?409:500)
 let response:Response
 try {
  response=await fetch('https://graph.facebook.com/'+whatsappGraphVersion()+'/'+encodeURIComponent(conv.phone_number_id)+'/messages',{
    method:'POST',headers:{Authorization:'Bearer '+process.env.WA_ACCESS_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:conv.wa_id,
      type:'text',text:{preview_url:false,body:text}}),
    signal:AbortSignal.timeout(12000)
  })
 }catch{
  // A timeout is ambiguous: do NOT retry automatically with a new request id.
  await admin.from('crm_whatsapp_messages').update({status:'failed',error_code:'SEND_OUTCOME_UNKNOWN',updated_at:new Date().toISOString()}).eq('id',reservation.id)
  return json({ok:false,error:'SEND_OUTCOME_UNKNOWN',details:'Check Meta and WhatsApp before any manual retry.'},502)
 }
 const result=await response.json().catch(()=>null)
 const wamid=String(result?.messages?.[0]?.id??'')
 if(!response.ok||!wamid){
  await admin.from('crm_whatsapp_messages').update({status:'failed',
    error_code:String(result?.error?.code??'META_REJECTED').slice(0,80),updated_at:new Date().toISOString()}).eq('id',reservation.id)
  return json({ok:false,error:'META_REJECTED',code:result?.error?.code??null},502)
 }
 const {error:updateError}=await admin.from('crm_whatsapp_messages').update({
  provider_message_id:wamid,status:'queued',updated_at:new Date().toISOString()
 }).eq('id',reservation.id)
 if(updateError)return json({ok:false,error:'META_ACCEPTED_DB_UPDATE_FAILED',details:'Do not retry. Check Meta dashboard.'},503)
 await admin.from('crm_whatsapp_conversations').update({last_message_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id)
 return json({ok:true,provider_message_id:wamid,provider_accepted:true,delivered:false})
}
