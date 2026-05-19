'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import {
  formatPrivateCoachingSlotTime,
  privateCoachingBookingStatusLabel,
} from '@/lib/privateCoaching'

type BookingRow = {
  id: string
  memberName: string
  memberMeta: string
  coachName: string
  slotDate: string
  startTime: string
  endTime: string
  status: string
  note: string | null
  bookedAt: string
  cancelledAt: string | null
}

type Props = {
  rows: BookingRow[]
}

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

function statusClass(status: string) {
  if (status === 'booked') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'completed') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function PrivateCoachingBookingsClient({ rows }: Props) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState('')
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  async function cancelBooking(id: string) {
    const ok = window.confirm('Cancel this private coaching booking? The member token will be returned.')
    if (!ok) return

    setBusyId(id)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not cancel booking.' })
        return
      }
      setStatus({ kind: 'success', message: 'Booking cancelled. The member token has been returned.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not cancel booking.' })
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No private coaching booking yet.
        </div>
      ) : null}

      <div className="grid gap-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(row.status)}`}>
                    {privateCoachingBookingStatusLabel(row.status)}
                  </span>
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--muted))]">
                    {row.coachName}
                  </span>
                </div>

                <div className="mt-3 text-base font-semibold tracking-tight">{row.memberName}</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.memberMeta}</div>

                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Slot</div>
                    <div className="font-semibold">
                      {formatSlotDate(row.slotDate)} · {formatPrivateCoachingSlotTime(row.startTime)} - {formatPrivateCoachingSlotTime(row.endTime)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Booked</div>
                    <div className="font-semibold">{formatDateTime(row.bookedAt)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Note</div>
                    <div className="font-semibold">{row.note || '—'}</div>
                  </div>
                </div>
              </div>

              {row.status === 'booked' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cancelBooking(row.id)}
                  disabled={Boolean(busyId)}
                  loading={busyId === row.id}
                  loadingText="Cancelling…"
                  className="w-full lg:w-auto"
                >
                  Cancel booking
                </Button>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  {row.cancelledAt ? `Cancelled ${formatDateTime(row.cancelledAt)}` : privateCoachingBookingStatusLabel(row.status)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
