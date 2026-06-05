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
  completedAt: string | null
  cancelledAt: string | null
}

type Props = {
  rows: BookingRow[]
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'booked', label: 'Booked' },
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

function statusClass(status: string) {
  if (status === 'booked') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'completed') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function statusCount(rows: BookingRow[], status: string) {
  return rows.filter((row) => row.status === status).length
}

function slotTimeLabel(startTime: string, endTime: string) {
  return `${formatPrivateCoachingSlotTime(startTime)} - ${formatPrivateCoachingSlotTime(endTime)}`
}

function actionSummaryItems(row: BookingRow | null, action: 'complete' | 'cancel' | ''): ConfirmActionSummaryItem[] {
  if (!row || !action) return []

  return [
    { label: 'Member', value: row.memberName },
    { label: 'Member info', value: row.memberMeta || '—' },
    { label: 'Coach', value: row.coachName },
    { label: 'Date', value: formatSlotDate(row.slotDate) },
    { label: 'Time', value: slotTimeLabel(row.startTime, row.endTime) },
    { label: 'Current status', value: privateCoachingBookingStatusLabel(row.status) },
    { label: 'Booked', value: formatDateTime(row.bookedAt) },
    { label: 'Note', value: row.note || '—' },
    {
      label: 'Token impact',
      value: action === 'complete' ? 'Token stays consumed' : '1 token will be returned to the member',
    },
    {
      label: 'Booking impact',
      value: action === 'complete' ? 'Booking will be marked completed' : 'Booking will be cancelled',
    },
  ]
}

export default function PrivateCoachingBookingsClient({ rows }: Props) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState('')
  const [busyAction, setBusyAction] = React.useState<'complete' | 'cancel' | ''>('')
  const [confirmRow, setConfirmRow] = React.useState<BookingRow | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<'complete' | 'cancel' | ''>('')
  const [filter, setFilter] = React.useState<(typeof STATUS_FILTERS)[number]['value']>('all')
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const filteredRows = React.useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((row) => row.status === filter)
  }, [filter, rows])

  function openConfirm(row: BookingRow, action: 'complete' | 'cancel') {
    setStatus({ kind: '', message: '' })
    setConfirmRow(row)
    setConfirmAction(action)
  }

  function closeConfirm() {
    if (busyId) return
    setConfirmRow(null)
    setConfirmAction('')
  }

  async function completeBooking(row: BookingRow) {
    setBusyId(row.id)
    setBusyAction('complete')
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(row.id)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not mark booking as completed.' })
        return
      }
      setConfirmRow(null)
      setConfirmAction('')
      setStatus({ kind: 'success', message: 'Session marked as completed.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not mark booking as completed.' })
    } finally {
      setBusyId('')
      setBusyAction('')
    }
  }

  async function cancelBooking(row: BookingRow) {
    setBusyId(row.id)
    setBusyAction('cancel')
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(row.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not cancel booking.' })
        return
      }
      setConfirmRow(null)
      setConfirmAction('')
      setStatus({ kind: 'success', message: 'Booking cancelled. The member token has been returned.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not cancel booking.' })
    } finally {
      setBusyId('')
      setBusyAction('')
    }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="text-sm text-[hsl(var(--muted))]">Booked</div>
          <div className="mt-1 text-2xl font-semibold">{statusCount(rows, 'booked')}</div>
        </div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="text-sm text-[hsl(var(--muted))]">Completed</div>
          <div className="mt-1 text-2xl font-semibold">{statusCount(rows, 'completed')}</div>
        </div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="text-sm text-[hsl(var(--muted))]">Cancelled</div>
          <div className="mt-1 text-2xl font-semibold">{statusCount(rows, 'cancelled')}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
              filter === item.value
                ? 'border-black bg-black text-white'
                : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No private coaching booking yet.
        </div>
      ) : null}

      {rows.length > 0 && filteredRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No booking matches this filter.
        </div>
      ) : null}

      <div className="grid gap-3">
        {filteredRows.map((row) => (
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

                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Completed</div>
                    <div className="font-semibold">{row.completedAt ? formatDateTime(row.completedAt) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Note</div>
                    <div className="font-semibold">{row.note || '—'}</div>
                  </div>
                </div>
              </div>

              {row.status === 'booked' ? (
                <div className="flex w-full flex-col gap-2 lg:w-auto">
                  <Button
                    type="button"
                    onClick={() => openConfirm(row, 'complete')}
                    disabled={Boolean(busyId)}
                    loading={busyId === row.id && busyAction === 'complete'}
                    loadingText="Saving…"
                    className="w-full lg:w-auto"
                  >
                    Mark completed
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openConfirm(row, 'cancel')}
                    disabled={Boolean(busyId)}
                    loading={busyId === row.id && busyAction === 'cancel'}
                    loadingText="Cancelling…"
                    className="w-full lg:w-auto"
                  >
                    Cancel booking
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  {row.completedAt ? `Completed ${formatDateTime(row.completedAt)}` : row.cancelledAt ? `Cancelled ${formatDateTime(row.cancelledAt)}` : privateCoachingBookingStatusLabel(row.status)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmActionModal
        open={Boolean(confirmRow && confirmAction)}
        title={confirmAction === 'cancel' ? 'Cancel private coaching booking?' : 'Mark private coaching session completed?'}
        description={
          confirmAction === 'cancel'
            ? 'Please confirm before cancelling this private coaching booking.'
            : 'Please confirm that this private coaching session has been completed.'
        }
        confirmLabel={confirmAction === 'cancel' ? 'Confirm cancel' : 'Confirm completed'}
        pendingLabel={confirmAction === 'cancel' ? 'Cancelling…' : 'Saving…'}
        pending={Boolean(confirmRow && busyId === confirmRow.id)}
        tone={confirmAction === 'cancel' ? 'destructive' : 'default'}
        summaryItems={actionSummaryItems(confirmRow, confirmAction)}
        warning={
          confirmAction === 'cancel'
            ? 'Cancelling returns 1 private coaching token to the member.'
            : 'Completed sessions keep the token consumed and cannot be returned by this action.'
        }
        onCancel={closeConfirm}
        onConfirm={() => {
          if (!confirmRow) return undefined
          if (confirmAction === 'cancel') return cancelBooking(confirmRow)
          if (confirmAction === 'complete') return completeBooking(confirmRow)
          return undefined
        }}
      />
    </div>
  )
}
