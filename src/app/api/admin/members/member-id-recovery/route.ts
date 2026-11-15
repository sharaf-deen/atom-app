export const runtime='nodejs'
export const dynamic='force-dynamic'

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'

const MEMBER_ID=/^ATOM-\d{6,}$/
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

export async function POST(req:Request){
  const session=createSupabaseServerActionClient()
  const {data:{user},error:authError}=await session.auth.getUser()
  if(authError||!user)return NextResponse.json({ok:false,error:'NOT_AUTHENTICATED'},{status:401})
  const {data:actor,error:actorError}=await session.from('profiles')
    .select('role,archived_at').eq('user_id',user.id).maybeSingle()
  if(actorError||normalizeRole(actor?.role)!=='super_admin'||actor?.archived_at){
    return NextResponse.json({ok:false,error:'SUPER_ADMIN_REQUIRED'},{status:403})
  }
  const body=await req.json().catch(()=>null)
  const action=body?.action
  const reason=String(body?.reason??'').trim()
  const db=createSupabaseAdminClient()
  let response
  if(action==='scan'){
    response=await db.rpc('member_id_gap_scan',{p_actor_id:user.id})
  } else if(action==='approve'){
    if(!Array.isArray(body?.codes)||body.codes.length<1||body.codes.length>50
       ||!body.codes.every((x:unknown)=>typeof x==='string'&&MEMBER_ID.test(x))
       ||new Set(body.codes).size!==body.codes.length
       ||body.attested!==true||reason.length<35||reason.length>1000){
      return NextResponse.json({ok:false,error:'REVIEW_ATTESTATION_REQUIRED'},{status:400})
    }
    response=await db.rpc('member_id_approve_gaps',{
      p_actor_id:user.id,p_codes:body.codes,p_reason:reason,p_attested:true
    })
  } else if(action==='release'){
    if(!UUID.test(String(body?.profileUserId??''))||body.confirmed!==true
       ||reason.length<35||reason.length>1000){
      return NextResponse.json({ok:false,error:'EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'},{status:400})
    }
    response=await db.rpc('member_id_release_archived_error',{
      p_actor_id:user.id,p_profile_user_id:body.profileUserId,p_reason:reason
    })
  } else {
    return NextResponse.json({ok:false,error:'INVALID_ACTION'},{status:400})
  }
  if(response.error){
    console.error('[member-id-recovery]',response.error.code,response.error.message)
    return NextResponse.json({ok:false,error:'REVIEW_BLOCKED_OR_FAILED'},{status:409})
  }
  revalidatePath('/admin/members/member-id-recovery')
  revalidatePath('/admin/members')
  revalidateTag('members')
  return NextResponse.json({ok:true,result:response.data},{headers:{'Cache-Control':'no-store'}})
}
