export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import CoachingMonthlyDeclarations from '@/components/staff-payroll/CoachingMonthlyDeclarations'
import { getSessionUser } from '@/lib/session'

function previousCairoMonth() {
 const now = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).format(new Date())
 const [year,month] = now.slice(0,7).split('-').map(Number)
 return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7)
}

export default async function Page({searchParams}:{searchParams?:{month?:string}}){
 const me=await getSessionUser()
 if(!me)redirect('/login?next=/coach-operations/monthly-declarations')
 if(!['coach','assistant_coach','head_coach','super_admin'].includes(me.role))redirect('/forbidden')
 const month=typeof searchParams?.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month)
  ?searchParams.month:previousCairoMonth()
 return <CoachingMonthlyDeclarations initialMonth={month} adminView={false} />
}
