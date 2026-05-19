'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import {
  formatPrivateCoachingSlotTime,
  privateCoachingSlotStatusLabel,
} from '@/lib/privateCoaching'

type CoachOption = {
  user_id: string
  full_name: string
  email: string | null
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
}

type Props = {
  rows: SlotRow[]
  coaches: CoachOption[]
  canChooseCoach: boolean
  defaultCoachId: string
}

function todayInputValue() {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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

export default function PrivateCoachingSlotsClient({ rows, coaches, canChooseCoach, defaultCoachId }: Props) {
  const router = useRouter()
  const [coachId, setCoachId] = React.useState(defaultCoachId || coaches[0]?.user_id || '')
  const [slotDate, setSlotDate] = React.useState(todayInputValue())
  const [startTime, setStartTime] = React.useState('11:00')
  const [endTime, setEndTime] = React.useState('12:00')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [busyCancelId, setBusyCancelId] = React.useState('')
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  async function createSlot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not create slot.' })
        return
      }
      setNote('')
      setStatus({ kind: 'success', message: 'Availability slot created.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not create slot.' })
    } finally {
      setBusy(false)
    }
  }

  async function cancelSlot(id: string) {
    setBusyCancelId(id)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/slots/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not cancel slot.' })
        return
      }
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

      <form onSubmit={createSlot} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-lg font-semibold tracking-tight">Add availability</h4>
            <p className="text-sm text-[hsl(var(--muted))]">Create simple available slots. Members with active tokens can book them from their private coaching page.</p>
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
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="submit" loading={busy} loadingText="Saving…" disabled={busy || !coachId}>
            Add slot
          </Button>
        </div>
      </form>

      <div className="grid gap-3">
        {rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
            No availability slot yet.
          </div>
        ) : null}

        {rows.map((row) => (
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
                </div>

                <div className="mt-3 text-base font-semibold tracking-tight">
                  {formatSlotDate(row.slotDate)} · {formatPrivateCoachingSlotTime(row.startTime)} - {formatPrivateCoachingSlotTime(row.endTime)}
                </div>
                {row.note ? <div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.note}</div> : null}
              </div>

              {row.status === 'available' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cancelSlot(row.id)}
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
        ))}
      </div>
    </div>
  )
}
