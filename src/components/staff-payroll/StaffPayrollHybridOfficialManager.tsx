'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type Snapshot = {
  id: string
  status: string
  rate_model: string
  staff_count: number
  missing_hours_task_count: number
  unconfigured_staff_count: number
  integrity_ready: boolean
  approval_version_no: number
  approved_at: string | null
  calculated_payroll_total: number
  coach_session_rate: number
  head_coach_session_rate: number
  safety_reserve_percent: number
  variable_payroll_percent: number
}

type Calculation = {
  id: string
  staff_name_snapshot: string
  calculated_salary: number
}

type Props = {
  monthStart: string
  snapshot: Snapshot | null
  calculations: Calculation[]
  canWrite: boolean
}

function monthLabel(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function money(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(Number(value || 0))
  } catch {
    return `${Number(value || 0).toFixed(2)} EGP`
  }
}

export default function StaffPayrollHybridOfficialManager({
  monthStart,
  snapshot,
  calculations,
  canWrite,
}: Props) {
  const router = useRouter()
  const isHybrid = snapshot?.rate_model === 'hybrid_payroll'
  const isApproved = snapshot?.status === 'approved'

  const [coachRate, setCoachRate] = React.useState(
    String(isHybrid ? snapshot?.coach_session_rate ?? 400 : 400)
  )
  const [headCoachRate, setHeadCoachRate] = React.useState(
    String(isHybrid ? snapshot?.head_coach_session_rate ?? 300 : 300)
  )
  const [safetyReservePercent, setSafetyReservePercent] = React.useState(
    String(isHybrid ? snapshot?.safety_reserve_percent ?? 0 : 0)
  )
  const [residualPoolPercent, setResidualPoolPercent] = React.useState(
    String(isHybrid ? snapshot?.variable_payroll_percent ?? 80 : 80)
  )

  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [approvalNote, setApprovalNote] = React.useState('')
  const [reopenReason, setReopenReason] = React.useState('')
  const [showReopen, setShowReopen] = React.useState(false)

  React.useEffect(() => {
    if (!isHybrid) return
    setCoachRate(String(snapshot?.coach_session_rate ?? 400))
    setHeadCoachRate(String(snapshot?.head_coach_session_rate ?? 300))
    setSafetyReservePercent(String(snapshot?.safety_reserve_percent ?? 0))
    setResidualPoolPercent(String(snapshot?.variable_payroll_percent ?? 80))
  }, [
    isHybrid,
    snapshot?.coach_session_rate,
    snapshot?.head_coach_session_rate,
    snapshot?.safety_reserve_percent,
    snapshot?.variable_payroll_percent,
  ])

  const approvalReady =
    Boolean(snapshot) &&
    isHybrid &&
    !isApproved &&
    snapshot!.missing_hours_task_count === 0 &&
    snapshot!.unconfigured_staff_count === 0 &&
    snapshot!.staff_count > 0 &&
    snapshot!.integrity_ready

  async function recalculate() {
    if (!canWrite || isApproved) return
    setPending(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/staff-payroll/hybrid-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh_hybrid_draft',
          monthStart,
          coachRate,
          headCoachRate,
          safetyReservePercent,
          residualPoolPercent,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP_${response.status}`)
      }

      setMessage(`${monthLabel(monthStart)} official hybrid payroll draft recalculated.`)
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to recalculate the hybrid payroll draft.')
    } finally {
      setPending(false)
    }
  }

  async function postApproval(body: any) {
    const response = await fetch('/api/staff-payroll/hybrid-approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.details || payload?.error || `HTTP_${response.status}`)
    }
    return payload
  }

  async function approve() {
    if (!snapshot || !approvalReady) return
    setPending(true)
    setMessage(null)
    setError(null)

    try {
      const payload = await postApproval({
        action: 'approve',
        snapshotId: snapshot.id,
        approvalNote: approvalNote.trim() || null,
      })
      setApprovalNote('')
      setMessage(
        `${monthLabel(monthStart)} hybrid payroll approved${payload?.versionNo ? ` · Version ${payload.versionNo}` : ''}.`
      )
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Approval failed.')
    } finally {
      setPending(false)
    }
  }

  async function reopen() {
    if (!snapshot || !isApproved || reopenReason.trim().length < 3) return
    setPending(true)
    setMessage(null)
    setError(null)

    try {
      await postApproval({
        action: 'reopen',
        snapshotId: snapshot.id,
        reason: reopenReason.trim(),
      })
      setReopenReason('')
      setShowReopen(false)
      setMessage(`${monthLabel(monthStart)} payroll reopened. Recalculate the hybrid draft before approving again.`)
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Reopen failed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-5">
      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white">
            Hybrid Official Engine 1C
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isApproved ? 'bg-emerald-700 text-white' : 'border border-violet-200 bg-white text-violet-900'}`}>
            {isApproved ? 'Approved & Locked' : isHybrid ? 'Official draft' : 'Ready to create draft'}
          </span>
        </div>

        <h2 className="mt-3 text-xl font-bold">{monthLabel(monthStart)} hybrid payroll</h2>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
          Create or recalculate the official hybrid payroll, then approve and lock it once integrity checks are ready.
        </p>

        {!isApproved ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-medium">
                Coach / session
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={coachRate}
                  onChange={(event) => setCoachRate(event.target.value)}
                  disabled={!canWrite || pending}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs font-medium">
                Head Coach / session
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={headCoachRate}
                  onChange={(event) => setHeadCoachRate(event.target.value)}
                  disabled={!canWrite || pending}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs font-medium">
                Safety reserve %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={safetyReservePercent}
                  onChange={(event) => setSafetyReservePercent(event.target.value)}
                  disabled={!canWrite || pending}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs font-medium">
                Residual non-coaching pool %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={residualPoolPercent}
                  onChange={(event) => setResidualPoolPercent(event.target.value)}
                  disabled={!canWrite || pending}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>

            {canWrite ? (
              <button
                type="button"
                onClick={recalculate}
                disabled={pending}
                className="mt-4 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending
                  ? 'Calculating…'
                  : isHybrid
                    ? 'Recalculate official hybrid draft'
                    : 'Create official hybrid draft'}
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      {!isHybrid ? (
        <section className="rounded-3xl border border-dashed border-black/15 bg-white p-8 text-center">
          <div className="text-lg font-semibold">No official hybrid draft yet</div>
          <div className="mt-2 text-sm text-[hsl(var(--muted))]">
            Use the validated parameters above, then click Create official hybrid draft.
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Payroll total</div>
              <div className="mt-1 text-2xl font-bold">{money(snapshot?.calculated_payroll_total ?? 0)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                {calculations.length} staff calculation rows
              </div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Integrity</div>
              <div className="mt-1 text-lg font-bold">
                {snapshot?.integrity_ready ? 'Ready' : 'Needs recalculation'}
              </div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                Missing hours {snapshot?.missing_hours_task_count ?? 0} · Unconfigured staff {snapshot?.unconfigured_staff_count ?? 0}
              </div>
            </div>
          </section>

          {!isApproved ? (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
                    Approval readiness
                  </div>
                  <h3 className="mt-1 text-xl font-bold text-amber-950">
                    Review and lock payroll
                  </h3>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div>Integrity hashes: <strong>{snapshot?.integrity_ready ? 'Ready' : 'Needs recalculation'}</strong></div>
                    <div>Missing hours: <strong>{snapshot?.missing_hours_task_count ?? 0}</strong></div>
                    <div>Unconfigured staff: <strong>{snapshot?.unconfigured_staff_count ?? 0}</strong></div>
                    <div>Staff in draft: <strong>{snapshot?.staff_count ?? 0}</strong></div>
                  </div>
                </div>

                {canWrite ? (
                  <div className="rounded-2xl border border-amber-300 bg-white p-3">
                    <label className="block text-xs font-medium">
                      Approval note (optional)
                      <textarea
                        value={approvalNote}
                        onChange={(event) => setApprovalNote(event.target.value)}
                        rows={3}
                        maxLength={2000}
                        disabled={pending}
                        className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                        placeholder="Optional internal note"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={approve}
                      disabled={!approvalReady || pending}
                      className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                    >
                      {pending ? 'Verifying & locking…' : 'Approve & Lock Hybrid Payroll'}
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
                    Approved & locked
                  </div>
                  <h3 className="mt-1 text-xl font-bold text-emerald-950">
                    {monthLabel(monthStart)} payroll
                  </h3>
                  <div className="mt-1 text-sm text-emerald-950/80">
                    Version {snapshot?.approval_version_no}
                    {snapshot?.approved_at ? ` · Approved ${new Date(snapshot.approved_at).toLocaleString('en-GB')}` : ''}
                  </div>
                </div>

                {canWrite ? (
                  !showReopen ? (
                    <button
                      type="button"
                      onClick={() => setShowReopen(true)}
                      className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700"
                    >
                      Exceptional Reopen
                    </button>
                  ) : (
                    <div className="w-full max-w-sm rounded-2xl border border-rose-300 bg-white p-3">
                      <textarea
                        value={reopenReason}
                        onChange={(event) => setReopenReason(event.target.value)}
                        rows={3}
                        maxLength={1000}
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                        placeholder="Reason for reopening"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowReopen(false)
                            setReopenReason('')
                          }}
                          className="flex-1 rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={reopen}
                          disabled={pending || reopenReason.trim().length < 3}
                          className="flex-1 rounded-xl bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          {pending ? 'Reopening…' : 'Confirm Reopen'}
                        </button>
                      </div>
                    </div>
                  )
                ) : null}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
