'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Snapshot = {
  id: string
  month_start: string
  status: string
  rate_model: string
  coach_session_rate: number
  head_coach_session_rate: number
  coach_session_count: number
  head_coach_session_count: number
  safety_reserve_percent: number
  safety_reserve_amount: number
  variable_payroll_percent: number
  membership_revenue: number
  membership_payment_count: number
  paid_membership_refunds: number
  paid_membership_refund_count: number
  net_membership_revenue: number
  eligible_operating_expenses: number
  eligible_expense_count: number
  excluded_payroll_expenses: number
  excluded_payroll_expense_count: number
  operating_result_before_payroll: number
  fixed_base_payroll: number
  guaranteed_coaching_payroll: number
  guaranteed_payroll: number
  available_result_after_guaranteed_payroll: number
  variable_payroll_pool: number
  variable_pool_weighted_hours: number
  variable_weighted_hour_value: number
  salary_before_adjustments_total: number
  manual_bonus_total: number
  manual_deduction_total: number
  net_manual_adjustment_total: number
  calculated_payroll_total: number
  staff_count: number
  missing_hours_task_count: number
  unconfigured_staff_count: number
  calculated_at: string
  source_data_as_of: string
  integrity_ready: boolean
}

type Calculation = {
  id: string
  staff_user_id: string
  staff_name_snapshot: string
  staff_role_snapshot: string | null
  compensation_configured: boolean
  active_task_count: number
  missing_hours_task_count: number
  actual_hours: number
  weighted_hours: number
  fixed_monthly_base: number
  coaching_sessions: number
  coaching_session_rate: number
  coaching_guarantee: number
  non_coaching_weighted_hours: number
  non_coaching_variable_pay: number
  salary_before_adjustments: number
  manual_bonus: number
  manual_deduction: number
  calculated_salary: number
}

type Props = {
  monthStart: string
  snapshot: Snapshot | null
  calculations: Calculation[]
  canWrite: boolean
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

function number(value: number) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function pct(value: number) {
  return `${number(value)}%`
}

function monthLabel(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function dateTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function roleLabel(role: string | null) {
  return (role || 'staff')
    .split('_')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub: string
  tone?: 'neutral' | 'violet' | 'emerald' | 'amber'
}) {
  const cls =
    tone === 'violet'
      ? 'border-violet-200 bg-violet-50'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50'
          : 'border-black/10 bg-white'

  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="text-xs text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{sub}</div>
    </div>
  )
}

