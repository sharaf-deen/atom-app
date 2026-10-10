export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingRequestForm from '@/components/private-coaching/PrivateCoachingRequestForm'
import PrivateCoachingBookingClient from '@/components/private-coaching/PrivateCoachingBookingClient'
import PrivateCoachingMemberSessionHistory from '@/components/private-coaching/PrivateCoachingMemberSessionHistory'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  PRIVATE_COACHING_ALLOWED_MEMBER_ROLES,
  formatPrivateCoachingMoney,
  privateCoachingMemberName,
  privateCoachingPaymentMethodLabel,
  privateCoachingPromoSummary,
  privateCoachingStatusLabel,
} from '@/lib/privateCoaching'

type CoachRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
}

type RequestRow = {
  id: string
  coach_id: string
  package_sessions: number
  amount_cents: number
  original_amount_cents: number | null
  discount_code: string | null
  discount_label: string | null
  discount_percent: number | null
  discount_amount_cents: number | null
  payment_method: string
  status: string
  created_at: string
  confirmed_at: string | null
}

type PassRow = {
  id: string
  coach_id: string
  total_sessions: number
  used_sessions: number
  remaining_sessions: number
  status: string
  activated_at: string
}

type SlotRow = {
  id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  status: string
  note: string | null
  is_backdated: boolean | null
  assigned_member_id: string | null
  backdated_reason: string | null
}

