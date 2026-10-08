export const dynamic = 'force-dynamic'
export const revalidate = 0
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminSubnav from '@/components/private-coaching/PrivateCoachingAdminSubnav'
import PrivateCoachingAddAvailabilityClient from '@/components/private-coaching/PrivateCoachingAddAvailabilityClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { PRIVATE_COACHING_ALLOWED_MEMBER_ROLES, privateCoachingMemberName } from '@/lib/privateCoaching'
type ProfileRow = { user_id: string; member_id: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }
function profileMeta(profile: ProfileRow) { return [profile.member_id ? `ID ${profile.member_id}` : '', profile.email ?? '', profile.phone ?? ''].filter(Boolean).join(' · ') || 'No profile details' }
export default async function Page() {
  const me = await getSessionUserCached(); if (!me) redirect('/login?next=/head-coach/private-coaching/availability/new')
  if (me.role !== 'head_coach' && me.role !== 'super_admin') return <AccessDeniedPage title="Add availability" subtitle="Access restricted." signedInAs={me.email} message="Only Head Coach and Super Admin can manage private coaching." allowed="head_coach, super_admin" nextPath="/head-coach/private-coaching/availability/new" actions={[{ href: '/', label: 'Go Home' }]} showBackHome />
  const admin = getSupabaseAdminClientCached(); const [membersRes, coachesRes] = await Promise.all([admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').in('role', [...PRIVATE_COACHING_ALLOWED_MEMBER_ROLES]).not('user_id', 'is', null).order('first_name', { ascending: true }).limit(1000), admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').eq('role', 'head_coach').not('user_id', 'is', null)])
  const members = ((membersRes.data ?? []) as ProfileRow[]).filter((row) => row.user_id); const coaches = ((coachesRes.data ?? []) as ProfileRow[]).filter((row) => row.user_id)
  return <main><PageHeader title="Add availability" subtitle="Create a new private coaching slot in a dedicated workspace." /><Section className="space-y-5"><PrivateCoachingAdminSubnav /><Card><CardHeader><CardTitle>New availability</CardTitle></CardHeader><CardContent><PrivateCoachingAddAvailabilityClient members={members.map((row) => ({ user_id: row.user_id, full_name: privateCoachingMemberName(row), meta: profileMeta(row) }))} coaches={coaches.map((row) => ({ user_id: row.user_id, full_name: privateCoachingMemberName(row), email: row.email }))} canChooseCoach={me.role === 'super_admin'} defaultCoachId={me.role === 'head_coach' ? me.id : coaches[0]?.user_id ?? ''} /></CardContent></Card></Section></main>
}