export default function StaffPayrollHybridOfficialManager({
  monthStart,
  snapshot,
  calculations,
  canWrite,
}: Props) {
  const router = useRouter()
  const isHybrid = snapshot?.rate_model === 'hybrid_payroll'
  const legacyDraft = Boolean(snapshot && snapshot.status === 'draft' && !isHybrid)

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

  React.useEffect(() => {
    if (!isHybrid) return
    setCoachRate(String(snapshot?.coach_session_rate ?? 400))
    setHeadCoachRate(String(snapshot?.head_coach_session_rate ?? 300))
    setSafetyReservePercent(String(snapshot?.safety_reserve_percent ?? 0))
    setResidualPoolPercent(String(snapshot?.variable_payroll_percent ?? 80))
  }, [
    isHybrid,
    monthStart,
    snapshot?.coach_session_rate,
    snapshot?.head_coach_session_rate,
    snapshot?.safety_reserve_percent,
    snapshot?.variable_payroll_percent,
  ])

  async function recalculate() {
    if (!canWrite || snapshot?.status === 'approved') return
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

  const atomResultAfterPayroll = snapshot
    ? Number(snapshot.operating_result_before_payroll || 0) -
      Number(snapshot.calculated_payroll_total || 0)
    : 0

  return (
    <div className="space-y-5">
      {!canWrite ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <div className="font-semibold">Read-only access</div>
          <div className="mt-1 text-xs">
            Admin can review the official hybrid calculation. Only Super Admin can recalculate the draft.
          </div>
        </div>
      ) : null}

      {legacyDraft ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Legacy draft detected</div>
          <div className="mt-1 text-xs">
            This month currently contains a {snapshot?.rate_model || 'legacy'} draft. Recalculating below will replace that draft with the official hybrid model. No approved payroll is changed.
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white">
                Hybrid Official Engine
              </span>
              <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold text-violet-900">
                Draft only · approval disabled in 1A/1B
              </span>
            </div>
            <h2 className="mt-3 text-xl font-bold">
              {monthLabel(monthStart)} official payroll calculation
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
              Coaching is guaranteed per validated session. Coaching weighted hours are excluded from the residual pool. The remaining pool is distributed only across validated non-coaching weighted work.
            </p>
          </div>

          {isHybrid ? (
            <div className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-xs">
              <div className="font-semibold text-violet-950">Current official draft</div>
              <div className="mt-1 text-[hsl(var(--muted))]">
                Coach {money(snapshot?.coach_session_rate || 0)} · Head Coach {money(snapshot?.head_coach_session_rate || 0)}
              </div>
              <div className="text-[hsl(var(--muted))]">
                Reserve {pct(snapshot?.safety_reserve_percent || 0)} · Residual pool {pct(snapshot?.variable_payroll_percent || 0)}
              </div>
            </div>
          ) : null}
        </div>

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
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]"
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
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]"
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
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]"
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
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]"
            />
          </label>
        </div>

        {canWrite ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={recalculate}
              disabled={pending}
              className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Calculating…' : isHybrid ? 'Recalculate official hybrid draft' : 'Create official hybrid draft'}
            </button>
            <div className="text-xs text-[hsl(var(--muted))]">
              This writes a draft only. Approval and payroll lock remain disabled until the approval-integration lot.
            </div>
          </div>
        ) : null}
      </section>

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

      {!isHybrid || !snapshot ? (
        <section className="rounded-3xl border border-dashed border-black/15 bg-white p-8 text-center">
          <div className="text-lg font-semibold">No official hybrid draft yet</div>
          <div className="mt-2 text-sm text-[hsl(var(--muted))]">
            Review the four hybrid parameters above, then create the official draft.
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Membership revenue"
              value={money(snapshot.membership_revenue)}
              sub={`${snapshot.membership_payment_count} payments`}
              tone="emerald"
            />
            <Metric
              label="Paid membership refunds"
              value={`− ${money(snapshot.paid_membership_refunds)}`}
              sub={`${snapshot.paid_membership_refund_count} paid refunds`}
              tone="amber"
            />
            <Metric
              label="Eligible operating expenses"
              value={`− ${money(snapshot.eligible_operating_expenses)}`}
              sub={`${snapshot.eligible_expense_count} eligible expense rows`}
              tone="amber"
            />
            <Metric
              label="Operating result before payroll"
              value={money(snapshot.operating_result_before_payroll)}
              sub={`Net membership revenue ${money(snapshot.net_membership_revenue)}`}
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Guaranteed coaching"
              value={money(snapshot.guaranteed_coaching_payroll)}
              sub={`${number(snapshot.coach_session_count)} Coach sessions + ${number(snapshot.head_coach_session_count)} Head Coach sessions`}
              tone="violet"
            />
            <Metric
              label="Result after guarantees"
              value={money(snapshot.available_result_after_guaranteed_payroll)}
              sub={`Fixed bases ${money(snapshot.fixed_base_payroll)} · reserve ${money(snapshot.safety_reserve_amount)}`}
            />
            <Metric
              label="Non-coaching pool"
              value={money(snapshot.variable_payroll_pool)}
              sub={`${pct(snapshot.variable_payroll_percent)} · ${number(snapshot.variable_pool_weighted_hours)} weighted h · ${money(snapshot.variable_weighted_hour_value)} / h`}
              tone="violet"
            />
            <Metric
              label="ATOM result after payroll"
              value={money(atomResultAfterPayroll)}
              sub={`Payroll total ${money(snapshot.calculated_payroll_total)}`}
              tone="emerald"
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Salary before adjustments"
              value={money(snapshot.salary_before_adjustments_total)}
              sub="Fixed bases + coaching guarantees + non-coaching pool"
            />
            <Metric
              label="Monthly bonuses"
              value={`+ ${money(snapshot.manual_bonus_total)}`}
              sub="Active manual bonuses"
              tone="emerald"
            />
            <Metric
              label="Monthly deductions"
              value={`− ${money(snapshot.manual_deduction_total)}`}
              sub="Active manual deductions"
              tone="amber"
            />
            <Metric
              label="Calculated payroll total"
              value={money(snapshot.calculated_payroll_total)}
              sub={`${snapshot.staff_count} staff · draft only`}
              tone="violet"
            />
          </section>

          {(snapshot.missing_hours_task_count > 0 || snapshot.unconfigured_staff_count > 0) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="font-semibold">Draft requires attention</div>
              <div className="mt-1 text-xs">
                {snapshot.missing_hours_task_count} task(s) are missing actual hours and {snapshot.unconfigured_staff_count} staff member(s) have no applicable compensation period.
              </div>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-3xl border border-black/10 bg-white">
            <div className="border-b border-black/10 p-4 sm:p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
                Hybrid staff calculation
              </div>
              <h2 className="mt-1 text-xl font-bold">Salary preview</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Coaching guarantee and non-coaching weighted compensation are shown separately to make the calculation easy to audit.
              </p>
            </div>

            {calculations.length ? (
              <div className="divide-y divide-black/10">
                {calculations.map((row) => (
                  <article key={row.id} className="p-4 sm:p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold">{row.staff_name_snapshot}</div>
                          <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[11px] font-medium">
                            {roleLabel(row.staff_role_snapshot)}
                          </span>
                          {!row.compensation_configured ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                              Rate period missing
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {row.active_task_count} tasks · {number(row.actual_hours)} actual h · {number(row.weighted_hours)} total weighted h
                        </div>
                      </div>

                      <div className="lg:text-right">
                        <div className="text-xs text-[hsl(var(--muted))]">Calculated salary</div>
                        <div className="text-2xl font-bold">{money(row.calculated_salary)}</div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Fixed base</div>
                        <div className="mt-1 text-sm font-semibold">{money(row.fixed_monthly_base)}</div>
                      </div>
                      <div className="rounded-xl bg-violet-50 p-3">
                        <div className="text-[11px] text-violet-900/70">Coaching sessions</div>
                        <div className="mt-1 text-sm font-semibold text-violet-950">{number(row.coaching_sessions)}</div>
                        <div className="mt-0.5 text-[10px] text-violet-900/70">@ {money(row.coaching_session_rate)}</div>
                      </div>
                      <div className="rounded-xl bg-violet-50 p-3">
                        <div className="text-[11px] text-violet-900/70">Coaching guarantee</div>
                        <div className="mt-1 text-sm font-semibold text-violet-950">{money(row.coaching_guarantee)}</div>
                      </div>
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Non-coaching weighted h</div>
                        <div className="mt-1 text-sm font-semibold">{number(row.non_coaching_weighted_hours)}</div>
                      </div>
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Non-coaching variable</div>
                        <div className="mt-1 text-sm font-semibold">{money(row.non_coaching_variable_pay)}</div>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <div className="text-[11px] text-emerald-900/70">Final salary</div>
                        <div className="mt-1 text-sm font-bold text-emerald-950">{money(row.calculated_salary)}</div>
                      </div>
                    </div>

                    {(row.manual_bonus > 0 || row.manual_deduction > 0) ? (
                      <div className="mt-3 text-xs text-[hsl(var(--muted))]">
                        Before adjustments {money(row.salary_before_adjustments)}
                        {row.manual_bonus > 0 ? ` · bonus +${money(row.manual_bonus)}` : ''}
                        {row.manual_deduction > 0 ? ` · deduction −${money(row.manual_deduction)}` : ''}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-6 text-sm text-[hsl(var(--muted))]">
                No staff calculation rows were generated.
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Payroll expenses excluded</div>
                <div className="mt-1 font-semibold">{money(snapshot.excluded_payroll_expenses)}</div>
                <div className="text-xs text-[hsl(var(--muted))]">{snapshot.excluded_payroll_expense_count} rows</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Integrity</div>
                <div className={`mt-1 font-semibold ${snapshot.integrity_ready ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {snapshot.integrity_ready ? 'Ready' : 'Needs recalculation'}
                </div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Recalculated</div>
                <div className="mt-1 font-semibold">{dateTimeLabel(snapshot.calculated_at)}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Adjustments</div>
                <Link
                  href={`/admin/staff-payroll/adjustments?month=${monthStart.slice(0, 7)}`}
                  className="mt-1 inline-block text-sm font-semibold underline"
                >
                  Review bonuses & deductions
                </Link>
              </div>
            </div>
          </section>

          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
            <div className="font-semibold">Approval intentionally unavailable</div>
            <div className="mt-1 text-xs">
              Hybrid Official Engine 1A/1B only creates and reviews the official draft. The later approval-integration lot will extend immutable approval history to the hybrid fields before approval is enabled.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
