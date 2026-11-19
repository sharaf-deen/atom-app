import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import AdminMembershipRenewals from '@/components/admin/AdminMembershipRenewals'
export const dynamic='force-dynamic'
export default async function AdminMembershipRenewalRequestsPage(){
 const user=await getSessionUser()
 if(!user)redirect('/login?next=%2Fadmin%2Fmembership-renewal-requests')
 if(user.role!=='super_admin')redirect('/profile')
 return <AdminMembershipRenewals/>
}
