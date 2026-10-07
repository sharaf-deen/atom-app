'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'

type MemberOption = {
  user_id: string
  full_name: string
  meta: string
}

type CoachOption = {
  user_id: string
  full_name: string
  email: string | null
}

type TokenBalance = {
  memberId: string
  coachId: string
  remaining: number
}

type Props = {
  members: MemberOption[]
  coaches: CoachOption[]
  tokenBalances: TokenBalance[]
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

function formatDate(value: string) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

export default function PrivateCoachingBackdatedCompletedClient({
  members,
  coaches,
  tokenBalances,
  canChooseCoach,
  defaultCoachId,
}: Props) {
  const router = useRouter()
  const [memberId, setMemberId] = React.useState('')
  const [coachId, setCoachId] = React.useState(defaultCoachId)
  const [slotDate, setSlotDate] = React.useState(todayInputValue())
  const [startTime, setStartTime] = React.useState('13:00')
  const [endTime, setEndTime] = React.useState('14:00')
  const [note, setNote] = React.useState('')
  const [reason, setReason] = React.useState('Session completed but not recorded in ATOM.')
  const [consumeToken, setConsumeToken] = React.useState(true)
  const [closeOpenRequest, setCloseOpenRequest] = React.useState(true)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const selectedMember = members.find((member) => member.user_id === memberId) ?? null
  const selectedCoach = coaches.find((coach) => coach.user_id === coachId) ?? null
  const remainingTokens = tokenBalances
    .filter((balance) => balance.memberId === memberId && balance.coachId === coachId)
    .reduce((sum, balance) => sum + Math.max(0, Number(balance.remaining ?? 0)), 0)

  const summaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Member', value: selectedMember?.full_name || '—' },
    { label: 'Member info', value: selectedMember?.meta || '—' },
    { label: 'Coach', value: selectedCoach?.full_name || '—' },
    { label: 'Session date', value: formatDate(slotDate) },
    { label: 'Time', value: `${startTime || '—'} - ${endTime || '—'}` },
    { label: 'Final status', value: 'Completed' },
    { label: 'Available tokens', value: remainingTokens },
    { label: 'Token impact', value: consumeToken ? 'Consume 1 token' : 'No token deduction' },
    { label: 'Open request', value: closeOpenRequest ? 'Close active request for this member/coach if present' : 'Leave unchanged' },
    { label: 'Audit reason', value: reason.trim() || '—' },
    { label: 'Note', value: note.trim() || '—' },
  ]

  function validate() {
    if (!memberId) return 'Choose a member.'
    if (!coachId) return 'Choose a coach.'
    if (!slotDate) return 'Choose the actual session date.'
    if (!startTime || !endTime) return 'Enter the actual start and end time.'
    if (endTime <= startTime) return 'End time must be after start time.'
    if (reason.trim().length < 3) return 'Enter an audit reason.'
    if (consumeToken && remainingTokens <= 0) {
      return 'This member has no active token for this coach. Turn off token consumption only if no token should be deducted.'
    }
    return ''
  }

  function review() {
    const error = validate()
    if (error) {
      setStatus({ kind: 'error', message: error })
      return
    }
    setStatus({ kind: '', message: '' })
    setConfirmOpen(true)
  }

  async function createCompletedSession() {
    const error = validate()
    if (error) {
      setStatus({ kind: 'error', message: error })
      setConfirmOpen(false)
      return
    }

    setBusy(true)
    setStatus({ kind: '', message: '' })

    try {
      const response = await fetch('/api/private-coaching/bookings/backdated-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          coach_id: coachId,
          slot_date: slotDate,
          start_time: startTime,
          end_time: endTime,
          note,
          reason,
          consume_token: consumeToken,
          close_open_request: closeOpenRequest,
        }),
      })
      const json = await response.json().catch(() => ({}))

      if (!response.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not record the completed session.' })
        return
      }

      setConfirmOpen(false)
      setMemberId('')
      setNote('')
      setReason('Session completed but not recorded in ATOM.')
      setConsumeToken(true)
      setCloseOpenRequest(true)
      setStatus({
        kind: 'success',
        message: `Past session recorded as completed.${json?.token_consumed ? ' One token was consumed.' : ' No token was deducted.'}${json?.open_request_closed ? ' Any open session request for this member/coach was closed.' : ''}`,
      })
      router.refresh()
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.message || 'Could not record the completed session.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Use this only when the private session really happened but was never booked in ATOM. The record is created directly as <strong>Completed</strong> and will appear in the member history.
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Member</span>
          <select
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
          >
            <option value="">Choose member</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name}{member.meta ? ` — ${member.meta}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-semibold">Coach</span>
          <select
            value={coachId}
            onChange={(event) => setCoachId(event.target.value)}
            disabled={!canChooseCoach}
            className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black disabled:opacity-60"
          >
            {coaches.map((coach) => (
              <option key={coach.user_id} value={coach.user_id}>{coach.full_name}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-semibold">Actual session date</span>
          <input
            type="date"
            value={slotDate}
            max={todayInputValue()}
            onChange={(event) => setSlotDate(event.target.value)}
            className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-semibold">Start</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">End</span>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Audit reason</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Why is this session being recorded retrospectively?"
            className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-3 text-sm shadow-soft outline-none focus:border-black"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-semibold">Booking note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Optional operational note"
            className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-3 text-sm shadow-soft outline-none focus:border-black"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
          <input
            type="checkbox"
            checked={consumeToken}
            onChange={(event) => setConsumeToken(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-semibold">Consume 1 token</span>
            <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
              Current available balance for this member/coach: {remainingTokens}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
          <input
            type="checkbox"
            checked={closeOpenRequest}
            onChange={(event) => setCloseOpenRequest(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-semibold">Close open session request</span>
            <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
              If this member already has a pending/counter-proposed request with this coach, close it to avoid a duplicate.
            </span>
          </span>
        </label>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={review} disabled={busy}>
          Review completed session
        </Button>
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        title="Record past private session as completed?"
        description="Review carefully. This creates a completed historical booking immediately."
        confirmLabel="Create completed session"
        pendingLabel="Creating…"
        pending={busy}
        summaryItems={summaryItems}
        warning={consumeToken
          ? 'This action will consume 1 active private coaching token and cannot be treated as a normal future booking.'
          : 'No token will be deducted. Use this only when the retrospective session should not consume a package token.'}
        onCancel={() => {
          if (!busy) setConfirmOpen(false)
        }}
        onConfirm={createCompletedSession}
      />
    </div>
  )
}
