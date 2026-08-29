'use client'

import * as React from 'react'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import { formatPrivateCoachingSlotTime } from '@/lib/privateCoaching'

type CoachOption = {
  user_id: string
  full_name: string
  remaining_sessions: number
}

type SessionRequest = {
  id: string
  member_id: string
  member_name: string
  member_meta: string
  coach_id: string
  coach_name: string
  requested_date: string
  requested_start_time: string
  requested_end_time: string
  member_note: string | null
  status: string
  proposed_date: string | null
  proposed_start_time: string | null
  proposed_end_time: string | null
  coach_note: string | null
  booking_id: string | null
  confirmed_at: string | null
  declined_at: string | null
  decline_reason: string | null
  cancelled_at: string | null
  created_at: string
}

type ApiData = {
  ok: boolean
  role?: string
  coaches?: CoachOption[]
  requests?: SessionRequest[]
  error?: string
  details?: string
}

type Props = {
  mode: 'member' | 'manager'
}

type ConfirmState = {
  action: 'confirm' | 'accept_proposal' | 'cancel'
  request: SessionRequest
} | null

function todayInputValue() {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function addMinutesToTime(value: string, minutesToAdd: number) {
  const [hours, minutes] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value
  const total = hours * 60 + minutes + minutesToAdd
  if (total >= 24 * 60) return '23:59'
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function normalizeTimeInput(value?: string | null) {
  const trimmed = String(value ?? '').trim()
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(trimmed)
  return match ? `${match[1]}:${match[2]}` : trimmed
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
  return date.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function timeLabel(date?: string | null, start?: string | null, end?: string | null) {
  if (!date || !start || !end) return '—'
  return `${formatSlotDate(date)} · ${formatPrivateCoachingSlotTime(start)} - ${formatPrivateCoachingSlotTime(end)}`
}

function statusLabel(status: string) {
  if (status === 'pending') return 'Pending coach review'
  if (status === 'coach_proposed') return 'Coach proposed another time'
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'declined') return 'Declined'
  if (status === 'cancelled') return 'Cancelled'
  return status
}

function statusClass(status: string) {
  if (status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'coach_proposed') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (status === 'confirmed') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function PrivateCoachingSessionRequestsClient({ mode }: Props) {
  const [loading, setLoading] = React.useState(true)
  const [data, setData] = React.useState<ApiData>({ ok: true, coaches: [], requests: [] })
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })
  const [busyId, setBusyId] = React.useState('')
  const [confirmState, setConfirmState] = React.useState<ConfirmState>(null)

  const [coachId, setCoachId] = React.useState('')
  const [slotDate, setSlotDate] = React.useState(todayInputValue())
  const [startTime, setStartTime] = React.useState('13:00')
  const [endTime, setEndTime] = React.useState('14:00')
  const [memberNote, setMemberNote] = React.useState('')

  const [actionRequestId, setActionRequestId] = React.useState('')
  const [actionMode, setActionMode] = React.useState<'propose' | 'decline' | ''>('')
  const [proposalDate, setProposalDate] = React.useState(todayInputValue())
  const [proposalStart, setProposalStart] = React.useState('13:00')
  const [proposalEnd, setProposalEnd] = React.useState('14:00')
  const [proposalNote, setProposalNote] = React.useState('')
  const [declineReason, setDeclineReason] = React.useState('')

  const requests = data.requests ?? []
  const coaches = data.coaches ?? []

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/private-coaching/session-requests', { cache: 'no-store' })
      const json = await res.json().catch(() => ({})) as ApiData
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not load private coaching requests.' })
        return
      }
      setData(json)
      if (mode === 'member' && !coachId && json.coaches?.[0]?.user_id) setCoachId(json.coaches[0].user_id)
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not load private coaching requests.' })
    } finally {
      setLoading(false)
    }
  }, [coachId, mode])

  React.useEffect(() => {
    void load()
  }, [load])

  async function sendMemberRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!coachId || busyId) return
    setBusyId('create')
    setStatus({ kind: '', message: '' })
    try {
      const res = await fetch('/api/private-coaching/session-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_id: coachId,
          slot_date: slotDate,
          start_time: startTime,
          end_time: endTime,
          note: memberNote,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not send the session request.' })
        return
      }
      setMemberNote('')
      setStatus({ kind: 'success', message: 'Session request sent. No token has been used yet.' })
      await load()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not send the session request.' })
    } finally {
      setBusyId('')
    }
  }

  async function runAction(request: SessionRequest, action: string, extra: Record<string, unknown> = {}) {
    if (busyId) return false
    setBusyId(request.id)
    setStatus({ kind: '', message: '' })
    try {
      const res = await fetch(`/api/private-coaching/session-requests/${encodeURIComponent(request.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not update the session request.' })
        return false
      }
      setConfirmState(null)
      setActionRequestId('')
      setActionMode('')
      setProposalNote('')
      setDeclineReason('')
      setStatus({
        kind: 'success',
        message: action === 'confirm'
          ? 'Session confirmed. 1 member token was consumed.'
          : action === 'accept_proposal'
            ? 'Proposed time accepted. Your booking is confirmed and 1 token was used.'
            : action === 'propose'
              ? 'New time proposed to the member. No token has been used yet.'
              : action === 'decline'
                ? 'Session request declined. No token was used.'
                : 'Session request cancelled. No token was used.',
      })
      await load()
      return true
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not update the session request.' })
      return false
    } finally {
      setBusyId('')
    }
  }

  function openProposal(request: SessionRequest) {
    setActionRequestId(request.id)
    setActionMode('propose')
    setProposalDate(request.proposed_date || request.requested_date)
    setProposalStart(normalizeTimeInput(request.proposed_start_time || request.requested_start_time))
    setProposalEnd(normalizeTimeInput(request.proposed_end_time || request.requested_end_time))
    setProposalNote(request.coach_note || '')
    setDeclineReason('')
  }

  function openDecline(request: SessionRequest) {
    setActionRequestId(request.id)
    setActionMode('decline')
    setDeclineReason('')
  }

  function confirmSummary(state: ConfirmState): ConfirmActionSummaryItem[] {
    if (!state) return []
    const request = state.request
    const proposed = state.action === 'accept_proposal'
    return [
      { label: 'Member', value: request.member_name },
      { label: 'Coach', value: request.coach_name },
      { label: 'Session', value: proposed
        ? timeLabel(request.proposed_date, request.proposed_start_time, request.proposed_end_time)
        : timeLabel(request.requested_date, request.requested_start_time, request.requested_end_time) },
      { label: 'Token impact', value: state.action === 'cancel' ? 'No token will be used' : '1 active private coaching token will be used' },
    ]
  }

  if (loading && requests.length === 0) {
    return (
      <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))] shadow-soft">
        Loading session requests…
      </div>
    )
  }

  if (mode === 'member') {
    return (
      <div className="space-y-4">
        {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

        <form onSubmit={sendMemberRequest} className="rounded-3xl border border-blue-200 bg-blue-50/40 p-4 shadow-soft">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-lg font-semibold tracking-tight">Request a private session</h4>
              <p className="text-sm text-[hsl(var(--muted))]">Suggest a preferred date and time to your coach. Your token is only used after the session is confirmed.</p>
            </div>
            <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-800">0 tokens on request</span>
          </div>

          {coaches.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-white p-3 text-sm text-[hsl(var(--muted))]">
              You need an active private coaching token before requesting a session.
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                <label className="grid gap-1 lg:col-span-2">
                  <span className="text-sm font-semibold">Coach</span>
                  <select value={coachId} onChange={(event) => setCoachId(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" required>
                    {coaches.map((coach) => <option key={coach.user_id} value={coach.user_id}>{coach.full_name} · {coach.remaining_sessions} token(s)</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold">Preferred date</span>
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
                  <span className="text-sm font-semibold">Message to coach</span>
                  <input value={memberNote} onChange={(event) => setMemberNote(event.target.value)} maxLength={500} placeholder="Optional: NoGi, specific topic, etc." className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black" />
                </label>
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="submit" loading={busyId === 'create'} loadingText="Sending…" disabled={Boolean(busyId) || !coachId}>Send request</Button>
              </div>
            </>
          )}
        </form>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold tracking-tight">Session requests</h4>
              <p className="text-sm text-[hsl(var(--muted))]">Requests, coach proposals and confirmed sessions.</p>
            </div>
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">{requests.length}</span>
          </div>

          <div className="mt-4 grid gap-3">
            {requests.length === 0 ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted))]">No private coaching session request yet.</div> : null}
            {requests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(request.status)}`}>{statusLabel(request.status)}</span>
                    <div className="mt-3 font-semibold">{timeLabel(request.requested_date, request.requested_start_time, request.requested_end_time)}</div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">{request.coach_name}{request.member_note ? ` · ${request.member_note}` : ''}</div>
                    {request.status === 'coach_proposed' ? (
                      <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                        <div className="font-semibold">Coach proposal</div>
                        <div className="mt-1">{timeLabel(request.proposed_date, request.proposed_start_time, request.proposed_end_time)}</div>
                        {request.coach_note ? <div className="mt-1">{request.coach_note}</div> : null}
                      </div>
                    ) : null}
                    {request.status === 'declined' && request.decline_reason ? <div className="mt-2 text-sm text-rose-700">Reason: {request.decline_reason}</div> : null}
                  </div>
                  <div className="text-xs text-[hsl(var(--muted))]">Requested {formatDateTime(request.created_at)}</div>
                </div>

                {request.status === 'pending' ? (
                  <div className="mt-3 flex justify-end"><Button type="button" variant="outline" onClick={() => setConfirmState({ action: 'cancel', request })} disabled={Boolean(busyId)}>Cancel request</Button></div>
                ) : null}
                {request.status === 'coach_proposed' ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => setConfirmState({ action: 'cancel', request })} disabled={Boolean(busyId)}>Decline / cancel</Button>
                    <Button type="button" onClick={() => setConfirmState({ action: 'accept_proposal', request })} disabled={Boolean(busyId)}>Accept proposed time</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <ConfirmActionModal
          open={Boolean(confirmState)}
          title={confirmState?.action === 'accept_proposal' ? 'Accept coach proposal?' : 'Cancel private coaching request?'}
          description={confirmState?.action === 'accept_proposal' ? 'Please review the proposed session before confirming.' : 'This removes the pending request without using a token.'}
          confirmLabel={confirmState?.action === 'accept_proposal' ? 'Accept & book' : 'Confirm cancel'}
          pendingLabel="Saving…"
          pending={Boolean(confirmState && busyId === confirmState.request.id)}
          summaryItems={confirmSummary(confirmState)}
          warning={confirmState?.action === 'accept_proposal' ? 'Accepting the proposal creates the booking immediately and uses 1 active private coaching token.' : 'No private coaching token will be used.'}
          onCancel={() => { if (!busyId) setConfirmState(null) }}
          onConfirm={async () => { if (confirmState) await runAction(confirmState.request, confirmState.action) }}
        />
      </div>
    )
  }

  const activeRequests = requests.filter((request) => request.status === 'pending' || request.status === 'coach_proposed')
  const recentHistory = requests.filter((request) => request.status !== 'pending' && request.status !== 'coach_proposed').slice(0, 10)

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <div className="rounded-3xl border border-blue-200 bg-blue-50/40 p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold tracking-tight">Member session requests</h4>
            <p className="text-sm text-[hsl(var(--muted))]">Confirm the requested time, propose one alternative, or decline. Tokens are used only when a booking is confirmed.</p>
          </div>
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-800">{activeRequests.length} active</span>
        </div>

        <div className="mt-4 grid gap-3">
          {activeRequests.length === 0 ? <div className="rounded-2xl border border-dashed border-blue-200 bg-white p-3 text-sm text-[hsl(var(--muted))]">No member session request waiting for action.</div> : null}
          {activeRequests.map((request) => {
            const editing = actionRequestId === request.id
            return (
              <div key={request.id} className="rounded-2xl border border-blue-100 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(request.status)}`}>{statusLabel(request.status)}</span>
                      <span className="text-sm font-semibold">{request.member_name}</span>
                      {request.member_meta ? <span className="text-xs text-[hsl(var(--muted))]">{request.member_meta}</span> : null}
                    </div>
                    <div className="mt-3 font-semibold">Requested: {timeLabel(request.requested_date, request.requested_start_time, request.requested_end_time)}</div>
                    {request.member_note ? <div className="mt-1 text-sm text-[hsl(var(--muted))]">Member note: {request.member_note}</div> : null}
                    {request.status === 'coach_proposed' ? <div className="mt-2 text-sm text-blue-800">Waiting for member · Proposed: {timeLabel(request.proposed_date, request.proposed_start_time, request.proposed_end_time)}{request.coach_note ? ` · ${request.coach_note}` : ''}</div> : null}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                    {request.status === 'pending' ? <Button type="button" onClick={() => setConfirmState({ action: 'confirm', request })} disabled={Boolean(busyId)}>Confirm requested time</Button> : null}
                    <Button type="button" variant="outline" onClick={() => openProposal(request)} disabled={Boolean(busyId)}>{request.status === 'coach_proposed' ? 'Update proposal' : 'Propose another time'}</Button>
                    <Button type="button" variant="outline" onClick={() => openDecline(request)} disabled={Boolean(busyId)}>Decline</Button>
                  </div>
                </div>

                {editing && actionMode === 'propose' ? (
                  <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="grid gap-1"><span className="text-sm font-semibold">Proposed date</span><input type="date" min={todayInputValue()} value={proposalDate} onChange={(event) => setProposalDate(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
                      <label className="grid gap-1"><span className="text-sm font-semibold">Start</span><input type="time" value={proposalStart} onChange={(event) => { const value = event.target.value; setProposalStart(value); setProposalEnd(addMinutesToTime(value, 60)) }} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
                      <label className="grid gap-1"><span className="text-sm font-semibold">End</span><input type="time" value={proposalEnd} onChange={(event) => setProposalEnd(event.target.value)} className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
                      <label className="grid gap-1 md:col-span-3"><span className="text-sm font-semibold">Coach note</span><input value={proposalNote} onChange={(event) => setProposalNote(event.target.value)} maxLength={500} placeholder="Optional note" className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
                    </div>
                    <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { setActionRequestId(''); setActionMode('') }} disabled={Boolean(busyId)}>Close</Button><Button type="button" onClick={() => runAction(request, 'propose', { slot_date: proposalDate, start_time: proposalStart, end_time: proposalEnd, note: proposalNote })} loading={busyId === request.id} loadingText="Sending…">Send proposal</Button></div>
                  </div>
                ) : null}

                {editing && actionMode === 'decline' ? (
                  <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/40 p-3">
                    <label className="grid gap-1"><span className="text-sm font-semibold">Reason</span><input value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} maxLength={500} placeholder="Why this request cannot be confirmed" className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
                    <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { setActionRequestId(''); setActionMode('') }} disabled={Boolean(busyId)}>Close</Button><Button type="button" onClick={() => runAction(request, 'decline', { reason: declineReason })} loading={busyId === request.id} loadingText="Declining…" disabled={declineReason.trim().length < 3}>Confirm decline</Button></div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {recentHistory.length > 0 ? (
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <h4 className="text-base font-semibold tracking-tight">Recent request history</h4>
          <div className="mt-3 grid gap-2">
            {recentHistory.map((request) => <div key={request.id} className="flex flex-col gap-1 rounded-2xl border border-[hsl(var(--border))] p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><span className="font-semibold">{request.member_name}</span> · {timeLabel(request.requested_date, request.requested_start_time, request.requested_end_time)}{request.decline_reason ? <div className="text-rose-700">Reason: {request.decline_reason}</div> : null}</div><span className={`w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(request.status)}`}>{statusLabel(request.status)}</span></div>)}
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={Boolean(confirmState)}
        title="Confirm member private coaching request?"
        description="This creates the booking immediately using the member's requested date and time."
        confirmLabel="Confirm & book"
        pendingLabel="Booking…"
        pending={Boolean(confirmState && busyId === confirmState.request.id)}
        summaryItems={confirmSummary(confirmState)}
        warning="Confirming the request consumes 1 active private coaching token. Existing booking conflict checks still apply."
        onCancel={() => { if (!busyId) setConfirmState(null) }}
        onConfirm={async () => { if (confirmState) await runAction(confirmState.request, 'confirm') }}
      />
    </div>
  )
}
