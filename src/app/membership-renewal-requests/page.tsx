export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import MembershipRenewalRequestsClient from '@/components/members/MembershipRenewalRequestsClient'
export default async function MembershipRenewalRequestsPage(){
 const user=await getSessionUser()
 if(!user)redirect('/login?next=%2Fmembership-renewal-requests')
 return <MembershipRenewalRequestsClient/>
}
