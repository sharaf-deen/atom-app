import { notFound } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import Yasin1440RecoveryClient from '@/components/admin/Yasin1440RecoveryClient'

export const dynamic='force-dynamic'
export const revalidate=0

export default async function FinancialRecovery1440Page(){
  const me=await getSessionUser()
  if(me?.role!=='super_admin')notFound()
  return <Yasin1440RecoveryClient/>
}
