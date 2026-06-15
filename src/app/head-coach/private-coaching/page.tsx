export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminClient from '@/components/private-coaching/PrivateCoachingAdminClient'
import PrivateCoachingSlotsClient from '@/components/private-coaching/PrivateCoachingSlotsClient'
import PrivateCoachingBookingsClient from '@/components/private-coaching/PrivateCoachingBookingsClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  PRIVATE_COACHING_PROMO_CODE,
  PRIVATE_COACHING_PROMO_PERCENT,
  formatPrivateCoachingMoney,
  privateCoachingMemberName,
} from '@/lib/privateCoaching'

type RequestRow = {
  id: string
  member_id: string
  coach_id: string
  package_sessions: number
  amount_cents: number
  original_amount_cents: number | null
  discount_code: string | null
  discount_percent: number | null
  discount_amount_cents: number | null
  payment_method: string
  status: string
  created_at: string
  confirmed_at: string | null
}

type ProfileRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

type PassRow = {
  id: string
  member_id: string
  coach_id: string
  total_sessions: number
  used_sessions: number
  remaining_sessions: number
  status: string
}

type CoachRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
}

type SlotRow = {
  id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  status: string
  note: string | null
  created_at: string
}

type BookingRow = {
  id: string
  member_id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  status: string
  note: string | null
  booked_at: string
  completed_at: string | null
  cancelled_at: string | null
}

function profileMeta(profile: ProfileRow | undefined | null) {
  if (!profile) return 'No profile details'
  return [profile.member_id ? `ID ${profile.member_id}` : '', profile.email ?? '', profile.phone ?? '']
    .filter(Boolean)
    .join(' · ') || 'No profile details'
}

export default async function HeadCoachPrivateCoachingPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/head-coach/private-coaching')

  const canManage = me.role === 'head_coach' || me.role === 'super_admin'
  if (!canManage) {
    return (
      <AccessDeniedPage
        title="Private coaching"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Head Coach and Super Admin can manage private coaching requests."
        allowed="head_coach, super_admin"
        nextPath="/head-coach/private-coaching"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()

  let requestsQuery = admin
    .from('private_coaching_requests')
    .select('id, member_id, coach_id, package_sessions, amount_cents, original_amount_cents, discount_code, discount_percent, discount_amount_cents, payment_method, status, created_at, confirmed_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (me.role === 'head_coach') requestsQuery = requestsQuery.eq('coach_id', me.id)

  let slotsQuery = admin
    .from('private_coaching_slots')
    .select('id, coach_id, slot_date, start_time, end_time, status, note, created_at')
    .gte('slot_date', new Date().toISOString().slice(0, 10))
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(100)

  if (me.role === 'head_coach') slotsQuery = slotsQuery.eq('coach_id', me.id)

  let bookingsQuery = admin
    .from('private_coaching_bookings')
    .select('id, member_id, coach_id, slot_date, start_time, end_time, status, note, booked_at, completed_at, cancelled_at')
    .order('slot_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(100)

  if (me.role === 'head_coach') bookingsQuery = bookingsQuery.eq('coach_id', me.id)

  const [requestsRes, passesRes, coachesRes, slotsRes, bookingsRes] = await Promise.all([
    requestsQuery,
    admin
      .from('private_coaching_passes')
      .select('id, member_id, coach_id, total_sessions, used_sessions, remaining_sessions, status')
      .in('status', ['active', 'depleted'])
      .limit(1000),
    admin
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .eq('role', 'head_coach')
      .not('user_id', 'is', null)
      .order('first_name', { ascending: true }),
    slotsQuery,
    bookingsQuery,
  ])

  const requests = (requestsRes.data ?? []) as RequestRow[]
  const passes = (passesRes.data ?? []) as PassRow[]
  const coaches = ((coachesRes.data ?? []) as CoachRow[]).filter((coach) => coach.user_id)
  const slots = (slotsRes.data ?? []) as SlotRow[]
  const bookings = (bookingsRes.data ?? []) as BookingRow[]
  const profileIds = Array.from(new Set([
    ...requests.flatMap((row) => [row.member_id, row.coach_id]),
    ...bookings.flatMap((row) => [row.member_id, row.coach_id]),
  ].filter(Boolean)))
  const profilesById = new Map<string, ProfileRow>()

  if (profileIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, member_id, first_name, last_name, email, phone')
      .in('user_id', profileIds)
      .limit(1000)

    for (const profile of (profiles ?? []) as ProfileRow[]) {
      profilesById.set(profile.user_id, profile)
    }
  }

  const pendingCount = requests.filter((row) => row.status === 'payment_pending').length
  const activeCount = requests.filter((row) => row.status === 'active').length
  const pendingValueCents = requests
    .filter((row) => row.status === 'payment_pending')
    .reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0)
  const activeTokens = passes
    .filter((row) => row.status === 'active')
    .reduce((sum, row) => sum + Math.max(0, Number(row.remaining_sessions ?? 0)), 0)
  const availableSlotsCount = slots.filter((row) => row.status === 'available').length
  const bookedCount = bookings.filter((row) => row.status === 'booked').length

  const coachMap = new Map(coaches.map((coach) => [coach.user_id, coach]))
  const coachOptions = coaches.map((coach) => ({
    user_id: coach.user_id,
    full_name: privateCoachingMemberName(coach),
    email: coach.email,
  }))

  const slotRows = slots.map((row) => ({
    id: row.id,
    coachId: row.coach_id,
    coachName: privateCoachingMemberName(coachMap.get(row.coach_id) ?? {}),
    slotDate: row.slot_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
  }))

  const bookingRows = bookings.map((row) => {
    const member = profilesById.get(row.member_id)
    const coach = profilesById.get(row.coach_id)
    return {
      id: row.id,
      memberName: privateCoachingMemberName(member ?? {}),
      memberMeta: profileMeta(member),
      coachName: privateCoachingMemberName(coach ?? coachMap.get(row.coach_id) ?? {}),
      slotDate: row.slot_date,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      note: row.note,
      bookedAt: row.booked_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
    }
  })

  const clientRows = requests.map((row) => {
    const member = profilesById.get(row.member_id)
    const coach = profilesById.get(row.coach_id)
    return {
      id: row.id,
      memberName: privateCoachingMemberName(member ?? {}),
      memberMeta: profileMeta(member),
      coachName: privateCoachingMemberName(coach ?? {}),
      packageSessions: Number(row.package_sessions ?? 0),
      amountCents: Number(row.amount_cents ?? 0),
      originalAmountCents: row.original_amount_cents === null ? null : Number(row.original_amount_cents ?? 0),
      discountCode: row.discount_code,
      discountPercent: row.discount_percent === null ? null : Number(row.discount_percent ?? 0),
      discountAmountCents: row.discount_amount_cents === null ? null : Number(row.discount_amount_cents ?? 0),
      paymentMethod: row.payment_method,
      status: row.status,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    }
  })

  return (
    <main>
      <PageHeader
        title="Private coaching"
        subtitle="Confirm payments, manage availability and follow bookings."
        right={
          <Button asChild variant="outline" href="/private-coaching">
            Member view
          </Button>
        }
      />

      <Section className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Pending requests</div>
              <div className="mt-1 text-2xl font-semibold">{pendingCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Pending value</div>
              <div className="mt-1 text-2xl font-semibold">{formatPrivateCoachingMoney(pendingValueCents)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Confirmed requests</div>
              <div className="mt-1 text-2xl font-semibold">{activeCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Active tokens</div>
              <div className="mt-1 text-2xl font-semibold">{activeTokens}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Available slots</div>
              <div className="mt-1 text-2xl font-semibold">{availableSlotsCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Booked slots</div>
              <div className="mt-1 text-2xl font-semibold">{bookedCount}</div>
            </CardContent>
          </Card>
        </div>



        <Card>
          <CardHeader>
            <CardTitle>Private coaching promo code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <div className="text-xs font-semibold uppercase tracking-wide">Share with selected members</div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">{PRIVATE_COACHING_PROMO_CODE}</div>
              <p className="mt-2">This code gives {PRIVATE_COACHING_PROMO_PERCENT}% off private coaching packages. It changes only the amount to pay; sessions/tokens stay unchanged.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Private coaching bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <PrivateCoachingBookingsClient rows={bookingRows} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coach availability slots</CardTitle>
          </CardHeader>
          <CardContent>
            <PrivateCoachingSlotsClient
              rows={slotRows}
              coaches={coachOptions}
              canChooseCoach={me.role === 'super_admin'}
              defaultCoachId={me.role === 'head_coach' ? me.id : coachOptions[0]?.user_id ?? ''}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Private coaching requests</CardTitle>
          </CardHeader>
          <CardContent>
            <PrivateCoachingAdminClient rows={clientRows} />
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
