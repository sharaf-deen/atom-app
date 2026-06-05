'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import {
  formatPrivateCoachingSlotTime,
  privateCoachingBookingStatusLabel,
} from '@/lib/privateCoaching'

type AvailableSlotRow = {
  id: string
  coachId: string
  coachName: string
  slotDate: string
  startTime: string
  endTime: string
  note: string | null
}

type BookingRow = {
  id: string
  coachId: string
  coachName: string
  slotDate: string
  startTime: string
  endTime: string
  status: string
  note: string | null
  bookedAt: string
  completedAt: string | null
  cancelledAt: string | null
}

type Props = {
  totalRemaining: number
  availableSlots: AvailableSlotRow[]
  bookings: BookingRow[]
}

const BOOKING_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'booked', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

function formatSlotDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function bookingStatusClass(status: string) {
  if (status === 'booked') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'completed') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function slotTimeLabel(startTime: string, endTime: string) {
  return `${formatPrivateCoachingSlotTime(startTime)} - ${formatPrivateCoachingSlotTime(endTime)}`
}

function bookSlotSummaryItems(slot: AvailableSlotRow | null, totalRemaining: number): ConfirmActionSummaryItem[] {
  if (!slot) return []

  return [
    { label: 'Coach', value: slot.coachName },
    { label: 'Date', value: formatSlotDate(slot.slotDate) },
    { label: 'Time', value: slotTimeLabel(slot.startTime, slot.endTime) },
    { label: 'Note', value: slot.note || '—' },
    { label: 'Current tokens', value: totalRemaining },
    { label: 'Token impact', value: '1 token will be used' },
    { label: 'Remaining after booking', value: Math.max(totalRemaining - 1, 0) },
    { label: 'Booking status', value: 'Booked' },
  ]
}

export default function PrivateCoachingBookingClient({ totalRemaining, availableSlots, bookings }: Props) {
  const router = useRouter()
  const [busySlotId, setBusySlotId] = React.useState('')
  const [confirmBookSlot, setConfirmBookSlot] = React.useState<AvailableSlotRow | null>(null)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })
  const [bookingFilter, setBookingFilter] = React.useState<(typeof BOOKING_FILTERS)[number]['value']>('all')

  const filteredBookings = React.useMemo(() => {
    if (bookingFilter === 'all') return bookings
    return bookings.filter((booking) => booking.status === bookingFilter)
  }, [bookingFilter, bookings])

  async function bookSlot(slot: AvailableSlotRow) {
    setBusySlotId(slot.id)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/slots/${encodeURIComponent(slot.id)}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not book this slot.' })
        return
      }
      setConfirmBookSlot(null)
      setStatus({ kind: 'success', message: 'Private coaching slot booked. One token has been used.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not book this slot.' })
    } finally {
      setBusySlotId('')
    }
  }

  return (
    <div className="space-y-6">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
        <div className="text-sm text-[hsl(var(--muted))]">Available tokens</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight">{totalRemaining}</div>
        <p className="mt-2 text-sm text-[hsl(var(--muted))]">
          Choose an available coach slot. Booking one slot uses one private coaching token.
        </p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-base font-semibold tracking-tight">Available slots</h4>
          <span className="rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">
            {availableSlots.length} slot(s)
          </span>
        </div>

        {totalRemaining <= 0 ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))]">
            Available coach slots will appear here after your private coaching payment is confirmed and your tokens are active.
          </div>
        ) : availableSlots.length ? (
          <div className="grid gap-3">
            {availableSlots.map((slot) => (
              <div key={slot.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold tracking-tight">
                      {formatSlotDate(slot.slotDate)} · {formatPrivateCoachingSlotTime(slot.startTime)} - {formatPrivateCoachingSlotTime(slot.endTime)}
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {slot.coachName}{slot.note ? ` · ${slot.note}` : ''}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setConfirmBookSlot(slot)}
                    loading={busySlotId === slot.id}
                    loadingText="Booking…"
                    disabled={Boolean(busySlotId)}
                    className="w-full sm:w-auto"
                  >
                    Book slot
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))]">
            No available slot yet. The head coach will add private coaching availability soon.
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-base font-semibold tracking-tight">Your bookings</h4>
            <p className="text-sm text-[hsl(var(--muted))]">Upcoming sessions and private coaching history.</p>
          </div>
          <span className="rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">
            {bookings.length} booking(s)
          </span>
        </div>

        {bookings.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {BOOKING_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setBookingFilter(item.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                  bookingFilter === item.value
                    ? 'border-black bg-black text-white'
                    : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {bookings.length > 0 && filteredBookings.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))]">
            No booking matches this filter.
          </div>
        ) : bookings.length ? (
          <div className="grid gap-3">
            {filteredBookings.map((booking) => (
              <div key={booking.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${bookingStatusClass(booking.status)}`}>
                      {privateCoachingBookingStatusLabel(booking.status)}
                    </span>
                    <div className="mt-3 font-semibold tracking-tight">
                      {formatSlotDate(booking.slotDate)} · {formatPrivateCoachingSlotTime(booking.startTime)} - {formatPrivateCoachingSlotTime(booking.endTime)}
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {booking.coachName}{booking.note ? ` · ${booking.note}` : ''}
                    </div>
                  </div>
                  <div className="text-left text-xs text-[hsl(var(--muted))] sm:text-right">
                    Booked {formatDateTime(booking.bookedAt)}
                    {booking.completedAt ? <><br />Completed {formatDateTime(booking.completedAt)}</> : null}
                    {booking.cancelledAt ? <><br />Cancelled {formatDateTime(booking.cancelledAt)}</> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))]">
            No private coaching booking yet.
          </div>
        )}
      </div>

      <ConfirmActionModal
        open={Boolean(confirmBookSlot)}
        title="Confirm private coaching booking"
        description="Please review the slot before booking it."
        confirmLabel="Confirm booking"
        pendingLabel="Booking…"
        pending={Boolean(confirmBookSlot && busySlotId === confirmBookSlot.id)}
        summaryItems={bookSlotSummaryItems(confirmBookSlot, totalRemaining)}
        warning="This booking will use 1 private coaching token."
        onCancel={() => {
          if (!busySlotId) setConfirmBookSlot(null)
        }}
        onConfirm={() => {
          if (confirmBookSlot) return bookSlot(confirmBookSlot)
        }}
      />
    </div>
  )
}
