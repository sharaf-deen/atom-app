export const dynamic='force-dynamic'
export const revalidate=0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import ProgramHealthDashboard, { type ProgramHealth } from './ProgramHealthDashboard'

type Snapshot={as_of:string;methodology:string;programs:ProgramHealth[]}

export default async function ProgramHealthPage(){
  const me=await getSessionUser()
  if(!me)redirect('/login?next=/admin/program-health')
  if(me.role!=='super_admin')return <main className="p-6">Access denied — Super Admin only.</main>

  const admin=createSupabaseAdminClient()
  const {data,error}=await admin.rpc('atom_program_health_snapshot',{p_actor:me.id})
  if(error||!data||typeof data!=='object'||!Array.isArray((data as Snapshot).programs)){
    console.error('[program-health-snapshot]',error?.code)
    return <main className="mx-auto max-w-5xl space-y-3 p-6">
      <h1 className="text-2xl font-bold">Program Health</h1>
      <p className="text-sm text-rose-700">Dashboard data unavailable. Verify Program Health database migration and permissions.</p>
    </main>
  }
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold sm:text-3xl">Program Health</h1>
      <p className="mt-1 text-sm text-slate-600">Super Admin · Enrollment, membership access, attendance, capacity and payment insights.</p></div>
    <ProgramHealthDashboard snapshot={data as Snapshot}/>
  </main>
}
