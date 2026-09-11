'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type Snapshot = {
  id: string
  month_start: string
  status: string
  approval_version_no: number
  approved_at: string | null
  calculated_payroll_total: number
  staff_count: number
}

type ApprovalVersion = {
  id: string
  snapshot_id: string
  month_start: string
  version_no: number
  approved_at: string
  approved_by_name_snapshot: string
  calculated_payroll_total: number
  staff_count: number
}

type ApprovalCalculation = {
  id: string
  approval_version_id: string
  snapshot_id: string
  month_start: string
  staff_user_id: string
  staff_name_snapshot: string
  staff_role_snapshot: string | null
  fixed_monthly_base: number
  weighted_hour_rate: number
  actual_hours: number
  weighted_hours: number
  task_compensation: number
  performance_bonus: number
  calculated_salary: number
}

type SalaryPayment = {
  id: string
  approval_version_id: string
  approval_calculation_id: string
  snapshot_id: string
  month_start: string
  approval_version_no: number
  staff_user_id: string
  staff_name_snapshot: string
  approved_salary_amount: number
  amount: number
  payment_method: string
  payment_date: string
  reference: string | null
  note: string | null
  status: string
  recorded_at: string
  recorded_by_name_snapshot: string
  reversed_at: string | null
  reversed_by_name_snapshot: string | null
  reversal_reason: string | null
}

type Props = {
  monthStart: string
  snapshot: Snapshot | null
  currentVersion: ApprovalVersion | null
  versions: ApprovalVersion[]
  calculations: ApprovalCalculation[]
  payments: SalaryPayment[]
  canWrite: boolean
}

type PaymentDraft = {
  amount: string
  paymentMethod: 'cash' | 'instapay' | 'bank_transfer'
  paymentDate: string
  reference: string
  note: string
}

function money(value: number) {
  const amount = Number(value ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
  }
}

function number(value: number) {
  return Number(value ?? 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })
}

function monthLabel(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, 1))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function dateTimeLabel(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function roleLabel(role: string | null) {
  switch (role) {
    case 'super_admin':
      return 'Super Admin'
    case 'admin':
      return 'Admin'
    case 'reception':
      return 'Reception'
    case 'head_coach':
      return 'Head Coach'
    case 'assistant_coach':
      return 'Assistant Coach'
    case 'coach':
      return 'Coach'
    default:
      return role || 'Staff'
  }
}

function methodLabel(method: string) {
  switch (method) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank Transfer'
    default:
      return method
  }
}

function cairoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10)
}

function statusFor(due: number, paid: number) {
  const remaining = Math.max(0, due - paid)
  if (due <= 0 || remaining <= 0.005) return 'paid'
  if (paid > 0) return 'partially_paid'
  return 'unpaid'
}

function statusLabel(status: string, due: number) {
  if (due <= 0) return 'No payment due'
  if (status === 'paid') return 'Paid'
  if (status === 'partially_paid') return 'Partially Paid'
  return 'Unpaid'
}

