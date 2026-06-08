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

const BOOKINGS_PAGE_SIZE = 10

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

function userKey(row: BookingRow) {
  return `${row.memberName}||${row.memberMeta}`
}

function uniqueMemberOptions(rows: BookingRow[]) {
  const seen = new Map<string, { key: string; label: string; meta: string }>()
  for (const row of rows) {
    const key = userKey(row)
    if (!seen.has(key)) {
      seen.set(key, { key, label: row.memberName || 'Unknown member', meta: row.memberMeta || '' })
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function actionSummaryItems(row: BookingRow | null, action: 'complete' | 'cancel' | 'edit' | '', nextNote = ''): ConfirmActionSummaryItem[] {
  if (!row || !action) return []

  const baseItems: ConfirmActionSummaryItem[] = [
    { label: 'Member', value: row.memberName },
    { label: 'Member info', value: row.memberMeta || '—' },
    { label: 'Coach', value: row.coachName },
    { label: 'Date', value: formatSlotDate(row.slotDate) },
    { label: 'Time', value: slotTimeLabel(row.startTime, row.endTime) },
    { label: 'Current status', value: privateCoachingBookingStatusLabel(row.status) },
    { label: 'Booked', value: formatDateTime(row.bookedAt) },
  ]

  if (action === 'edit') {
    return [
      ...baseItems,
      { label: 'Current note', value: row.note || '—' },
      { label: 'New note', value: nextNote.trim() || '—' },
      { label: 'Booking impact', value: 'Only the admin note is updated' },
      { label: 'Token impact', value: 'No token change' },
    ]
  }

  return [
    ...baseItems,
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
  const [busyAction, setBusyAction] = React.useState<'complete' | 'cancel' | 'edit' | ''>('')
  const [confirmRow, setConfirmRow] = React.useState<BookingRow | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<'complete' | 'cancel' | 'edit' | ''>('')
  const [editingRow, setEditingRow] = React.useState<BookingRow | null>(null)
  const [editNote, setEditNote] = React.useState('')
  const [filter, setFilter] = React.useState<(typeof STATUS_FILTERS)[number]['value']>('all')
  const [memberFilter, setMemberFilter] = React.useState('all')
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const memberOptions = React.useMemo(() => uniqueMemberOptions(rows), [rows])

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => {
      const matchesStatus = filter === 'all' || row.status === filter
      const matchesMember = memberFilter === 'all' || userKey(row) === memberFilter
      return matchesStatus && matchesMember
    })
  }, [filter, memberFilter, rows])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / BOOKINGS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageStart = (safePage - 1) * BOOKINGS_PAGE_SIZE
  const paginatedRows = filteredRows.slice(pageStart, pageStart + BOOKINGS_PAGE_SIZE)

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  function resetToFirstPage() {
    setPage(1)
  }

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

  function startEdit(row: BookingRow) {
    setStatus({ kind: '', message: '' })
    setEditingRow(row)
    setEditNote(row.note || '')
  }

  function closeEdit() {
    if (busyId) return
    setEditingRow(null)
    if (confirmAction === 'edit') {
      setConfirmRow(null)
      setConfirmAction('')
    }
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
      const res = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not delete booking.' })
        return
      }
      setConfirmRow(null)
      setConfirmAction('')
      setStatus({ kind: 'success', message: 'Booking cancelled. The member token has been returned.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not delete booking.' })
    } finally {
      setBusyId('')
      setBusyAction('')
    }
  }

  async function updateBooking(row: BookingRow) {
    setBusyId(row.id)
    setBusyAction('edit')
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: editNote }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not update booking.' })
        return
      }
      setEditingRow(null)
      setConfirmRow(null)
      setConfirmAction('')
      setStatus({ kind: 'success', message: 'Booking note updated.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not update booking.' })
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

      <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-end">
          <div>
            <div className="mb-2 text-sm font-semibold">Filter bookings by status</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setFilter(item.value)
                    resetToFirstPage()
                  }}
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
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-semibold">Filter bookings by member</span>
            <select
              value={memberFilter}
              onChange={(event) => {
                setMemberFilter(event.target.value)
                resetToFirstPage()
              }}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            >
              <option value="all">All members</option>
              {memberOptions.map((member) => (
                <option key={member.key} value={member.key}>
                  {member.label}{member.meta ? ` — ${member.meta}` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm font-semibold text-[hsl(var(--muted))] lg:text-right">
            Showing {filteredRows.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + BOOKINGS_PAGE_SIZE, filteredRows.length)} of {filteredRows.length} booking(s) · 10 per page
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No private coaching booking yet.
        </div>
      ) : null}

      {rows.length > 0 && filteredRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No booking matches these filters.
        </div>
      ) : null}

      <div className="grid gap-3">
        {paginatedRows.map((row) => {
          const isEditing = editingRow?.id === row.id
          return (
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

                <div className="flex w-full flex-col gap-2 lg:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => startEdit(row)}
                    disabled={Boolean(busyId)}
                    className="w-full lg:w-auto"
                  >
                    Edit booking
                  </Button>

                  {row.status === 'booked' ? (
                    <>
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
                        loadingText="Deleting…"
                        className="w-full lg:w-auto"
                      >
                        Delete / cancel booking
                      </Button>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      {row.completedAt ? `Completed ${formatDateTime(row.completedAt)}` : row.cancelledAt ? `Cancelled ${formatDateTime(row.cancelledAt)}` : privateCoachingBookingStatusLabel(row.status)}
                    </div>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="mt-4 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                  <div className="text-sm font-semibold">Edit booking note</div>
                  <p className="mt-1 text-xs text-[hsl(var(--muted))]">This safe edit only changes the admin note. It does not move the slot or change tokens.</p>
                  <label className="mt-3 grid gap-1">
                    <span className="text-sm font-semibold">Note</span>
                    <input
                      value={editNote}
                      onChange={(event) => setEditNote(event.target.value)}
                      maxLength={500}
                      placeholder="Optional booking note"
                      className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                    />
                  </label>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={closeEdit} disabled={Boolean(busyId)}>
                      Cancel edit
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        setConfirmRow(row)
                        setConfirmAction('edit')
                      }}
                      disabled={Boolean(busyId)}
                      loading={busyId === row.id && busyAction === 'edit'}
                      loadingText="Saving…"
                    >
                      Save booking changes
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {filteredRows.length > BOOKINGS_PAGE_SIZE ? (
        <div className="flex flex-col gap-2 rounded-3xl border border-[hsl(var(--border))] bg-white p-3 text-sm shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="font-semibold text-[hsl(var(--muted))]">Page {safePage} of {pageCount}</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1}>
              Previous
            </Button>
            <Button type="button" variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={Boolean(confirmRow && confirmAction)}
        title={
          confirmAction === 'cancel'
            ? 'Delete private coaching booking?'
            : confirmAction === 'edit'
              ? 'Confirm booking changes'
              : 'Mark private coaching session completed?'
        }
        description={
          confirmAction === 'cancel'
            ? 'Please confirm before cancelling this private coaching booking.'
            : confirmAction === 'edit'
              ? 'Please review the booking note update before saving.'
              : 'Please confirm that this private coaching session has been completed.'
        }
        confirmLabel={confirmAction === 'cancel' ? 'Confirm delete' : confirmAction === 'edit' ? 'Confirm & save' : 'Confirm completed'}
        pendingLabel={confirmAction === 'cancel' ? 'Deleting…' : 'Saving…'}
        pending={Boolean(confirmRow && busyId === confirmRow.id)}
        tone={confirmAction === 'cancel' ? 'destructive' : 'default'}
        summaryItems={actionSummaryItems(confirmRow, confirmAction, editNote)}
        warning={
          confirmAction === 'cancel'
            ? 'Deleting here safely cancels the booking and returns 1 token to the member.'
            : confirmAction === 'edit'
              ? 'This only updates the booking note. Token and slot status stay unchanged.'
              : 'Completed sessions keep the token consumed and cannot be returned by this action.'
        }
        onCancel={closeConfirm}
        onConfirm={() => {
          if (!confirmRow) return undefined
          if (confirmAction === 'cancel') return cancelBooking(confirmRow)
          if (confirmAction === 'complete') return completeBooking(confirmRow)
          if (confirmAction === 'edit') return updateBooking(confirmRow)
          return undefined
        }}
      />
    </div>
  )
}
