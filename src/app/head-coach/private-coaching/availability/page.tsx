export const dynamic = 'force-dynamic'
export const revalidate = 0
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminSubnav from '@/components/private-coaching/PrivateCoachingAdminSubnav'
import PrivateCoachingAvailabilityListClient from '@/components/private-coaching/PrivateCoachingAvailabilityListClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { privateCoachingMemberName } from '@/lib/privateCoaching'
type SlotRow = { id: string; coach_id: string; slot_date: string; start_time: string; end_time: string; status: string; note: string | null; created_at: string; is_backdated: boolean | null; assigned_member_id: string | null; backdated_reason: string | null }
type ProfileRow = { user_id: string; member_id: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }
function profileMeta(profile?: ProfileRow | null) { if (!profile) return ''; return [profile.member_id ? `ID ${profile.member_id}` : '', profile.email ?? '', profile.phone ?? ''].filter(Boolean).join(' · ') }
export default async function Page() {
  const me = await getSessionUserCached(); if (!me) redirect('/login?next=/head-coach/private-coaching/availability')
  if (me.role !== 'head_coach' && me.role !== 'super_admin') return <AccessDeniedPage title="Coach availability slots" subtitle="Access restricted." signedInAs={me.email} message="Only Head Coach and Super Admin can manage private coaching." allowed="head_coach, super_admin" nextPath="/head-coach/private-coaching/availability" actions={[{ href: '/', label: 'Go Home' }]} showBackHome />
  const admin = getSupabaseAdminClientCached(); let query = admin.from('private_coaching_slots').select('id, coach_id, slot_date, start_time, end_time, status, note, created_at, is_backdated, assigned_member_id, backdated_reason').order('slot_date', { ascending: false }).order('start_time', { ascending: true }).limit(250); if (me.role === 'head_coach') query = query.eq('coach_id', me.id)
  const { data } = await query; const slots = (data ?? []) as SlotRow[]; const profileIds = Array.from(new Set(slots.flatMap((row) => [row.coach_id, row.assigned_member_id]).filter(Boolean))) as string[]; const profilesById = new Map<string, ProfileRow>()
  if (profileIds.length) { const { data: profiles } = await admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').in('user_id', profileIds); for (const profile of (profiles ?? []) as ProfileRow[]) profilesById.set(profile.user_id, profile) }
  const rows = slots.map((row) => ({ id: row.id, coachName: privateCoachingMemberName(profilesById.get(row.coach_id) ?? {}), slotDate: row.slot_date, startTime: row.start_time, endTime: row.end_time, status: row.status, note: row.note, createdAt: row.created_at, isBackdated: Boolean(row.is_backdated), assignedMemberName: row.assigned_member_id ? privateCoachingMemberName(profilesById.get(row.assigned_member_id) ?? {}) : null, assignedMemberMeta: row.assigned_member_id ? profileMeta(profilesById.get(row.assigned_member_id)) : null, backdatedReason: row.backdated_reason }))
  return <main><PageHeader title="Coach availability slots" subtitle="Review availability without mixing it with creation forms." /><Section className="space-y-5"><PrivateCoachingAdminSubnav /><Card><CardHeader><CardTitle>Availability</CardTitle></CardHeader><CardContent><PrivateCoachingAvailabilityListClient rows={rows} /></CardContent></Card></Section></main>
}
