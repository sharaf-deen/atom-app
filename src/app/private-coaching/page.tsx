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

  let availableSlots: SlotRow[] = []
  if (totalRemaining > 0) {
    const coachIds = Array.from(new Set(activePasses.map((pass) => pass.coach_id).filter(Boolean)))
    if (coachIds.length > 0) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: slots } = await admin
        .from('private_coaching_slots')
        .select('id, coach_id, slot_date, start_time, end_time, status, note')
        .in('coach_id', coachIds)
        .eq('status', 'available')
        .gte('slot_date', today)
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
        subtitle="Book private lessons with the head coach."
        right={
          <Button asChild variant="outline" href="/">
            Home
          </Button>
        }
      />

      <Section className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Book a private lesson</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-[hsl(var(--muted))]">
              Choose a private coaching package, pay by cash at reception or Instapay, then wait for payment confirmation. Your sessions become available as tokens after confirmation.
            </p>
            <PrivateCoachingRequestForm coaches={coaches} hasPendingRequest={Boolean(pendingRequest)} />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Your private sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-sm text-[hsl(var(--muted))]">Available tokens</div>
                <div className="mt-1 text-3xl font-semibold tracking-tight">{totalRemaining}</div>
                <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                  One booking uses one token. If the coach cancels a booking, the token is returned automatically.
                </p>
              </div>

              {passes.length ? (
                <div className="mt-4 space-y-2">
                  {passes.map((pass) => (
                    <div key={pass.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">{pass.remaining_sessions}/{pass.total_sessions} session(s) left</div>
                          <div className="text-xs text-[hsl(var(--muted))]">Activated {formatDate(pass.activated_at)} · {coachName(coachMap.get(pass.coach_id))}</div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pass.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                          {pass.status === 'active' ? 'Active' : 'Depleted'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest request</CardTitle>
            </CardHeader>
            <CardContent>
              {latestRequest ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2">
                    <span className="text-[hsl(var(--muted))]">Status</span>
                    <span className="font-semibold">{privateCoachingStatusLabel(latestRequest.status)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2">
                    <span className="text-[hsl(var(--muted))]">Package</span>
                    <span className="font-semibold">{latestRequest.package_sessions} session(s)</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2">
                    <span className="text-[hsl(var(--muted))]">Amount</span>
                    <span className="font-semibold">{formatPrivateCoachingMoney(latestRequest.amount_cents)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2">
                    <span className="text-[hsl(var(--muted))]">Payment</span>
                    <span className="font-semibold">{privateCoachingPaymentMethodLabel(latestRequest.payment_method)}</span>
                  </div>
                  {latestRequest.discount_amount_cents && Number(latestRequest.discount_amount_cents) > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2">
                        <span className="text-[hsl(var(--muted))]">Original amount</span>
                        <span className="font-semibold line-through">{formatPrivateCoachingMoney(latestRequest.original_amount_cents ?? latestRequest.amount_cents)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                        <span>Promo</span>
                        <span className="font-semibold">{privateCoachingPromoSummary(latestRequest.discount_code, latestRequest.discount_percent, latestRequest.discount_amount_cents, latestRequest.discount_label)}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))]">
                  No private coaching request yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Book a coach slot</CardTitle>
          </CardHeader>
          <CardContent>
            <PrivateCoachingBookingClient
              totalRemaining={totalRemaining}
              availableSlots={availableSlotRows}
              bookings={bookingRows}
            />
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