function statusClass(status: string, due: number) {
  if (due <= 0 || status === 'paid') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (status === 'partially_paid') {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function StaffPayrollPaymentsManager({
  monthStart,
  snapshot,
  currentVersion,
  versions,
  calculations,
  payments,
  canWrite,
}: Props) {
  const router = useRouter()
  const today = React.useMemo(() => cairoToday(), [])

  const currentPayments = React.useMemo(
    () =>
      currentVersion
        ? payments.filter((payment) => payment.approval_version_id === currentVersion.id)
        : [],
    [payments, currentVersion]
  )

  const activeCurrentPayments = React.useMemo(
    () => currentPayments.filter((payment) => payment.status === 'active'),
    [currentPayments]
  )

  const paidByCalculation = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const payment of activeCurrentPayments) {
      map.set(
        payment.approval_calculation_id,
        (map.get(payment.approval_calculation_id) ?? 0) + Number(payment.amount ?? 0)
      )
    }
    return map
  }, [activeCurrentPayments])

  const totals = React.useMemo(() => {
    let paid = 0
    let unpaid = 0
    let partial = 0
    let paidStaff = 0

    for (const calculation of calculations) {
      const staffPaid = paidByCalculation.get(calculation.id) ?? 0
      paid += staffPaid
      const status = statusFor(calculation.calculated_salary, staffPaid)
      if (status === 'paid') paidStaff += 1
      else if (status === 'partially_paid') partial += 1
      else unpaid += 1
    }

    const approved = currentVersion?.calculated_payroll_total ?? 0
    return {
      approved,
      paid,
      remaining: Math.max(0, approved - paid),
      paidStaff,
      partial,
      unpaid,
    }
  }, [calculations, paidByCalculation, currentVersion])

  const [drafts, setDrafts] = React.useState<Record<string, PaymentDraft>>(() => {
    const result: Record<string, PaymentDraft> = {}
    for (const calculation of calculations) {
      const paid = paidByCalculation.get(calculation.id) ?? 0
      const remaining = Math.max(0, calculation.calculated_salary - paid)
      result[calculation.id] = {
        amount: remaining > 0 ? String(Math.round(remaining * 100) / 100) : '',
        paymentMethod: 'bank_transfer',
        paymentDate: today,
        reference: '',
        note: '',
      }
    }
    return result
  })

  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reversingPaymentId, setReversingPaymentId] = React.useState<string | null>(null)
  const [reversalReason, setReversalReason] = React.useState('')

  React.useEffect(() => {
    const result: Record<string, PaymentDraft> = {}
    for (const calculation of calculations) {
      const paid = paidByCalculation.get(calculation.id) ?? 0
      const remaining = Math.max(0, calculation.calculated_salary - paid)
      result[calculation.id] = {
        amount: remaining > 0 ? String(Math.round(remaining * 100) / 100) : '',
        paymentMethod: 'bank_transfer',
        paymentDate: today,
        reference: '',
        note: '',
      }
    }
    setDrafts(result)
  }, [calculations, paidByCalculation, today])

  function updateDraft(calculationId: string, patch: Partial<PaymentDraft>) {
    setDrafts((current) => ({
      ...current,
      [calculationId]: {
        ...(current[calculationId] ?? {
          amount: '',
          paymentMethod: 'bank_transfer',
          paymentDate: today,
          reference: '',
          note: '',
        }),
        ...patch,
      },
    }))
  }

  async function post(body: any) {
    const response = await fetch('/api/staff-payroll/payments', {
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

  async function recordPayment(calculation: ApprovalCalculation) {
    const draft = drafts[calculation.id]
    if (!draft) return

    const amount = Number(draft.amount)
    const alreadyPaid = paidByCalculation.get(calculation.id) ?? 0
    const remaining = Math.max(0, calculation.calculated_salary - alreadyPaid)

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    if (amount > remaining + 0.005) {
      setError('Payment cannot exceed the remaining salary due.')
      return
    }
    if (!draft.paymentDate) {
      setError('Payment date is required.')
      return
    }

    setPendingKey(`record:${calculation.id}`)
    setMessage(null)
    setError(null)

    try {
      const payload = await post({
        action: 'record',
        approvalCalculationId: calculation.id,
        amount,
        paymentMethod: draft.paymentMethod,
        paymentDate: draft.paymentDate,
        reference: draft.reference.trim() || null,
        note: draft.note.trim() || null,
      })

      setMessage(
        `Salary payment recorded for ${calculation.staff_name_snapshot}. Remaining: ${money(Number(payload.remainingDue ?? 0))}.`
      )
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to record salary payment.')
    } finally {
      setPendingKey(null)
    }
  }

  async function reversePayment(payment: SalaryPayment) {
    const reason = reversalReason.trim()
    if (reason.length < 3) {
      setError('A reason is required to reverse a salary payment.')
      return
    }

    setPendingKey(`reverse:${payment.id}`)
    setMessage(null)
    setError(null)

    try {
      await post({
        action: 'reverse',
        paymentId: payment.id,
        reason,
      })
      setMessage(
        `Payment of ${money(payment.amount)} for ${payment.staff_name_snapshot} was reversed. The original ledger row remains preserved.`
      )
      setReversingPaymentId(null)
      setReversalReason('')
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to reverse salary payment.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
              Payroll month
            </div>
            <div className="mt-1 text-xl font-bold">{monthLabel(monthStart)}</div>
          </div>

          <form className="flex items-end gap-2" action="/admin/staff-payroll/payments" method="get">
            <label className="text-xs font-medium text-[hsl(var(--muted))]">
              Change month
              <input
                type="month"
                name="month"
                min="2026-08"
                defaultValue={monthStart.slice(0, 7)}
                className="mt-1 block rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white"
            >
              Open
            </button>
          </form>
        </div>
      </section>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {!currentVersion ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">No currently approved payroll for this month</div>
          <div className="mt-1 text-xs">
            Salary payments can only be recorded against the current Approved & Locked payroll version. Previous version history remains visible below.
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Approved payroll</div>
              <div className="mt-1 text-xl font-bold">{money(totals.approved)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Version {currentVersion.version_no}</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs text-emerald-900/70">Paid</div>
              <div className="mt-1 text-xl font-bold text-emerald-900">{money(totals.paid)}</div>
              <div className="mt-1 text-xs text-emerald-900/70">{totals.paidStaff} staff paid</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs text-amber-900/70">Remaining</div>
              <div className="mt-1 text-xl font-bold text-amber-950">{money(totals.remaining)}</div>
              <div className="mt-1 text-xs text-amber-900/70">{totals.partial} partial · {totals.unpaid} unpaid</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Approved</div>
              <div className="mt-1 text-sm font-semibold">{dateTimeLabel(currentVersion.approved_at)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">by {currentVersion.approved_by_name_snapshot}</div>
            </div>
          </section>

          {!canWrite ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              <div className="font-semibold">Read-only access</div>
              <div className="mt-1 text-xs">Admin can view payroll and download salary statements only. Only Super Admin can change salary settings, calculate/approve payroll, or record/reverse salary payments.</div>
            </div>
          ) : null}

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-bold">Staff payment status</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Payments are linked to immutable Approval Version {currentVersion.version_no}.
              </p>
            </div>

            {calculations.map((calculation) => {
              const staffPayments = currentPayments.filter(
                (payment) => payment.approval_calculation_id === calculation.id
              )
              const activePayments = staffPayments.filter((payment) => payment.status === 'active')
              const paid = activePayments.reduce((sum, payment) => sum + payment.amount, 0)
              const remaining = Math.max(0, calculation.calculated_salary - paid)
              const status = statusFor(calculation.calculated_salary, paid)
              const draft = drafts[calculation.id]

              return (
                <article key={calculation.id} className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold">{calculation.staff_name_snapshot}</h3>
                        <span className="rounded-full border border-black/10 bg-black/[0.02] px-2 py-1 text-xs">
                          {roleLabel(calculation.staff_role_snapshot)}
                        </span>
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(status, calculation.calculated_salary)}`}>
                          {statusLabel(status, calculation.calculated_salary)}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                        {number(calculation.weighted_hours)} weighted hours · Task compensation {money(calculation.task_compensation)} · Bonus {money(calculation.performance_bonus)}
                      </div>
                    </div>

                    <div className="space-y-2 sm:min-w-[330px]">
                      <div className="grid grid-cols-3 gap-2 text-right">
                        <div>
                          <div className="text-[11px] text-[hsl(var(--muted))]">Due</div>
                          <div className="font-bold">{money(calculation.calculated_salary)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-[hsl(var(--muted))]">Paid</div>
                          <div className="font-bold text-emerald-700">{money(paid)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-[hsl(var(--muted))]">Remaining</div>
                          <div className="font-bold text-amber-800">{money(remaining)}</div>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <a
                          href={`/api/staff-payroll/statements/${calculation.id}/download`}
                          className="inline-flex items-center rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]"
                        >
                          Download salary statement
                        </a>
                      </div>
                    </div>
                  </div>

                  {staffPayments.length ? (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Payment history</div>
                      {staffPayments.map((payment) => (
                        <div
                          key={payment.id}
                          className={
                            'rounded-2xl border p-3 text-sm ' +
                            (payment.status === 'reversed'
                              ? 'border-slate-200 bg-slate-50 text-slate-600'
                              : 'border-emerald-200 bg-emerald-50/60')
                          }
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="font-semibold">
                                {money(payment.amount)} · {methodLabel(payment.payment_method)} · {payment.payment_date}
                              </div>
                              <div className="mt-1 text-xs">
                                Recorded by {payment.recorded_by_name_snapshot} · {dateTimeLabel(payment.recorded_at)}
                              </div>
                              {payment.reference ? <div className="mt-1 text-xs">Reference: {payment.reference}</div> : null}
                              {payment.note ? <div className="mt-1 text-xs">Note: {payment.note}</div> : null}
                              {payment.status === 'reversed' ? (
                                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2 text-xs">
                                  <strong>Reversed:</strong> {payment.reversal_reason || '—'} · {dateTimeLabel(payment.reversed_at)}
                                  {payment.reversed_by_name_snapshot ? ` · by ${payment.reversed_by_name_snapshot}` : ''}
                                </div>
                              ) : null}
                            </div>

                            {canWrite && payment.status === 'active' ? (
                              reversingPaymentId === payment.id ? (
                                <div className="w-full max-w-sm space-y-2 sm:w-80">
                                  <textarea
                                    value={reversalReason}
                                    onChange={(event) => setReversalReason(event.target.value)}
                                    rows={2}
                                    placeholder="Reason for reversal…"
                                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-xs"
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReversingPaymentId(null)
                                        setReversalReason('')
                                      }}
                                      disabled={pendingKey === `reverse:${payment.id}`}
                                      className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => reversePayment(payment)}
                                      disabled={pendingKey === `reverse:${payment.id}` || reversalReason.trim().length < 3}
                                      className="rounded-xl border border-rose-700 bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      {pendingKey === `reverse:${payment.id}` ? 'Reversing…' : 'Confirm reversal'}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReversingPaymentId(payment.id)
                                    setReversalReason('')
                                    setError(null)
                                  }}
                                  className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                                >
                                  Reverse payment
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {canWrite && remaining > 0.005 && draft ? (
                    <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.015] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Record salary payment</div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <label className="text-xs font-medium">
                          Amount (EGP)
                          <input
                            type="number"
                            min="0.01"
                            max={remaining}
                            step="0.01"
                            value={draft.amount}
                            onChange={(event) => updateDraft(calculation.id, { amount: event.target.value })}
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-medium">
                          Method
                          <select
                            value={draft.paymentMethod}
                            onChange={(event) => updateDraft(calculation.id, { paymentMethod: event.target.value as PaymentDraft['paymentMethod'] })}
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                          >
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="instapay">Instapay</option>
                            <option value="cash">Cash</option>
                          </select>
                        </label>
                        <label className="text-xs font-medium">
                          Payment date
                          <input
                            type="date"
                            max={today}
                            value={draft.paymentDate}
                            onChange={(event) => updateDraft(calculation.id, { paymentDate: event.target.value })}
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-medium">
                          Reference
                          <input
                            value={draft.reference}
                            onChange={(event) => updateDraft(calculation.id, { reference: event.target.value })}
                            placeholder="Optional"
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-medium">
                          Note
                          <input
                            value={draft.note}
                            onChange={(event) => updateDraft(calculation.id, { note: event.target.value })}
                            placeholder="Optional"
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => recordPayment(calculation)}
                          disabled={pendingKey === `record:${calculation.id}`}
                          className="rounded-xl border border-black bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {pendingKey === `record:${calculation.id}` ? 'Recording…' : 'Record payment'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </section>
        </>
      )}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-bold">Month payment ledger</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Full history across every approval version for {monthLabel(monthStart)}. Reversed payments remain visible permanently.
          </p>
        </div>

        {payments.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-black/10 text-xs text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-2 py-2">Version</th>
                  <th className="px-2 py-2">Staff</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Method</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-black/5 last:border-b-0">
                    <td className="px-2 py-3">V{payment.approval_version_no}</td>
                    <td className="px-2 py-3 font-medium">{payment.staff_name_snapshot}</td>
                    <td className="px-2 py-3">{payment.payment_date}</td>
                    <td className="px-2 py-3">{methodLabel(payment.payment_method)}</td>
                    <td className="px-2 py-3 text-right font-semibold">{money(payment.amount)}</td>
                    <td className="px-2 py-3">
                      <span className={payment.status === 'reversed' ? 'text-slate-500' : 'font-semibold text-emerald-700'}>
                        {payment.status === 'reversed' ? 'Reversed' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-black/10 p-6 text-center text-sm text-[hsl(var(--muted))]">
            No salary payments recorded for this month yet.
          </div>
        )}
      </section>

      {versions.length > 0 ? (
        <section className="rounded-2xl border border-black/10 bg-white p-4 text-xs text-[hsl(var(--muted))]">
          Approval history: {versions.map((version) => `V${version.version_no}`).join(' · ')}. Salary payments can only be added to the current approved version.
        </section>
      ) : null}
    </div>
  )
}
