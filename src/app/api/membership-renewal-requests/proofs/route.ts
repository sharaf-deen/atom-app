export const runtime='nodejs'
export const dynamic='force-dynamic'
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const ALLOWED=new Set(['image/jpeg','image/png','application/pdf'])
function json(status:number,body:unknown){const r=NextResponse.json(body,{status});r.headers.set('Cache-Control','no-store');return r}
export async function POST(req:Request){
 const supa=createSupabaseServerActionClient()
 const {data:{user}}=await supa.auth.getUser()
 if(!user)return json(401,{ok:false,error:'NOT_AUTHENTICATED'})
 const form=await req.formData().catch(()=>null)
 const requestId=String(form?.get('request_id')||'')
 const file=form?.get('file')
 if(!UUID.test(requestId)||!(file instanceof File))return json(400,{ok:false,error:'INVALID_UPLOAD'})
 if(!ALLOWED.has(file.type)||file.size<=0||file.size>10485760)
   return json(400,{ok:false,error:'INVALID_FILE_TYPE_OR_SIZE'})
 const admin=createSupabaseAdminClient()
 const {data:r}=await admin.from('membership_renewal_requests')
  .select('id,member_id,requested_by,status,preferred_payment_method').eq('id',requestId).maybeSingle()
 if(!r||(r.member_id!==user.id&&r.requested_by!==user.id))return json(404,{ok:false,error:'NOT_FOUND'})
 if(!['instapay','bank_transfer'].includes(r.preferred_payment_method))
   return json(409,{ok:false,error:'RECEIPT_NOT_ALLOWED_FOR_PAYMENT_METHOD'})
 if(['completed','cancelled','rejected'].includes(r.status))return json(409,{ok:false,error:'REQUEST_CLOSED'})
 const amountRaw=String(form?.get('declared_amount_egp')||'').trim()
 const declaredAmount=amountRaw?Number(amountRaw):null
 if(declaredAmount!==null&&(!Number.isFinite(declaredAmount)||declaredAmount<=0||declaredAmount>100000000))
   return json(400,{ok:false,error:'INVALID_DECLARED_AMOUNT'})
 const reference=String(form?.get('reference')||'').trim().slice(0,160)||null
 const extension=file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg'
 const path=`${r.member_id}/${requestId}/${crypto.randomUUID()}.${extension}`
 const bytes=Buffer.from(await file.arrayBuffer())
 // Magic byte checks; MIME alone is user-provided.
 const valid=file.type==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':
   file.type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
   bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
 if(!valid)return json(400,{ok:false,error:'FILE_CONTENT_MISMATCH'})
 const {error:uploadError}=await admin.storage.from('membership-renewal-proofs')
  .upload(path,bytes,{upsert:false,contentType:file.type})
 if(uploadError)return json(500,{ok:false,error:'UPLOAD_FAILED'})
 const {data,error}=await admin.from('membership_renewal_proofs').insert({
  request_id:requestId,uploaded_by:user.id,storage_path:path,
  original_filename:file.name.slice(0,150),mime_type:file.type,file_size_bytes:file.size,
  declared_amount_egp:declaredAmount,declared_payment_reference:reference,
 }).select('id,review_status').single()
 if(error){
  await admin.storage.from('membership-renewal-proofs').remove([path])
  return json(500,{ok:false,error:'EVIDENCE_SAVE_FAILED'})
 }
 return json(201,{ok:true,proof:data,notice:'Receipt submitted for manual verification; no payment was recorded.'})
}
export async function GET(req:Request){
 const supa=createSupabaseServerActionClient()
 const {data:{user}}=await supa.auth.getUser()
 if(!user)return json(401,{ok:false,error:'NOT_AUTHENTICATED'})
 const url=new URL(req.url),requestId=url.searchParams.get('request_id')||''
 if(!UUID.test(requestId))return json(400,{ok:false,error:'INVALID_ID'})
 const admin=createSupabaseAdminClient()
 const {data:profile}=await supa.from('profiles').select('role').eq('user_id',user.id).maybeSingle()
 const {data:r}=await admin.from('membership_renewal_requests').select('id,member_id,requested_by').eq('id',requestId).maybeSingle()
 if(!r||(r.member_id!==user.id&&r.requested_by!==user.id&&profile?.role!=='super_admin'))
   return json(404,{ok:false,error:'NOT_FOUND'})
 const {data:proofs,error}=await admin.from('membership_renewal_proofs')
   .select('id,storage_path,original_filename,declared_amount_egp,declared_payment_reference,review_status,verified_amount_egp,created_at')
   .eq('request_id',requestId).order('created_at',{ascending:false})
 if(error)return json(500,{ok:false,error:'QUERY_FAILED'})
 const items=await Promise.all((proofs||[]).map(async p=>{
  const {data:link}=await admin.storage.from('membership-renewal-proofs').createSignedUrl(p.storage_path,600)
  return {id:p.id,original_filename:p.original_filename,declared_amount_egp:p.declared_amount_egp,
   declared_payment_reference:p.declared_payment_reference,review_status:p.review_status,
   verified_amount_egp:p.verified_amount_egp,created_at:p.created_at,url:link?.signedUrl||null}
 }))
 return json(200,{ok:true,proofs:items})
}
