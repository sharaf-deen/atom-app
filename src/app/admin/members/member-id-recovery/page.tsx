export const dynamic='force-dynamic'
export const revalidate=0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import MemberIdRecoveryPanel from './MemberIdRecoveryPanel'

export default async function MemberIdRecoveryPage(){
  const user=await getSessionUser()
  if(!user)redirect('/login?next=/admin/members/member-id-recovery')
  if(user.role!=='super_admin')return <main className="p-6">Access denied — Super Admin only.</main>

  const db=getSupabaseAdminClientCached()
  // Fresh inventory is automatically computed on each visit (daily scan also scheduled).
  const result=await db.rpc('member_id_gap_scan',{p_actor_id:user.id})
  if(result.error){
    console.error('[member-id-gap-scan]',result.error.code)
    return <main className="p-6">Unable to refresh Member ID audit. Check database migrations.</main>
  }
  const [gaps,profiles]=await Promise.all([
    db.from('member_id_gap_review')
      .select('member_id,classification,evidence,approved_at,last_scanned_at')
      .neq('classification','no_longer_missing').order('member_id'),
    db.from('profiles')
      .select('user_id,member_id,first_name,last_name,archive_reason')
      .eq('role','member')
      .not('archived_at','is',null)
      .ilike('archive_reason','CREATED_IN_ERROR:%')
      .order('member_id')
  ])
  if(gaps.error||profiles.error)return <main className="p-6">Unable to load Member ID audit.</main>
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <h1 className="text-2xl font-bold">Member ID Recovery</h1>
    <p className="text-sm text-gray-600">All actions are reviewed and logged. Automatic detection never implies permission to reuse an historical ID.</p>
    <MemberIdRecoveryPanel initialGaps={(gaps.data??[]) as any} archived={(profiles.data??[]) as any}/>
  </main>
}
