export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminSubnav from '@/components/private-coaching/PrivateCoachingAdminSubnav'
import PrivateCoachingAdminClient from '@/components/private-coaching/PrivateCoachingAdminClient'
import PrivateCoachingSessionRequestsClient from '@/components/private-coaching/PrivateCoachingSessionRequestsClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { privateCoachingMemberName } from '@/lib/privateCoaching'

type RequestRow = { id: string; member_id: string; coach_id: string; package_sessions: number; amount_cents: number; original_amount_cents: number | null; discount_code: string | null; discount_label: string | null; discount_percent: number | null; discount_amount_cents: number | null; payment_method: string; status: string; created_at: string; confirmed_at: string | null; archived_at: string | null; archive_reason: string | null }
type PassRow = { id: string; request_id: string | null; member_id: string; coach_id: string; total_sessions: number; used_sessions: number; remaining_sessions: number; status: string }
type BookingRow = { member_id: string; coach_id: string; status: string }
type ProfileRow = { user_id: string; member_id: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }
function profileMeta(profile?: ProfileRow | null) { if (!profile) return 'No profile details'; return [profile.member_id ? `ID ${profile.member_id}` : '', profile.email ?? '', profile.phone ?? ''].filter(Boolean).join(' · ') || 'No profile details' }

export default async function PrivateCoachingRequestsPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/head-coach/private-coaching/requests')
  if (me.role !== 'head_coach' && me.role !== 'super_admin') return <AccessDeniedPage title="Private coaching requests" subtitle="Access restricted." signedInAs={me.email} message="Only Head Coach and Super Admin can manage private coaching." allowed="head_coach, super_admin" nextPath="/head-coach/private-coaching/requests" actions={[{ href: '/', label: 'Go Home' }]} showBackHome />
  const admin = getSupabaseAdminClientCached()
  let requestsQuery = admin.from('private_coaching_requests').select('id, member_id, coach_id, package_sessions, amount_cents, original_amount_cents, discount_code, discount_label, discount_percent, discount_amount_cents, payment_method, status, created_at, confirmed_at, archived_at, archive_reason').order('created_at', { ascending: false }).limit(150)
  let passesQuery = admin.from('private_coaching_passes').select('id, request_id, member_id, coach_id, total_sessions, used_sessions, remaining_sessions, status').in('status', ['active', 'depleted']).limit(1000)
  let bookingsQuery = admin.from('private_coaching_bookings').select('member_id, coach_id, status').eq('status', 'booked').limit(1000)
  if (me.role === 'head_coach') { requestsQuery = requestsQuery.eq('coach_id', me.id); passesQuery = passesQuery.eq('coach_id', me.id); bookingsQuery = bookingsQuery.eq('coach_id', me.id) }
  const [requestsRes, passesRes, bookingsRes] = await Promise.all([requestsQuery, passesQuery, bookingsQuery])
  const requests = (requestsRes.data ?? []) as RequestRow[]
  const passes = (passesRes.data ?? []) as PassRow[]
  const bookings = (bookingsRes.data ?? []) as BookingRow[]
  const profileIds = Array.from(new Set(requests.flatMap((row) => [row.member_id, row.coach_id])))
  const profilesById = new Map<string, ProfileRow>()
  if (profileIds.length) { const { data } = await admin.from('profiles').select('user_id, member_id, first_name, last_name, email, phone').in('user_id', profileIds); for (const row of (data ?? []) as ProfileRow[]) profilesById.set(row.user_id, row) }
  const passesByRequestId = new Map<string, PassRow>(); const fallbackPassesBySignature = new Map<string, PassRow>()
  for (const pass of passes) { if (pass.request_id) passesByRequestId.set(pass.request_id, pass); const signature = `${pass.member_id}||${pass.coach_id}||${Number(pass.total_sessions ?? 0)}`; const existing = fallbackPassesBySignature.get(signature); if (!existing || Number(pass.remaining_sessions ?? 0) > Number(existing.remaining_sessions ?? 0)) fallbackPassesBySignature.set(signature, pass) }
  const openBookingsBySignature = new Map<string, number>(); for (const booking of bookings) { const signature = `${booking.member_id}||${booking.coach_id}`; openBookingsBySignature.set(signature, (openBookingsBySignature.get(signature) ?? 0) + 1) }
  const rows = requests.map((row) => { const member = profilesById.get(row.member_id); const coach = profilesById.get(row.coach_id); const pass = passesByRequestId.get(row.id) ?? fallbackPassesBySignature.get(`${row.member_id}||${row.coach_id}||${Number(row.package_sessions ?? 0)}`) ?? null; return { id: row.id, memberName: privateCoachingMemberName(member ?? {}), memberMeta: profileMeta(member), coachName: privateCoachingMemberName(coach ?? {}), packageSessions: Number(row.package_sessions ?? 0), amountCents: Number(row.amount_cents ?? 0), originalAmountCents: row.original_amount_cents === null ? null : Number(row.original_amount_cents ?? 0), discountCode: row.discount_code, discountLabel: row.discount_label, discountPercent: row.discount_percent === null ? null : Number(row.discount_percent ?? 0), discountAmountCents: row.discount_amount_cents === null ? null : Number(row.discount_amount_cents ?? 0), paymentMethod: row.payment_method, status: row.status, createdAt: row.created_at, confirmedAt: row.confirmed_at, passTotalSessions: pass ? Number(pass.total_sessions ?? 0) : null, passUsedSessions: pass ? Number(pass.used_sessions ?? 0) : null, passRemainingSessions: pass ? Number(pass.remaining_sessions ?? 0) : null, passStatus: pass?.status ?? null, openBookingCount: openBookingsBySignature.get(`${row.member_id}||${row.coach_id}`) ?? 0, archivedAt: row.archived_at, archiveReason: row.archive_reason } })
  return <main><PageHeader title="Private coaching requests" subtitle="Package requests, payment follow-up and member session requests." /><Section className="space-y-5"><PrivateCoachingAdminSubnav /><Card><CardHeader><CardTitle>Package & payment requests</CardTitle></CardHeader><CardContent><PrivateCoachingAdminClient rows={rows} /></CardContent></Card><Card><CardHeader><CardTitle>Session requests</CardTitle></CardHeader><CardContent><PrivateCoachingSessionRequestsClient mode="manager" /></CardContent></Card></Section></main>
}
