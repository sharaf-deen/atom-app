import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type RenewalNotice={memberId:string;actorId:string;requestId:string;status:string;toAdmin?:boolean}
export async function sendRenewalNotice({memberId,actorId,requestId,status,toAdmin=false}:RenewalNotice){
  const admin=createSupabaseAdminClient()
  const targets:string[]=toAdmin
    ? (await admin.from('profiles').select('user_id').eq('role','super_admin')).data?.map(x=>x.user_id)??[]
    : [memberId]
  if(!targets.length)return
  const title=toAdmin?'New membership renewal request':'Membership renewal update'
  const text=toAdmin
    ? 'A member submitted a renewal request. Review it in the Super Admin dashboard.'
    : 'Your membership renewal request is now '+status.replace(/_/g,' ')+'. View the details from My Membership.'
  const {error}=await admin.from('notifications').insert(targets.map(userId=>({
    member_id:memberId,user_id:userId,created_by:actorId,kind:'billing',title,body:text+' Request: '+requestId
  })))
  if(error)throw error
}
