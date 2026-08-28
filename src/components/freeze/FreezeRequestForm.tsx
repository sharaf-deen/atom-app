
'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type Mode = 'self' | 'guardian'

type RequestRow = {
  id: string
  requested_start_date: string
  requested_end_date: string | null
  reason: string
  status: 'pending' | 'approved' | 'denied' | 'canceled'
  created_at: string
  admin_note: string | null
  request_source: 'self' | 'guardian' | null
  canceled_at: string | null
  can_cancel: boolean
}

type Eligibility = {
  ok: boolean
  member: { id: string; name: string; date_of_birth: string | null }
  requester: 'self' | 'guardian'
  can_request: boolean
  blocked_reason: string | null
  subscription: null | {
    id: string
    plan: string | null
    status: string | null
    start_date: string
    end_date: string
  }
  allowance: { allowed: number; used: number; remaining: number }
  pending_request: RequestRow | null
  requests: RequestRow[]
  suggested_start_date: string | null
  suggested_end_date: string | null
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusClasses(status: RequestRow['status']) {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'denied') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (status === 'canceled') return 'border-gray-200 bg-gray-50 text-gray-700'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function statusLabel(status: RequestRow['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'denied') return 'Rejected'
  if (status === 'canceled') return 'Cancelled'
  return 'Pending'
}

export default function FreezeRequestForm({
  memberUserId,
  memberName,
  mode,
}: {
  memberUserId: string
  memberName: string
  mode: Mode
}) {
  const [data, setData] = useState<Eligibility | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/freeze-requests?member_id=${encodeURIComponent(memberUserId)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load freeze eligibility.')
      const next = json as Eligibility
      setData(next)
      setFrom(next.suggested_start_date ?? '')
      setTo(next.suggested_end_date ?? '')
    } catch (e: any) {
      setError(e?.message || 'Could not load freeze eligibility.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [memberUserId])

  useEffect(() => { void load() }, [load])

  const requestedDays = useMemo(() => {
    if (!from || !to || from > to) return null
    const a = new Date(`${from}T00:00:00Z`).getTime()
    const b = new Date(`${to}T00:00:00Z`).getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    return Math.floor((b - a) / 86400000) + 1
  }, [from, to])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!data?.subscription) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/freeze-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberUserId,
          subscription_id: data.subscription.id,
          from,
          to,
          reason: reason.trim(),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not submit freeze request.')
      setSuccess('Freeze request sent for review. The subscription has not been changed yet.')
      setReason('')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Could not submit freeze request.')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelPendingRequest() {
    const request = data?.pending_request
    if (!request?.can_cancel) return
    if (!window.confirm('Cancel this pending freeze request?')) return

    setCanceling(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/freeze-requests/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not cancel freeze request.')
      setSuccess('Freeze request cancelled. No subscription change was made.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Could not cancel freeze request.')
    } finally {
      setCanceling(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Freeze self-service</div>
          <h2 className="mt-1 font-semibold">{mode === 'self' ? 'Request a membership freeze' : `Request freeze for ${memberName}`}</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Requests require academy approval. Nothing changes until the request is approved.</p>
        </div>
      </div>

      {loading ? <div className="mt-4 text-sm text-[hsl(var(--muted))]">Checking freeze allowance…</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
      {success ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div> : null}

      {!loading && data ? (
        <div className="mt-4 space-y-4">
          {data.subscription ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm"><div className="text-xs text-[hsl(var(--muted))]">Freeze tokens</div><div className="font-semibold">{data.allowance.allowed}</div></div>
              <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm"><div className="text-xs text-[hsl(var(--muted))]">Used</div><div className="font-semibold">{data.allowance.used}</div></div>
              <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm"><div className="text-xs text-[hsl(var(--muted))]">Remaining</div><div className="font-semibold">{data.allowance.remaining}</div></div>
            </div>
          ) : null}

          {data.pending_request ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">Request pending review</div>
              <div className="mt-1">{fmtDate(data.pending_request.requested_start_date)} → {fmtDate(data.pending_request.requested_end_date)}</div>
              <div className="mt-1 text-amber-800">{data.pending_request.reason}</div>
              {data.pending_request.can_cancel ? (
                <button
                  type="button"
                  onClick={cancelPendingRequest}
                  disabled={canceling}
                  className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
                >
                  {canceling ? 'Cancelling…' : 'Cancel request'}
                </button>
              ) : (
                <div className="mt-2 text-xs text-amber-800">This pending request can only be cancelled by the account that submitted it.</div>
              )}
            </div>
          ) : data.can_request && data.subscription ? (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Freeze start date</span>
                  <input
                    type="date"
                    value={from}
                    min={data.subscription.start_date}
                    max={data.subscription.end_date}
                    onChange={(e) => setFrom(e.target.value)}
                    required
                    className="w-full rounded-xl border bg-white px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Freeze end date</span>
                  <input
                    type="date"
                    value={to}
                    min={from || data.subscription.start_date}
                    max={data.subscription.end_date}
                    onChange={(e) => setTo(e.target.value)}
                    required
                    className="w-full rounded-xl border bg-white px-3 py-2"
                  />
                </label>
              </div>

              <div className="text-xs text-[hsl(var(--muted))]">
                Coverage: {fmtDate(data.subscription.start_date)} → {fmtDate(data.subscription.end_date)} · maximum 30 days per freeze
                {requestedDays !== null ? ` · selected ${requestedDays} day(s)` : ''}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-medium">Reason</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  placeholder="Explain why this freeze is requested."
                  className="w-full rounded-xl border bg-white px-3 py-2"
                />
              </label>

              <button
                type="submit"
                disabled={submitting || requestedDays === null || requestedDays < 1 || requestedDays > 30}
                className="inline-flex rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Submit freeze request'}
              </button>
            </form>
          ) : (
            <div className="rounded-xl border bg-gray-50 p-4 text-sm text-[hsl(var(--muted))]">
              {data.blocked_reason || 'Freeze is not available for this membership.'}
            </div>
          )}

          {data.requests.length > 0 ? (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">Freeze request history ({data.requests.length})</summary>
              <div className="mt-3 space-y-2">
                {data.requests.map((request) => (
                  <div key={request.id} className="rounded-xl border bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{fmtDate(request.requested_start_date)} → {fmtDate(request.requested_end_date)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses(request.status)}`}>{statusLabel(request.status)}</span>
                    </div>
                    <div className="mt-1 text-[hsl(var(--muted))]">{request.reason}</div>
                    {request.admin_note ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Academy note: {request.admin_note}</div> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
