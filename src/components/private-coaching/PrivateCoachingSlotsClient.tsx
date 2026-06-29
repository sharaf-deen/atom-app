'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import {
  formatPrivateCoachingSlotTime,
  privateCoachingSlotStatusLabel,
} from '@/lib/privateCoaching'

type CoachOption = {
  user_id: string
  full_name: string
  email: string | null
}

type MemberOption = {
  user_id: string
  full_name: string
  meta: string
}

type SlotRow = {
  id: string
  coachId: string
  coachName: string
  slotDate: string
  startTime: string
  endTime: string
  status: string
  note: string | null
  createdAt: string
  isBackdated: boolean
  assignedMemberId: string | null
  assignedMemberName: string | null
  assignedMemberMeta: string | null
  backdatedReason: string | null
}

type Props = {
  rows: SlotRow[]
  coaches: CoachOption[]
  members: MemberOption[]
  canChooseCoach: boolean
  defaultCoachId: string
}

const SLOT_VIEWS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
] as const

function todayInputValue() {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function isPastDate(value?: string | null) {
  if (!value) return false
  return value < todayInputValue()
}

function formatSlotDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })
}

function statusClass(status: string) {
  if (status === 'available') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'booked') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function correctionClass(isCorrection: boolean) {
  return isCorrection
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function slotTimeLabel(startTime: string, endTime: string) {
  return `${formatPrivateCoachingSlotTime(startTime)} - ${formatPrivateCoachingSlotTime(endTime)}`
}

function cancelSlotSummaryItems(row: SlotRow | null): ConfirmActionSummaryItem[] {
  if (!row) return []

  const isCorrection = row.isBackdated || isPastDate(row.slotDate)

  return [
    { label: 'Coach', value: row.coachName },
    { label: 'Date', value: formatSlotDate(row.slotDate) },
    { label: 'Time', value: slotTimeLabel(row.startTime, row.endTime) },
    { label: 'Current status', value: privateCoachingSlotStatusLabel(row.status) },
    { label: 'Correction slot', value: isCorrection ? 'Yes' : 'No' },
    ...(isCorrection ? [
      { label: 'Assigned member', value: row.assignedMemberName || '—' },
      { label: 'Reason', value: row.backdatedReason || row.note || '—' },
    ] : []),
    { label: 'Note', value: row.note || '—' },
    { label: 'Booking impact', value: 'This available slot will no longer be bookable' },
  ]
}

export default function PrivateCoachingSlotsClient({ rows, coaches, members, canChooseCoach, defaultCoachId }: Props) {
  const router = useRouter()
  const [coachId, setCoachId] = React.useState(defaultCoachId || coaches[0]?.user_id || '')
  const [slotDate, setSlotDate] = React.useState(todayInputValue())
  const [startTime, setStartTime] = React.useState('11:00')
  const [endTime, setEndTime] = React.useState('12:00')
  const [note, setNote] = React.useState('')
  const [assignedMemberId, setAssignedMemberId] = React.useState('')
  const [backdatedReason, setBackdatedReason] = React.useState('')
  const [slotView, setSlotView] = React.useState<(typeof SLOT_VIEWS)[number]['value']>('upcoming')
  const [busy, setBusy] = React.useState(false)
  const [busyCancelId, setBusyCancelId] = React.useState('')
  const [confirmCreateOpen, setConfirmCreateOpen] = React.useState(false)
  const [confirmCancelRow, setConfirmCancelRow] = React.useState<SlotRow | null>(null)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const selectedCoach = coaches.find((coach) => coach.user_id === coachId)
  const selectedMember = members.find((member) => member.user_id === assignedMemberId)
  const isBackdatedDraft = isPastDate(slotDate)

  const filteredRows = React.useMemo(() => {
    if (slotView === 'all') return rows
    if (slotView === 'past') return rows.filter((row) => isPastDate(row.slotDate))
    return rows.filter((row) => !isPastDate(row.slotDate))
  }, [rows, slotView])

  const createSlotSummaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Coach', value: selectedCoach?.full_name || '—' },
    { label: 'Date', value: formatSlotDate(slotDate) },
    { label: 'Time', value: slotTimeLabel(startTime, endTime) },
    { label: 'Backdated correction', value: isBackdatedDraft ? 'Yes' : 'No' },
    ...(isBackdatedDraft ? [
      { label: 'Assigned member', value: selectedMember ? `${selectedMember.full_name} · ${selectedMember.meta}` : '—' },
      { label: 'Reason', value: backdatedReason.trim() || '—' },
      { label: 'Member visibility', value: 'Only this member will see the past slot' },
    ] : []),
    { label: 'Note', value: note.trim() || '—' },
    { label: 'Status impact', value: isBackdatedDraft ? 'Past correction slot will be available only to the assigned member' : 'Slot will be available for members with active private coaching tokens' },
    { label: 'Token impact', value: 'No token is consumed until the member books this slot' },
  ]

  function handleCreateSlotSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !coachId) return
    if (isBackdatedDraft && !assignedMemberId) {
      setStatus({ kind: 'error', message: 'Choose the member for this past slot correction.' })
      return
    }
    if (isBackdatedDraft && backdatedReason.trim().length < 3) {
      setStatus({ kind: 'error', message: 'Add a short reason for this backdated correction.' })
      return
    }
    setStatus({ kind: '', message: '' })
    setConfirmCreateOpen(true)
  }

  async function createSlot() {
    if (busy || !coachId) return

    setBusy(true)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch('/api/private-coaching/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_id: coachId,
          slot_date: slotDate,
          start_time: startTime,
          end_time: endTime,
          note,
          assigned_member_id: isBackdatedDraft ? assignedMemberId : null,
          backdated_reason: isBackdatedDraft ? backdatedReason : null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not create slot.' })
        return
      }
      setConfirmCreateOpen(false)
      setNote('')
      setBackdatedReason('')
      setAssignedMemberId('')
      setStatus({ kind: 'success', message: isBackdatedDraft ? 'Backdated correction slot created.' : 'Availability slot created.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not create slot.' })
    } finally {
      setBusy(false)
    }
  }

  async function cancelSlot(row: SlotRow) {
    setBusyCancelId(row.id)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/slots/${encodeURIComponent(row.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not cancel slot.' })
        return
      }
      setConfirmCancelRow(null)
      setStatus({ kind: 'success', message: 'Slot cancelled.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not cancel slot.' })
    } finally {
      setBusyCancelId('')
    }
  }

  return (
    <div className="space-y-5">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <form onSubmit={handleCreateSlotSubmit} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-lg font-semibold tracking-tight">Add availability</h4>
            <p className="text-sm text-[hsl(var(--muted))]">Create future slots normally. For missed sessions, choose a past date and assign the correction slot to one member.</p>
          </div>
          <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">
            Booking enabled
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {canChooseCoach ? (
            <label className="grid gap-1 lg:col-span-2">
              <span className="text-sm font-semibold">Coach</span>
              <select
                value={coachId}
                onChange={(event) => setCoachId(event.target.value)}
                className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                required
              >
                {coaches.map((coach) => (
                  <option key={coach.user_id} value={coach.user_id}>
                    {coach.full_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-1">
            <span className="text-sm font-semibold">Date</span>
            <input
              type="date"
              value={slotDate}
              onChange={(event) => setSlotDate(event.target.value)}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold">Start time</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold">End time</span>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
              required
            />
          </label>

          <label className="grid gap-1 md:col-span-2 lg:col-span-5">
            <span className="text-sm font-semibold">Note</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Optional location or note"
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            />
          </label>

          {isBackdatedDraft ? (
            <div className="grid gap-3 md:col-span-2 lg:col-span-5">
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                This is a past date. The slot will be created as a missed-session correction and must be assigned to one member only.
              </div>

              <label className="grid gap-1">
                <span className="text-sm font-semibold">Assigned member</span>
                <select
                  value={assignedMemberId}
                  onChange={(event) => setAssignedMemberId(event.target.value)}
                  className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                  required={isBackdatedDraft}
                >
                  <option value="">Choose member</option>
                  {members.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.full_name} · {member.meta}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold">Correction reason</span>
                <input
                  value={backdatedReason}
                  onChange={(event) => setBackdatedReason(event.target.value)}
                  maxLength={500}
                  placeholder="Example: Session done but not booked in the app"
                  className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                  required={isBackdatedDraft}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="submit" loading={busy} loadingText="Saving…" disabled={busy || !coachId || (isBackdatedDraft && !assignedMemberId)}>
            {isBackdatedDraft ? 'Add correction slot' : 'Add slot'}
          </Button>
        </div>
      </form>

      <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-base font-semibold tracking-tight">Slots list</h4>
            <p className="text-sm text-[hsl(var(--muted))]">Use Past or All to find old slots that may block duplicate creation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SLOT_VIEWS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSlotView(item.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                  slotView === item.value
                    ? 'border-black bg-black text-white'
                    : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {filteredRows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
            No availability slot matches this view.
          </div>
        ) : null}

        {filteredRows.map((row) => {
          const isCorrection = row.isBackdated || isPastDate(row.slotDate)
          return (
            <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(row.status)}`}>
                      {privateCoachingSlotStatusLabel(row.status)}
                    </span>
                    <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--muted))]">
                      {row.coachName}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${correctionClass(isCorrection)}`}>
                      {isCorrection ? 'Backdated correction' : 'Regular slot'}
                    </span>
                  </div>

                  <div className="mt-3 text-base font-semibold tracking-tight">
                    {formatSlotDate(row.slotDate)} · {formatPrivateCoachingSlotTime(row.startTime)} - {formatPrivateCoachingSlotTime(row.endTime)}
                  </div>
                  {isCorrection ? (
                    <div className="mt-1 text-sm text-amber-800">
                      Assigned to {row.assignedMemberName || 'member'}{row.assignedMemberMeta ? ` · ${row.assignedMemberMeta}` : ''}
                      {row.backdatedReason ? ` · Reason: ${row.backdatedReason}` : ''}
                    </div>
                  ) : null}
                  {row.note ? <div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.note}</div> : null}
                </div>

                {row.status === 'available' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmCancelRow(row)}
                    loading={busyCancelId === row.id}
                    loadingText="Cancelling…"
                    disabled={Boolean(busyCancelId)}
                    className="w-full lg:w-auto"
                  >
                    Cancel slot
                  </Button>
                ) : (
                  <span className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                    {privateCoachingSlotStatusLabel(row.status)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmActionModal
        open={confirmCreateOpen}
        title={isBackdatedDraft ? 'Confirm backdated correction slot' : 'Confirm availability slot'}
        description={isBackdatedDraft ? 'Please review the past slot correction before assigning it to this member.' : 'Please review the slot before making it available to members.'}
        confirmLabel={isBackdatedDraft ? 'Confirm correction slot' : 'Confirm & create'}
        pendingLabel="Saving…"
        pending={busy}
        summaryItems={createSlotSummaryItems}
        warning={isBackdatedDraft ? 'Only the assigned member will see this past slot. Booking it will consume 1 private coaching token.' : 'Members with active private coaching tokens will be able to book this slot.'}
        onCancel={() => {
          if (!busy) setConfirmCreateOpen(false)
        }}
        onConfirm={createSlot}
      />

      <ConfirmActionModal
        open={Boolean(confirmCancelRow)}
        title="Cancel availability slot?"
        description="Please confirm before cancelling this available private coaching slot."
        confirmLabel="Confirm cancel"
        pendingLabel="Cancelling…"
        pending={Boolean(confirmCancelRow && busyCancelId === confirmCancelRow.id)}
        tone="destructive"
        summaryItems={cancelSlotSummaryItems(confirmCancelRow)}
        warning="The slot will no longer be visible for new member bookings."
        onCancel={() => {
          if (!busyCancelId) setConfirmCancelRow(null)
        }}
        onConfirm={() => {
          if (confirmCancelRow) return cancelSlot(confirmCancelRow)
        }}
      />
    </div>
  )
}
