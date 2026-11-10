export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest,NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { verifyWhatsAppSignature,waDigits,incomingText } from '@/lib/whatsappCloud'
import { allowedWhatsAppPriorStatuses } from '@/lib/whatsappWebhookStatus'
const plain=(message:string,status=200)=>new NextResponse(message,{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}})
export async function GET(req:NextRequest){
 const url=new URL(req.url)
 if (url.searchParams.get('hub.mode')!=='subscribe' || !process.env.WA_VERIFY_TOKEN ||
     url.searchParams.get('hub.verify_token')!==process.env.WA_VERIFY_TOKEN) return plain('Forbidden',403)
 const challenge=url.searchParams.get('hub.challenge')
 return challenge && /^\d{1,200}$/.test(challenge)?plain(challenge):plain('Bad challenge',400)
}
export async function POST(req:NextRequest){
 const secret=process.env.WA_APP_SECRET
 if(!secret)return plain('Not configured',503)
 const raw=await req.text()
 if(Buffer.byteLength(raw,'utf8')>1024*1024)return plain('Too large',413)
 if(!verifyWhatsAppSignature(raw,req.headers.get('x-hub-signature-256'),secret))
   return plain('Invalid signature',401)
 let payload:any
 try{payload=JSON.parse(raw)}catch{return plain('Invalid JSON',400)}
 if(payload?.object!=='whatsapp_business_account')return plain('Ignored')
 try {
  const admin=createSupabaseAdminClient()
  for(const entry of payload.entry??[]){
   for(const change of entry.changes??[]){
    if(change.field!=='messages')continue
    const value=change.value??{}
    const numberId=String(value.metadata?.phone_number_id??'')
    if(!numberId||numberId!==process.env.WA_PHONE_NUMBER_ID) continue
    for(const message of value.messages??[]){
     const externalId=String(message.id??'')
     const sender=waDigits(message.from)
     if(!externalId||!sender)continue
     const time=Number(message.timestamp)
     const at=Number.isFinite(time)&&time>0?new Date(time*1000).toISOString():new Date().toISOString()
     const displayName=String((value.contacts??[]).find((x:any)=>waDigits(x.wa_id)===sender)?.profile?.name??'').slice(0,180)
     const {data:possible,error:findError}=await admin.from('prospects').select('id').eq('phone_digits',sender).limit(2)
     if(findError)throw findError
     const prospectId=possible?.length===1?possible[0].id:null
     const {data:existing,error:existingError}=await admin.from('crm_whatsapp_conversations')
        .select('id,prospect_id,last_inbound_at,last_message_at').eq('phone_number_id',numberId).eq('wa_id',sender).maybeSingle()
     if(existingError)throw existingError
     let conversationId:string
     if(existing){
      conversationId=existing.id
     }else{
      const {data:row,error:e}=await admin.from('crm_whatsapp_conversations').upsert({
        phone_number_id:numberId,wa_id:sender,display_name:displayName||null,
        prospect_id:prospectId
      },{onConflict:'phone_number_id,wa_id'}).select('id').single()
      if(e)throw e
      conversationId=row.id
     }
     const {error:insertError}=await admin.from('crm_whatsapp_messages').insert({
       conversation_id:conversationId,provider_message_id:externalId,direction:'inbound',
       status:'received',message_type:String(message.type??'unknown').slice(0,32),
       body:incomingText(message),occurred_at:at
     })
     if(insertError && insertError.code!=='23505')throw insertError
     // A webhook replay must not move the 24-hour window backwards.
     if(!existing || !existing.last_inbound_at || at>existing.last_inbound_at){
       const {error:updateError}=await admin.from('crm_whatsapp_conversations')
        .update({last_inbound_at:at,last_message_at:at,updated_at:new Date().toISOString(),
          ...(displayName?{display_name:displayName}:{}) ,
          ...(existing?.prospect_id?{}:{prospect_id:prospectId})})
        .eq('id',conversationId)
       if(updateError)throw updateError
     }
    }
    for(const status of value.statuses??[]){
      const id=String(status.id??'')
      const eventStatus=String(status.status??'')
      if(!id || !['sent','delivered','read','failed'].includes(eventStatus))continue
      const {data:row,error:findError}=await admin.from('crm_whatsapp_messages')
       .select('id,status').eq('provider_message_id',id).eq('direction','outbound').maybeSingle()
      if(findError)throw findError
      if(!row)continue
      const allowedPreviousStatuses=allowedWhatsAppPriorStatuses(eventStatus)
      if(!allowedPreviousStatuses.includes(row.status))continue
      // Guard the UPDATE as well as the read: concurrent/out-of-order webhooks
      // must not overwrite a newer delivery status with an older one.
      const {error:updateError}=await admin.from('crm_whatsapp_messages').update({
        status:eventStatus,error_code:eventStatus==='failed'
          ?String(status.errors?.[0]?.code??'PROVIDER_FAILED').slice(0,80):null,
        updated_at:new Date().toISOString()
      }).eq('id',row.id).in('status',allowedPreviousStatuses)
      if(updateError)throw updateError
    }
   }
  }
 }catch(error){
   // A non-2xx response lets Meta retry. Never log message bodies or secrets.
   console.error('WhatsApp webhook persistence failed')
   return plain('Temporary failure',503)
 }
 return plain('OK')
}
