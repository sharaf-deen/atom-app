import { NextResponse } from 'next/server'
import { revalidatePath,revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { ensureYasin1440CorrectiveInvoice } from '@/lib/yasin1440CorrectiveInvoice'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const revalidate=0
function reply(status:number,data:unknown){
 const response=NextResponse.json(data,{status})
 response.headers.set('Cache-Control','no-store')
 return response
}
export async function POST(request:Request){
 try {
  const session=createSupabaseServerActionClient()
  const {data:auth,error:authError}=await session.auth.getUser()
  if(authError||!auth.user)return reply(401,{ok:false,error:'NOT_AUTHENTICATED'})
  const {data:actor,error:roleError}=await session.from('profiles')
    .select('role').eq('user_id',auth.user.id).maybeSingle()
  if(roleError||actor?.role!=='super_admin')
    return reply(403,{ok:false,error:'SUPER_ADMIN_REQUIRED'})
  const body=await request.json().catch(()=>null)
  if(!body||!['preview','apply','retry_invoice'].includes(String(body.operation??'')))
    return reply(400,{ok:false,error:'INVALID_OPERATION'})
  if(body.memberId!=='ATOM-000150'||body.confirmOutstandingEGP!==1294.76)
    return reply(400,{ok:false,error:'MEMBER_OR_FINANCIAL_CONFIRMATION_MISMATCH'})
  const admin=createSupabaseAdminClient()
  if(body.operation==='retry_invoice'){
    const invoice=await ensureYasin1440CorrectiveInvoice(admin,auth.user.id)
    revalidateTag('invoices')
    return reply(200,{ok:true,invoice})
  }
  const {data,error}=await admin.rpc('atom_correct_yasin_1440',{
    p_actor:auth.user.id,p_apply:body.operation==='apply'
  })
  if(error){
    const known=error.code==='42501'?403:
      error.message?.includes('CHANGED')||error.message?.includes('REQUIRES_REVIEW')
      ||error.message?.includes('EXPIRED')?409:500
    return reply(known,{ok:false,error:error.message||'FINANCIAL_RECOVERY_FAILED'})
  }
  if(!data?.ok)return reply(500,{ok:false,error:'INVALID_RECOVERY_RESULT'})
  if(body.operation==='preview')return reply(200,data)
  revalidatePath('/members')
  revalidatePath('/members/18bed597-5f7e-4518-915f-0c5c5f8d0f05')
  revalidatePath('/members/18bed597-5f7e-4518-915f-0c5c5f8d0f05/subscriptions')
  revalidatePath('/invoices')
  revalidateTag('invoices')
  let invoice=null,invoice_error:string|null=null
  try {invoice=await ensureYasin1440CorrectiveInvoice(admin,auth.user.id)}
  catch(e:any){invoice_error=String(e?.message||'CORRECTIVE_INVOICE_RETRY_REQUIRED')}
  return reply(200,{ok:true,result:data,invoice,invoice_ok:!invoice_error,
   ...(invoice_error?{invoice_error,invoice_retryable:true}:{})})
 }catch(e:any){return reply(500,{ok:false,error:e?.message||'FINANCIAL_RECOVERY_ERROR'})}
}
