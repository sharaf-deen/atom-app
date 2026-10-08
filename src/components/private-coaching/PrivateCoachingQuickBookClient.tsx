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

function addMinutesToTime(value: string, minutesToAdd: number) {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value
  const total = Math.min(hours * 60 + minutes + minutesToAdd, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

export default function PrivateCoachingQuickBookClient({ members, coaches, canChooseCoach, defaultCoachId }: Props) {
  const router = useRouter()
  const [memberId, setMemberId] = React.useState('')
  const [coachId, setCoachId] = React.useState(defaultCoachId || coaches[0]?.user_id || '')
  const [slotDate, setSlotDate] = React.useState(todayInputValue())
  const [startTime, setStartTime] = React.useState('13:00')
  const [endTime, setEndTime] = React.useState('14:00')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const member = members.find((row) => row.user_id === memberId)
  const coach = coaches.find((row) => row.user_id === coachId)

  const summaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Member', value: member ? `${member.full_name} · ${member.meta}` : '—' },
    { label: 'Coach', value: coach?.full_name || '—' },
    { label: 'Date', value: formatDate(slotDate) },
    { label: 'Time', value: `${formatPrivateCoachingSlotTime(startTime)} - ${formatPrivateCoachingSlotTime(endTime)}` },
    { label: 'Note', value: note.trim() || '—' },
    { label: 'Booking impact', value: 'Booking is created immediately' },
    { label: 'Token impact', value: '1 active private coaching token is consumed' },
  ]

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!memberId) return setStatus({ kind: 'error', message: 'Choose a member.' })
    if (!coachId) return setStatus({ kind: 'error', message: 'Choose a coach.' })
    setStatus({ kind: '', message: '' })
    setConfirmOpen(true)
  }

  async function createBooking() {
    setBusy(true)
    setStatus({ kind: '', message: '' })
    try {
      const response = await fetch('/api/private-coaching/bookings/quick', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, coach_id: coachId, slot_date: slotDate, start_time: startTime, end_time: endTime, note }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not create the direct booking.' })
        return
      }
      setConfirmOpen(false)
      setMemberId('')
      setNote('')
      setStatus({ kind: 'success', message: 'Private session booked directly. 1 member token was consumed.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not create the direct booking.' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}
      <form onSubmit={review} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 lg:col-span-2">
            <span className="text-sm font-semibold">Member</span>
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required>
              <option value="">Choose member</option>
              {members.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name} · {item.meta}</option>)}
            </select>
          </label>
          {canChooseCoach ? (
            <label className="grid gap-1">
              <span className="text-sm font-semibold">Coach</span>
              <select value={coachId} onChange={(event) => setCoachId(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required>
                {coaches.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1">
            <span className="text-sm font-semibold">Date</span>
            <input type="date" min={todayInputValue()} value={slotDate} onChange={(event) => setSlotDate(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">Start</span>
            <input type="time" value={startTime} onChange={(event) => { const value = event.target.value; setStartTime(value); setEndTime(addMinutesToTime(value, 60)) }} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">End</span>
            <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required />
          </label>
          <label className="grid gap-1 md:col-span-2 lg:col-span-5">
            <span className="text-sm font-semibold">Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional note" className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" />
          </label>
        </div>
        <div className="flex justify-end"><Button type="submit" disabled={busy || !memberId || !coachId}>Review quick booking</Button></div>
      </form>
      <ConfirmActionModal open={confirmOpen} title="Create private coaching booking?" description="Create the agreed session directly without first publishing an availability slot." confirmLabel="Create booking" pendingLabel="Booking…" pending={busy} summaryItems={summaryItems} warning="1 active private coaching token will be consumed immediately." onCancel={() => { if (!busy) setConfirmOpen(false) }} onConfirm={createBooking} />
    </div>
  )
}
