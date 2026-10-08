'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import { formatPrivateCoachingSlotTime } from '@/lib/privateCoaching'

type MemberOption = { user_id: string; full_name: string; meta: string }
type CoachOption = { user_id: string; full_name: string; email: string | null }
type Props = { members: MemberOption[]; coaches: CoachOption[]; canChooseCoach: boolean; defaultCoachId: string }

function todayInputValue() {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
function isPastDate(value: string) { return value < todayInputValue() }
function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

export default function PrivateCoachingAddAvailabilityClient({ members, coaches, canChooseCoach, defaultCoachId }: Props) {
  const router = useRouter()
  const [coachId, setCoachId] = React.useState(defaultCoachId || coaches[0]?.user_id || '')
  const [slotDate, setSlotDate] = React.useState(todayInputValue())
  const [startTime, setStartTime] = React.useState('11:00')
  const [endTime, setEndTime] = React.useState('12:00')
  const [note, setNote] = React.useState('')
  const [assignedMemberId, setAssignedMemberId] = React.useState('')
  const [backdatedReason, setBackdatedReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const isBackdated = isPastDate(slotDate)
  const coach = coaches.find((row) => row.user_id === coachId)
  const member = members.find((row) => row.user_id === assignedMemberId)
  const summaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Coach', value: coach?.full_name || '—' },
    { label: 'Date', value: formatDate(slotDate) },
    { label: 'Time', value: `${formatPrivateCoachingSlotTime(startTime)} - ${formatPrivateCoachingSlotTime(endTime)}` },
    { label: 'Past correction', value: isBackdated ? 'Yes' : 'No' },
    ...(isBackdated ? [{ label: 'Assigned member', value: member ? `${member.full_name} · ${member.meta}` : '—' }, { label: 'Reason', value: backdatedReason.trim() || '—' }] : []),
    { label: 'Note', value: note.trim() || '—' },
    { label: 'Token impact', value: 'No token is consumed until this slot is booked' },
  ]

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!coachId) return setStatus({ kind: 'error', message: 'Choose a coach.' })
    if (isBackdated && !assignedMemberId) return setStatus({ kind: 'error', message: 'Choose the member for this past correction slot.' })
    if (isBackdated && backdatedReason.trim().length < 3) return setStatus({ kind: 'error', message: 'Add a short reason for this past correction slot.' })
    setStatus({ kind: '', message: '' })
    setConfirmOpen(true)
  }

  async function createSlot() {
    setBusy(true)
    setStatus({ kind: '', message: '' })
    try {
      const response = await fetch('/api/private-coaching/slots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coach_id: coachId, slot_date: slotDate, start_time: startTime, end_time: endTime, note, assigned_member_id: isBackdated ? assignedMemberId : null, backdated_reason: isBackdated ? backdatedReason : null }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not create availability.' })
        return
      }
      setConfirmOpen(false)
      setNote('')
      setAssignedMemberId('')
      setBackdatedReason('')
      setStatus({ kind: 'success', message: isBackdated ? 'Past correction slot created.' : 'Availability slot created.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not create availability.' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}
      <form onSubmit={review} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {canChooseCoach ? (
            <label className="grid gap-1"><span className="text-sm font-semibold">Coach</span><select value={coachId} onChange={(event) => setCoachId(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required>{coaches.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name}</option>)}</select></label>
          ) : null}
          <label className="grid gap-1"><span className="text-sm font-semibold">Date</span><input type="date" value={slotDate} onChange={(event) => setSlotDate(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">Start time</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">End time</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required /></label>
          <label className="grid gap-1 md:col-span-2 lg:col-span-4"><span className="text-sm font-semibold">Note</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional location or note" className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" /></label>
        </div>
        {isBackdated ? (
          <div className="grid gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-2">
            <div className="md:col-span-2 text-sm text-amber-950">Past dates create a correction slot visible only to the assigned member. If the session already happened, use <strong>Record past session</strong> instead.</div>
            <label className="grid gap-1"><span className="text-sm font-semibold">Assigned member</span><select value={assignedMemberId} onChange={(event) => setAssignedMemberId(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus:border-black" required><option value="">Choose member</option>{members.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name} · {item.meta}</option>)}</select></label>
            <label className="grid gap-1"><span className="text-sm font-semibold">Correction reason</span><input value={backdatedReason} onChange={(event) => setBackdatedReason(event.target.value)} maxLength={500} placeholder="Why is this past slot being added?" className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus:border-black" required /></label>
          </div>
        ) : null}
        <div className="flex justify-end"><Button type="submit" disabled={busy || !coachId}>Review availability</Button></div>
      </form>
      <ConfirmActionModal open={confirmOpen} title="Create private coaching availability?" description="Review the slot before publishing it." confirmLabel="Create availability" pendingLabel="Creating…" pending={busy} summaryItems={summaryItems} warning={isBackdated ? 'This past correction slot will be visible only to the assigned member.' : 'Members with an active private coaching token can book this slot.'} onCancel={() => { if (!busy) setConfirmOpen(false) }} onConfirm={createSlot} />
    </div>
  )
}
