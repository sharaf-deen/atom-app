export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminSubnav from '@/components/private-coaching/PrivateCoachingAdminSubnav'
import PrivateCoachingBookingsClient from '@/components/private-coaching/PrivateCoachingBookingsClient'
import PrivateCoachingSessionContentClient from '@/components/private-coaching/PrivateCoachingSessionContentClient'
import PrivateCoachingQuickBookClient from '@/components/private-coaching/PrivateCoachingQuickBookClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { PRIVATE_COACHING_ALLOWED_MEMBER_ROLES, privateCoachingMemberName } from '@/lib/privateCoaching'

type ProfileRow = { user_id: string; member_id: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }
type BookingRow = { id: string; member_id: string; coach_id: string; slot_date: string; start_time: string; end_time: string; status: string; note: string | null; booked_at: string; completed_at: string | null; cancelled_at: string | null; archived_at: string | null; archive_reason: string | null }
function profileMeta(profile?: ProfileRow | null) { if (!profile) return 'No profile details'; return [profile.member_id ? `ID ${profile.member_id}` : '', profile.email ?? '', profile.phone ?? ''].filter(Boolean).join(' · ') || 'No profile details' }

export default async function PrivateCoachingBookingsPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/head-coach/private-coaching/bookings')
  if (me.role !== 'head_coach' && me.role !== 'super_admin') return <AccessDeniedPage title="Private coaching bookings" subtitle="Access restricted." signedInAs={me.email} message="Only Head Coach and Super Admin can manage private coaching." allowed="head_coach, super_admin" nextPath="/head-coach/private-coaching/bookings" actions={[{ href: '/', label: 'Go Home' }]} showBackHome />
  const admin = getSupabaseAdminClientCached()
  let bookingsQuery = admin.from('private_coaching_bookings').select('id, member_id, coach_id, slot_date, start_time, end_time, status, note, booked_at, completed_at, cancelled_at, archived_at, archive_reason').order('slot_date', { ascending: false }).order('start_time', { ascending: false }).limit(150)
  if (me.role === 'head_coach') bookingsQuery = bookingsQuery.eq('coach_id', me.id)
  const [bookingsRes, coachesRes, membersRes] = await Promise.all([
    bookingsQuery,
    admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').eq('role', 'head_coach').not('user_id', 'is', null),
    admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').in('role', [...PRIVATE_COACHING_ALLOWED_MEMBER_ROLES]).not('user_id', 'is', null).order('first_name', { ascending: true }).limit(1000),
  ])
  const bookings = (bookingsRes.data ?? []) as BookingRow[]
  const coaches = ((coachesRes.data ?? []) as ProfileRow[]).filter((row) => row.user_id)
  const members = ((membersRes.data ?? []) as ProfileRow[]).filter((row) => row.user_id)
  const profileIds = Array.from(new Set(bookings.flatMap((row) => [row.member_id, row.coach_id])))
  const profilesById = new Map<string, ProfileRow>()
  if (profileIds.length) { const { data } = await admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').in('user_id', profileIds); for (const row of (data ?? []) as ProfileRow[]) profilesById.set(row.user_id, row) }
  const bookingRows = bookings.map((row) => ({ id: row.id, memberName: privateCoachingMemberName(profilesById.get(row.member_id) ?? {}), memberMeta: profileMeta(profilesById.get(row.member_id)), coachName: privateCoachingMemberName(profilesById.get(row.coach_id) ?? {}), slotDate: row.slot_date, startTime: row.start_time, endTime: row.end_time, status: row.status, note: row.note, bookedAt: row.booked_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at, archivedAt: row.archived_at, archiveReason: row.archive_reason }))
  const coachOptions = coaches.map((row) => ({ user_id: row.user_id, full_name: privateCoachingMemberName(row), email: row.email }))
  const memberOptions = members.map((row) => ({ user_id: row.user_id, full_name: privateCoachingMemberName(row), meta: profileMeta(row) }))
  return <main><PageHeader title="Private coaching bookings" subtitle="Bookings, direct booking and technical session follow-up." /><Section className="space-y-5"><PrivateCoachingAdminSubnav /><Card><CardHeader><CardTitle>Quick book session</CardTitle></CardHeader><CardContent><PrivateCoachingQuickBookClient members={memberOptions} coaches={coachOptions} canChooseCoach={me.role === 'super_admin'} defaultCoachId={me.role === 'head_coach' ? me.id : coachOptions[0]?.user_id ?? ''} /></CardContent></Card><Card><CardHeader><CardTitle>Bookings</CardTitle></CardHeader><CardContent><PrivateCoachingBookingsClient rows={bookingRows} /></CardContent></Card><Card><CardHeader><CardTitle>Session technical content</CardTitle></CardHeader><CardContent><PrivateCoachingSessionContentClient rows={bookingRows} /></CardContent></Card></Section></main>
}