type BookingRow = {
  id: string
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

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function coachName(coach: CoachRow | undefined | null) {
  if (!coach) return 'Head Coach'
  return privateCoachingMemberName(coach)
}

export default async function PrivateCoachingPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/private-coaching')

  const canRequest = (PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(me.role)
  if (!canRequest) {
    return (
      <AccessDeniedPage
        title="Private coaching"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Private coaching requests are currently available for members, champions and VIPs."
        allowed="member, champion, vip"
        nextPath="/private-coaching"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()

  const [coachesRes, requestsRes, passesRes, bookingsRes] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .eq('role', 'head_coach')
      .not('user_id', 'is', null)
      .order('first_name', { ascending: true }),
    admin
      .from('private_coaching_requests')
      .select('id, coach_id, package_sessions, amount_cents, original_amount_cents, discount_code, discount_label, discount_percent, discount_amount_cents, payment_method, status, created_at, confirmed_at')
      .eq('member_id', me.id)
      .order('created_at', { ascending: false })
      .limit(10),
    admin
      .from('private_coaching_passes')
      .select('id, coach_id, total_sessions, used_sessions, remaining_sessions, status, activated_at')
      .eq('member_id', me.id)
      .in('status', ['active', 'depleted'])
      .order('created_at', { ascending: false })
      .limit(10),
    admin
      .from('private_coaching_bookings')
      .select('id, coach_id, slot_date, start_time, end_time, status, note, booked_at, completed_at, cancelled_at')
      .eq('member_id', me.id)
      .order('slot_date', { ascending: false })
      .order('start_time', { ascending: false })
      .limit(20),
  ])

  const coaches = ((coachesRes.data ?? []) as CoachRow[])
    .filter((coach) => coach.user_id)
    .map((coach) => ({
      user_id: coach.user_id,
      full_name: coachName(coach),
      email: coach.email,
    }))

  const coachMap = new Map(((coachesRes.data ?? []) as CoachRow[]).map((coach) => [coach.user_id, coach]))
  const requests = (requestsRes.data ?? []) as RequestRow[]
  const passes = (passesRes.data ?? []) as PassRow[]
  const activePasses = passes.filter((pass) => pass.status === 'active')
  const bookings = (bookingsRes.data ?? []) as BookingRow[]
  const pendingRequest = requests.find((request) => request.status === 'payment_pending') ?? null
  const latestRequest = requests[0] ?? null
  const totalRemaining = activePasses.reduce((sum, pass) => sum + Math.max(0, Number(pass.remaining_sessions ?? 0)), 0)
  const bookedUpcoming = bookings
    .filter((booking) => booking.status === 'booked')
    .sort((a, b) => {
      const dateCompare = String(a.slot_date || '').localeCompare(String(b.slot_date || ''))
      return dateCompare !== 0 ? dateCompare : String(a.start_time || '').localeCompare(String(b.start_time || ''))
    })
  const nextBooking = bookedUpcoming[0] ?? null

  let availableSlots: SlotRow[] = []
  if (totalRemaining > 0) {
    const coachIds = Array.from(new Set(activePasses.map((pass) => pass.coach_id).filter(Boolean)))
    if (coachIds.length > 0) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: slots } = await admin
        .from('private_coaching_slots')
        .select('id, coach_id, slot_date, start_time, end_time, status, note, is_backdated, assigned_member_id, backdated_reason')
        .in('coach_id', coachIds)
        .eq('status', 'available')
        .or(`slot_date.gte.${today},and(is_backdated.eq.true,assigned_member_id.eq.${me.id})`)
        .order('slot_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(20)

      availableSlots = (slots ?? []) as SlotRow[]
    }
  }

  const availableSlotRows = availableSlots.map((slot) => ({
    id: slot.id,
    coachId: slot.coach_id,
    coachName: coachName(coachMap.get(slot.coach_id)),
    slotDate: slot.slot_date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    note: slot.note,
    isBackdated: Boolean(slot.is_backdated),
    assignedMemberId: slot.assigned_member_id,
    backdatedReason: slot.backdated_reason,
  }))

  const bookingRows = bookings.map((booking) => ({
    id: booking.id,
    coachId: booking.coach_id,
    coachName: coachName(coachMap.get(booking.coach_id)),
    slotDate: booking.slot_date,
    startTime: booking.start_time,
    endTime: booking.end_time,
    status: booking.status,
    note: booking.note,
    bookedAt: booking.booked_at,
    completedAt: booking.completed_at,
    cancelledAt: booking.cancelled_at,
  }))

  return (
    <main>
      <PageHeader
        title="Private coaching"
        subtitle="Your sessions, bookings and private coaching requests."
      />

      <Section className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-[hsl(var(--muted))]">Sessions available</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">{totalRemaining}</div>
              <div className="mt-2 text-xs text-[hsl(var(--muted))]">1 booking uses 1 session.</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-[hsl(var(--muted))]">Request status</div>
              <div className="mt-1 text-lg font-semibold">
                {latestRequest ? privateCoachingStatusLabel(latestRequest.status) : 'No request'}
              </div>
              <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                {pendingRequest ? 'Waiting for payment confirmation.' : latestRequest ? `Last request · ${latestRequest.package_sessions} session(s)` : 'Create a request when you need private sessions.'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-[hsl(var(--muted))]">Next booking</div>
              <div className="mt-1 text-lg font-semibold">
                {nextBooking ? formatDate(nextBooking.slot_date) : 'None booked'}
              </div>
              <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                {nextBooking
                  ? `${coachName(coachMap.get(nextBooking.coach_id))} · ${nextBooking.start_time.slice(0, 5)}`
                  : totalRemaining > 0
                    ? 'Choose an available slot below.'
                    : 'Sessions unlock after payment confirmation.'}
              </div>
            </CardContent>
          </Card>
        </div>

        {pendingRequest ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-soft">
            <div className="font-semibold">Payment confirmation pending</div>
            <div className="mt-1">
              Your latest request is waiting for confirmation. New sessions will appear automatically after payment is confirmed.
            </div>
          </div>
        ) : null}

        {totalRemaining > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Book your next session</CardTitle>
            </CardHeader>
            <CardContent>
              <PrivateCoachingBookingClient
                totalRemaining={totalRemaining}
                availableSlots={availableSlotRows}
                bookings={bookingRows}
              />
            </CardContent>
          </Card>
        ) : null}

        {totalRemaining <= 0 && !pendingRequest ? (
          <Card>
            <CardHeader>
              <CardTitle>Request private coaching</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-[hsl(var(--muted))]">
                Choose a package and payment method. Sessions become available after payment confirmation.
              </p>
              <PrivateCoachingRequestForm coaches={coaches} hasPendingRequest={false} />
            </CardContent>
          </Card>
        ) : (
          <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{pendingRequest ? 'Request details' : 'Buy more private sessions'}</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {pendingRequest
                      ? 'Review the latest request and payment information.'
                      : 'Open this when you want to add another private coaching package.'}
                  </div>
                </div>
                <span className="text-sm font-medium text-[hsl(var(--muted))]">Show</span>
              </div>
            </summary>

            <div className="mt-4 space-y-4">
              {pendingRequest ? (
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                    <div className="text-xs text-[hsl(var(--muted))]">Package</div>
                    <div className="mt-1 font-semibold">{pendingRequest.package_sessions} session(s)</div>
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                    <div className="text-xs text-[hsl(var(--muted))]">Amount</div>
                    <div className="mt-1 font-semibold">{formatPrivateCoachingMoney(pendingRequest.amount_cents)}</div>
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                    <div className="text-xs text-[hsl(var(--muted))]">Payment</div>
                    <div className="mt-1 font-semibold">{privateCoachingPaymentMethodLabel(pendingRequest.payment_method)}</div>
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                    <div className="text-xs text-[hsl(var(--muted))]">Status</div>
                    <div className="mt-1 font-semibold">{privateCoachingStatusLabel(pendingRequest.status)}</div>
                  </div>
                </div>
              ) : (
                <PrivateCoachingRequestForm coaches={coaches} hasPendingRequest={false} />
              )}
            </div>
          </details>
        )}

        {totalRemaining <= 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              <PrivateCoachingBookingClient
                totalRemaining={totalRemaining}
                availableSlots={availableSlotRows}
                bookings={bookingRows}
              />
            </CardContent>
          </Card>
        ) : null}

        {passes.length ? (
          <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">Session packages</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">See active and depleted private coaching passes.</div>
                </div>
                <span className="text-sm font-medium text-[hsl(var(--muted))]">Show</span>
              </div>
            </summary>

            <div className="mt-4 space-y-2">
              {passes.map((pass) => (
                <div key={pass.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{pass.remaining_sessions}/{pass.total_sessions} session(s) left</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                        Activated {formatDate(pass.activated_at)} · {coachName(coachMap.get(pass.coach_id))}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pass.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                      {pass.status === 'active' ? 'Active' : 'Used'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Technical session history</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">Review techniques, situations and coach notes from your private sessions.</div>
              </div>
              <span className="text-sm font-medium text-[hsl(var(--muted))]">Show</span>
            </div>
          </summary>

          <div className="mt-4">
            <PrivateCoachingMemberSessionHistory />
          </div>
        </details>
      </Section>
    </main>
  )
}
