export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import CoachingMonthlyDeclarations from '@/components/staff-payroll/CoachingMonthlyDeclarations'
import { getSessionUser } from '@/lib/session'

export default async function Page({searchParams}:{searchParams?:{month?:string}}){
 const me=await getSessionUser()
 if(!me)redirect('/login?next=/coach-operations/monthly-declarations')
 if(!['coach','assistant_coach','head_coach','super_admin'].includes(me.role))redirect('/forbidden')
 const month=typeof searchParams?.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month)
  ?searchParams.month:'2026-10'
 return <CoachingMonthlyDeclarations initialMonth={month} adminView={false} />
}
