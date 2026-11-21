import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const revalidate=0

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const METHODS=['cash','instapay','card','bank_transfer'] as const
function reply(status:number,body:unknown) {
 const res=NextResponse.json(body,{status});res.headers.set('Cache-Control','no-store');return res
}
export async function POST(request:Request) {
 try {
  const session=createSupabaseServerActionClient()
  const {data:auth,error:authError}=await session.auth.getUser()
  if(authError||!auth.user)return reply(401,{ok:false,error:'NOT_AUTHENTICATED'})
  const {data:actor,error:actorError}=await session.from('profiles').select('role').eq('user_id',auth.user.id).maybeSingle()
  if(actorError)return reply(500,{ok:false,error:'ROLE_LOOKUP_FAILED'})
  if(actor?.role!=='super_admin')return reply(403,{ok:false,error:'SUPER_ADMIN_REQUIRED'})
  const body=await request.json().catch(()=>null)
  const fromId=String(body?.subscription_id||'')
  const target=String(body?.target_plan||'')
  const paymentDate=String(body?.payment_date||'')
  const method=String(body?.payment_method||'')
  const requestKey=String(body?.request_key||'')
  const receiptAttested=body?.receipt_attested===true
  const bankRef=String(body?.bank_reference||'').trim().slice(0,250)
  const note=String(body?.approval_note||'').trim().slice(0,2000)
  const credit=body?.expected_credit_egp
  const due=body?.expected_payment_egp
  if(!UUID.test(fromId)||!UUID.test(requestKey))return reply(400,{ok:false,error:'INVALID_ID'})
  if(!['1w','1m','3m','6m','12m'].includes(target)||!METHODS.includes(method as typeof METHODS[number]))
    return reply(400,{ok:false,error:'INVALID_PLAN_OR_METHOD'})
  if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
     Number.isNaN(Date.parse(paymentDate+'T00:00:00Z')) ||
     new Date(paymentDate+'T00:00:00Z').toISOString().slice(0,10)!==paymentDate)
     return reply(400,{ok:false,error:'INVALID_PAYMENT_DATE'})
  if(typeof credit!=='number'||typeof due!=='number'||!Number.isFinite(credit)||!Number.isFinite(due)||credit<0||due<0)
    return reply(400,{ok:false,error:'INVALID_EXPECTED_AMOUNT'})
  if(!receiptAttested)return reply(400,{ok:false,error:'RECEIPT_ATTESTATION_REQUIRED'})
  if(['instapay','bank_transfer'].includes(method)&&bankRef.length<3)
    return reply(400,{ok:false,error:'BANK_REFERENCE_REQUIRED'})
  const admin=createSupabaseAdminClient()
  const {data,error}=await admin.rpc('apply_membership_upgrade_v1',{
   p_from_subscription_id:fromId,p_to_plan:target,p_payment_date:paymentDate,p_payment_method:method,
   p_actor:auth.user.id,p_idempotency_key:requestKey,p_expected_credit:credit,
   p_expected_due:due,p_receipt_attested:true,p_bank_reference:bankRef||null,p_approval_note:note||null,
  })
  if(error){
   const conflict=['23514','23505'].includes(error.code||'')
   const status=error.code==='42501'?403:error.code==='P0002'?404:conflict?409:error.code==='22023'?400:500
   return reply(status,{ok:false,error:error.message||'UPGRADE_FAILED',code:error.code})
  }
  if(!data?.ok)return reply(500,{ok:false,error:'INVALID_UPGRADE_RESULT'})
  revalidatePath('/members')
  revalidatePath('/admin/membership-upgrades')
  if(data.subscription_id)revalidatePath('/members/'+data.subscription_id)
  return reply(200,{ok:true,result:data})
 }catch(e:any){return reply(500,{ok:false,error:e?.message||'UPGRADE_ERROR'})}
}
