import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { cairoToday } from '@/lib/cairoDate'
import AdminMembershipUpgradePreview from '@/components/admin/AdminMembershipUpgradePreview'
export const dynamic='force-dynamic'
export const revalidate=0

export default async function AdminMembershipUpgradesPage({
 searchParams,
}: {searchParams?:{subscription_id?:string}}) {
 const me=await getSessionUser()
 if(!me)redirect('/login?next=%2Fadmin%2Fmembership-upgrades')
 if(me.role!=='super_admin')return <main className="mx-auto max-w-3xl p-6">Super Admin access required.</main>
 return <AdminMembershipUpgradePreview subscriptionId={searchParams?.subscription_id||''} today={cairoToday()}/>
}
