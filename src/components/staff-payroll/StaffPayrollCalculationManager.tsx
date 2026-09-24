'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type StaffProfile = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type CompensationProfile = {
  id: string
  staff_user_id: string
  effective_from: string
  effective_until: string | null
  fixed_monthly_base: number
  weighted_hour_rate: number
  bonus_eligible: boolean
  updated_at: string | null
  task_override_count: number
}

type Snapshot = {
  id: string
  month_start: string
  status: string
  eligible_revenue_scope: string
  rate_model: string
  bonus_pool_percent: number
  variable_payroll_percent: number
  safety_reserve_percent: number
  safety_reserve_amount: number
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
  guaranteed_payroll: number
  fixed_base_payroll: number
  minimum_task_payroll: number
  available_result_after_guaranteed_payroll: number
  performance_bonus_pool: number
  dynamic_task_supplement_pool: number
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
  approval_version_no: number
  approved_at: string | null
  approved_by: string | null
  last_reopened_at: string | null
  last_reopened_by: string | null
  last_reopen_reason: string | null
  integrity_ready: boolean
}

type Calculation = {
  id: string
  snapshot_id: string
  month_start: string
  staff_user_id: string
  staff_name_snapshot: string
  staff_role_snapshot: string | null
  compensation_configured: boolean
  compensation_rate_period_id: string | null
  compensation_effective_from: string | null
  compensation_effective_until: string | null
  fixed_monthly_base: number
  weighted_hour_rate: number
  bonus_eligible: boolean
  active_task_count: number
  missing_hours_task_count: number
  actual_hours: number
  weighted_hours: number
  task_compensation: number
  minimum_task_compensation: number
  dynamic_task_supplement: number
  dynamic_weight_share_percent: number
  guaranteed_compensation: number
  bonus_weight_share_percent: number
  performance_bonus: number
  salary_before_adjustments: number
  manual_bonus: number
  manual_deduction: number
  net_manual_adjustment: number
  calculated_salary: number
  adjustment_breakdown: Array<{
    adjustment_id: string
    adjustment_type: 'bonus' | 'deduction'
    amount: number
    reason: string
    created_at: string
    created_by_name_snapshot: string
  }>
  task_rate_breakdown: Array<{
    task_log_id: string
    task_id: string
    task_name: string
    actual_hours: number
    importance_multiplier: number
    weighted_hours: number
    applied_rate: number
    rate_source: 'default' | 'task_override' | 'catalog_minimum' | 'employee_rate' | 'employee_task_override' | 'variable_pool'
    catalog_minimum_hourly_rate?: number
    employee_floor_hourly_rate?: number
    guaranteed_hourly_rate?: number
    minimum_amount?: number
    dynamic_supplement?: number
    effective_hourly_rate?: number
    amount: number
  }>
  updated_at: string
}

type ApprovalVersion = {
  id: string
  snapshot_id: string
  month_start: string
  version_no: number
  approved_at: string
  approved_by: string | null
  approved_by_name_snapshot: string
  approval_note: string | null
  calculated_payroll_total: number
  staff_count: number
}

type ReopenEvent = {
  id: string
  snapshot_id: string
  approval_version_id: string
  month_start: string
  reopened_at: string
  reopened_by: string | null
  reopened_by_name_snapshot: string
  reason: string
}

type Props = {
  monthStart: string
  staffProfiles: StaffProfile[]
  compensationProfiles: CompensationProfile[]
  snapshot: Snapshot | null
  calculations: Calculation[]
  approvalVersions: ApprovalVersion[]
  reopenEvents: ReopenEvent[]
  canWrite: boolean
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

function staffName(profile: StaffProfile) {
  const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  return name || profile.email || profile.user_id.slice(0, 8)
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

function monthLabel(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, 1))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function previousMonthLabel(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  return monthLabel(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10))
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

export default function StaffPayrollCalculationManager({
  monthStart,
  staffProfiles,
  compensationProfiles,
  snapshot,
  calculations,
  approvalVersions,
  reopenEvents,
  canWrite,
}: Props) {
  const router = useRouter()
  const compensationMap = React.useMemo(
    () => new Map(compensationProfiles.map((profile) => [profile.staff_user_id, profile])),
    [compensationProfiles]
  )

  const [variablePayrollPercent, setVariablePayrollPercent] = React.useState(
    String(snapshot?.variable_payroll_percent ?? snapshot?.bonus_pool_percent ?? 30)
  )
  const [safetyReservePercent, setSafetyReservePercent] = React.useState(
    String(snapshot?.safety_reserve_percent ?? 20)
  )
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [approvalNote, setApprovalNote] = React.useState('')
  const [reopenReason, setReopenReason] = React.useState('')
  const [showReopenForm, setShowReopenForm] = React.useState(false)

  const isApproved = snapshot?.status === 'approved'
  const isVariablePool = snapshot?.rate_model === 'variable_payroll_pool'
  const approvalReady =
    Boolean(snapshot) &&
    !isApproved &&
    snapshot!.missing_hours_task_count === 0 &&
    snapshot!.unconfigured_staff_count === 0 &&
    snapshot!.staff_count > 0 &&
    snapshot!.integrity_ready

  React.useEffect(() => {
    setVariablePayrollPercent(String(snapshot?.variable_payroll_percent ?? snapshot?.bonus_pool_percent ?? 30))
    setSafetyReservePercent(String(snapshot?.safety_reserve_percent ?? 20))
  }, [snapshot?.bonus_pool_percent, snapshot?.variable_payroll_percent, snapshot?.safety_reserve_percent, monthStart])

  async function post(body: any) {
    const response = await fetch('/api/staff-payroll/calculation', {
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

  async function postApproval(body: any) {
    const response = await fetch('/api/staff-payroll/approval', {
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

  async function approvePayroll() {
    if (!snapshot) return

    setPendingKey('approve')
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
        `${monthLabel(monthStart)} payroll approved and locked${payload?.versionNo ? ` · Version ${payload.versionNo}` : ''}.`
      )
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to approve and lock payroll.')
    } finally {
      setPendingKey(null)
    }
  }

  async function reopenPayroll() {
    if (!snapshot) return
    if (reopenReason.trim().length < 3) {
      setError('A reason is required to reopen an approved payroll.')
      return
    }

    setPendingKey('reopen')
    setMessage(null)
    setError(null)

    try {
      await postApproval({
        action: 'reopen',
        snapshotId: snapshot.id,
        reason: reopenReason.trim(),
      })
      setReopenReason('')
      setShowReopenForm(false)
      setMessage(
        `${monthLabel(monthStart)} payroll reopened. Recalculate the draft before any new approval.`
      )
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to reopen payroll.')
    } finally {
      setPendingKey(null)
    }
  }

  async function refreshDraft() {
    if (isApproved) {
      setError('Approved payroll is locked. Reopen it before recalculating.')
      return
    }

    setPendingKey('refresh')
    setMessage(null)
    setError(null)

    try {
      await post({
        action: 'refresh_draft',
        monthStart,
        variablePayrollPercent,
        safetyReservePercent,
      })
      setMessage(`${monthLabel(monthStart)} payroll draft recalculated.`)
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to recalculate payroll draft.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="space-y-5">
      {!canWrite ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <div className="font-semibold">Read-only access</div>
          <div className="mt-1 text-xs">
            Admin can review compensation settings and monthly calculations. Only Super Admin can change rates or recalculate a payroll draft.
          </div>
        </div>
      ) : null}

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

      {snapshot ? (
        <section
          className={
            'rounded-3xl border p-4 sm:p-5 ' +
            (isApproved
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-amber-200 bg-amber-50')
          }
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    'rounded-full px-3 py-1 text-xs font-bold ' +
                    (isApproved
                      ? 'bg-emerald-700 text-white'
                      : 'bg-amber-700 text-white')
                  }
                >
                  {isApproved ? 'Approved & Locked' : 'Draft'}
                </span>
                {snapshot.approval_version_no > 0 ? (
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold">
                    Latest approval version {snapshot.approval_version_no}
                  </span>
                ) : null}
              </div>

              <h2 className="mt-3 text-xl font-bold">
                {isApproved
                  ? `${monthLabel(monthStart)} payroll is locked`
                  : `${monthLabel(monthStart)} payroll approval`}
              </h2>

              <p className="mt-1 max-w-3xl text-sm">
                {isApproved
                  ? 'Monthly task logs and salary calculation rows are protected from modification. The approved version is preserved for audit and future salary payment workflows.'
                  : 'Approval rechecks financial data, monthly tasks, staff settings and calculation integrity before the month can be locked.'}
              </p>

              {isApproved && snapshot.approved_at ? (
                <div className="mt-2 text-xs">
                  Approved {dateTimeLabel(snapshot.approved_at)}
                  {snapshot.approval_version_no
                    ? ` · Version ${snapshot.approval_version_no}`
                    : ''}
                </div>
              ) : null}

              {!isApproved && !snapshot.integrity_ready ? (
                <div className="mt-2 text-xs font-semibold text-amber-900">
                  Recalculate this draft once after applying 1D to generate approval integrity checks.
                </div>
              ) : null}
            </div>

            {canWrite && !isApproved ? (
              <div className="w-full max-w-sm rounded-2xl border border-amber-300 bg-white/70 p-3">
                <label className="block text-xs font-medium">
                  Approval note (optional)
                  <textarea
                    value={approvalNote}
                    onChange={(event) => setApprovalNote(event.target.value)}
                    maxLength={2000}
                    rows={2}
                    disabled={Boolean(pendingKey)}
                    placeholder="Optional internal note for this approval version."
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={approvePayroll}
                  disabled={!approvalReady || Boolean(pendingKey)}
                  className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingKey === 'approve' ? 'Verifying & locking…' : 'Approve & Lock Payroll'}
                </button>
                {!approvalReady ? (
                  <div className="mt-2 text-[11px] text-amber-900">
                    Approval requires configured staff, complete actual hours and a fresh 1D recalculation.
                  </div>
                ) : null}
              </div>
            ) : null}

            {canWrite && isApproved ? (
              <div className="w-full max-w-sm">
                {!showReopenForm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowReopenForm(true)
                      setError(null)
                    }}
                    disabled={Boolean(pendingKey)}
                    className="w-full rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700"
                  >
                    Exceptional Reopen
                  </button>
                ) : (
                  <div className="rounded-2xl border border-rose-300 bg-white p-3">
                    <div className="text-xs font-semibold text-rose-800">
                      Reopen requires a reason and preserves the approved version.
                    </div>
                    <textarea
                      value={reopenReason}
                      onChange={(event) => setReopenReason(event.target.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder="Reason for reopening this approved payroll"
                      className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowReopenForm(false)
                          setReopenReason('')
                        }}
                        disabled={Boolean(pendingKey)}
                        className="flex-1 rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={reopenPayroll}
                        disabled={reopenReason.trim().length < 3 || Boolean(pendingKey)}
                        className="flex-1 rounded-xl bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        {pendingKey === 'reopen' ? 'Reopening…' : 'Confirm Reopen'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
              Effective rates · {monthLabel(monthStart)}
            </div>
            <h2 className="mt-1 text-xl font-bold">Applicable compensation periods</h2>
            <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
              The active period supplies each staff member’s fixed monthly base and variable-pool eligibility. Legacy weighted-hour rates remain stored for approved 2H history but are not used by new 2I calculations.
            </p>
          </div>
          <Link href="/admin/staff-payroll/rates" className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
            {canWrite ? 'Manage rate periods' : 'Review rate periods'}
          </Link>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {staffProfiles.map((staff) => {
            const configured = compensationMap.get(staff.user_id)

            return (
              <div key={staff.user_id} className="rounded-2xl border border-black/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{staffName(staff)}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{roleLabel(staff.role)}</div>
                  </div>
                  <span
                    className={
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
                      (configured
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-900')
                    }
                  >
                    {configured ? 'Configured' : 'Needs configuration'}
                  </span>
                </div>

                {configured ? (
                  <>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Fixed monthly base</div>
                        <div className="mt-1 text-sm font-semibold">{money(configured.fixed_monthly_base)}</div>
                      </div>
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Variable pool</div>
                        <div className="mt-1 text-sm font-semibold">{configured.bonus_eligible ? 'Eligible' : 'Not eligible'}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                      Effective {monthLabel(configured.effective_from)} → {configured.effective_until ? previousMonthLabel(configured.effective_until) : 'open-ended'} · legacy rate preserved: {money(configured.weighted_hour_rate)} / weighted h
                    </div>
                  </>
                ) : (
                  <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-950">
                    No rate period covers this payroll month. Calculation will flag this staff member as unconfigured.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
              {monthLabel(monthStart)}
            </div>
            <h2 className="mt-1 text-xl font-bold">Draft calculation</h2>
            <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
              Membership revenue − paid membership refunds − eligible operating expenses = operating result before payroll.
              Fixed monthly bases are deducted first. A safety reserve protects the remaining positive result, then the selected share becomes the variable payroll pool distributed by weighted task impact.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="text-xs font-medium">
              Variable payroll share
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={variablePayrollPercent}
                  disabled={!canWrite || pendingKey === 'refresh' || isApproved}
                  onChange={(event) => setVariablePayrollPercent(event.target.value)}
                  className="w-28 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]"
                />
                <span className="text-sm font-semibold">%</span>
              </div>
            </label>
            <label className="text-xs font-medium">
              Safety reserve
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min="0" max="100" step="0.01" value={safetyReservePercent} disabled={!canWrite || pendingKey === 'refresh' || isApproved} onChange={(event) => setSafetyReservePercent(event.target.value)} className="w-28 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]" />
                <span className="text-sm font-semibold">%</span>
              </div>
            </label>

            {canWrite ? (
              <button
                type="button"
                onClick={refreshDraft}
                disabled={Boolean(pendingKey) || isApproved}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pendingKey === 'refresh'
                  ? 'Calculating…'
                  : isApproved
                    ? 'Approved & Locked'
                    : snapshot
                      ? 'Recalculate draft'
                      : 'Calculate draft'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
          <strong>Revenue scope:</strong> membership/subscription payments only. External Income, Store revenue and Funding are not included.
          Payroll expense categories already recorded in Expenses (Coaches, Reception, Assistants, Bonuses) are shown separately and excluded from operating expenses to avoid double counting.
          <div className="mt-2 border-t border-violet-200 pt-2">
            <strong>2I formula:</strong> reserve = positive result after fixed bases × reserve %. Variable pool = positive remainder after fixed bases, reserve and committed manual bonuses × variable payroll %.
          </div>
        </div>
      </section>

      {!snapshot ? (
        <section className="rounded-3xl border border-dashed border-black/15 bg-white p-8 text-center">
          <div className="text-lg font-semibold">No payroll draft calculated yet</div>
          <div className="mt-2 text-sm text-[hsl(var(--muted))]">
            Configure staff bases and eligibility, complete monthly tasks, choose the reserve and variable share, then calculate the {monthLabel(monthStart)} draft.
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs text-emerald-900/70">Membership revenue</div>
              <div className="mt-1 text-xl font-bold text-emerald-950">{money(snapshot.membership_revenue)}</div>
              <div className="mt-1 text-xs text-emerald-900/70">{snapshot.membership_payment_count} payments</div>
            </div>

            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-xs text-rose-900/70">Paid membership refunds</div>
              <div className="mt-1 text-xl font-bold text-rose-950">− {money(snapshot.paid_membership_refunds)}</div>
              <div className="mt-1 text-xs text-rose-900/70">{snapshot.paid_membership_refund_count} refunds</div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs text-amber-900/70">Eligible operating expenses</div>
              <div className="mt-1 text-xl font-bold text-amber-950">− {money(snapshot.eligible_operating_expenses)}</div>
              <div className="mt-1 text-xs text-amber-900/70">{snapshot.eligible_expense_count} expense rows</div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Operating result before payroll</div>
              <div className="mt-1 text-xl font-bold">{money(snapshot.operating_result_before_payroll)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Net membership revenue: {money(snapshot.net_membership_revenue)}</div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Salary before manual adjustments</div>
              <div className="mt-1 text-xl font-bold">{money(snapshot.salary_before_adjustments_total)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Fixed bases + variable task pool</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs text-emerald-900/70">Monthly bonuses</div>
              <div className="mt-1 text-xl font-bold text-emerald-950">+ {money(snapshot.manual_bonus_total)}</div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-xs text-rose-900/70">Monthly deductions</div>
              <div className="mt-1 text-xl font-bold text-rose-950">− {money(snapshot.manual_deduction_total)}</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Net manual adjustment</div>
              <div className="mt-1 text-xl font-bold">
                {snapshot.net_manual_adjustment_total >= 0 ? '+' : '−'} {money(Math.abs(snapshot.net_manual_adjustment_total))}
              </div>
              <Link href={`/admin/staff-payroll/adjustments?month=${monthStart.slice(0, 7)}`} className="mt-2 inline-block text-xs font-semibold underline">
                Review bonuses & deductions
              </Link>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Fixed-base payroll floor</div>
              <div className="mt-1 text-xl font-bold">{money(snapshot.guaranteed_payroll)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Guaranteed before variable task compensation</div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Result after fixed bases</div>
              <div className="mt-1 text-xl font-bold">{money(snapshot.available_result_after_guaranteed_payroll)}</div>
            </div>

            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <div className="text-xs text-violet-900/70">{isVariablePool ? 'Variable payroll pool' : snapshot.rate_model === 'dynamic_task_rates' ? 'Dynamic task supplement' : 'Legacy performance bonus'}</div>
              <div className="mt-1 text-xl font-bold text-violet-950">{money(isVariablePool ? snapshot.variable_payroll_pool : snapshot.rate_model === 'dynamic_task_rates' ? snapshot.dynamic_task_supplement_pool : snapshot.performance_bonus_pool)}</div>
              <div className="mt-1 text-xs text-violet-900/70">{isVariablePool ? `${number(snapshot.variable_payroll_percent)}% after ${number(snapshot.safety_reserve_percent)}% reserve · ${money(snapshot.variable_weighted_hour_value)} / weighted h` : snapshot.rate_model === 'dynamic_task_rates' ? `${number(snapshot.bonus_pool_percent)}% after ${number(snapshot.safety_reserve_percent)}% reserve (${money(snapshot.safety_reserve_amount)})` : `${number(snapshot.bonus_pool_percent)}% of positive available result`}</div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs text-emerald-900/70">Calculated payroll total</div>
              <div className="mt-1 text-xl font-bold text-emerald-950">{money(snapshot.calculated_payroll_total)}</div>
              <div className="mt-1 text-xs text-emerald-900/70">
                {isApproved ? `Approved · Version ${snapshot.approval_version_no} · not paid` : 'Draft · not approved / not paid'}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Payroll-type expenses excluded</div>
                <div className="mt-1 font-semibold">{money(snapshot.excluded_payroll_expenses)}</div>
                <div className="text-xs text-[hsl(var(--muted))]">{snapshot.excluded_payroll_expense_count} rows</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Staff in draft</div>
                <div className="mt-1 font-semibold">{snapshot.staff_count}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Tasks missing actual hours</div>
                <div className={snapshot.missing_hours_task_count ? 'mt-1 font-semibold text-amber-700' : 'mt-1 font-semibold text-emerald-700'}>
                  {snapshot.missing_hours_task_count}
                </div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Staff without rate configuration</div>
                <div className={snapshot.unconfigured_staff_count ? 'mt-1 font-semibold text-amber-700' : 'mt-1 font-semibold text-emerald-700'}>
                  {snapshot.unconfigured_staff_count}
                </div>
              </div>
            </div>

            <div className="mt-3 border-t border-black/10 pt-3 text-xs text-[hsl(var(--muted))]">
              Recalculated {dateTimeLabel(snapshot.calculated_at)} · source data as of {dateTimeLabel(snapshot.source_data_as_of)}.
            </div>
          </section>

          {(snapshot.missing_hours_task_count > 0 || snapshot.unconfigured_staff_count > 0) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="font-semibold">Draft requires attention</div>
              <div className="mt-1 text-xs">
                Tasks without actual hours remain visible but contribute 0 weighted hours, and staff without compensation settings are calculated at 0 EGP rates. Complete these items and recalculate before approval.
              </div>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-3xl border border-black/10 bg-white">
            <div className="border-b border-black/10 p-4 sm:p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Staff calculation</div>
              <h2 className="mt-1 text-xl font-bold">Salary preview</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                The variable pool is distributed by weighted-hours impact and included in each task amount. Manual bonuses and deductions are applied afterward.
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
                              Rate not configured for month
                            </span>
                          ) : null}
                          {row.missing_hours_task_count > 0 ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                              {row.missing_hours_task_count} missing-hours task{row.missing_hours_task_count === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {row.active_task_count} tasks · {number(row.actual_hours)} actual h · {number(row.weighted_hours)} weighted h
                        </div>
                        {row.compensation_effective_from ? (
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            Applied rate period: {monthLabel(row.compensation_effective_from)} → {row.compensation_effective_until ? previousMonthLabel(row.compensation_effective_until) : 'open-ended'}
                          </div>
                        ) : null}
                      </div>

                      <div className="text-left lg:text-right">
                        <div className="text-xs text-[hsl(var(--muted))]">Calculated salary</div>
                        <div className="text-2xl font-bold">{money(row.calculated_salary)}</div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Fixed base</div>
                        <div className="mt-1 text-sm font-semibold">{money(row.fixed_monthly_base)}</div>
                      </div>
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Weighted hours</div>
                        <div className="mt-1 text-sm font-semibold">{number(row.weighted_hours)} h</div>
                      </div>
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">{isVariablePool ? 'Pool weight share' : 'Task compensation'}</div>
                        <div className="mt-1 text-sm font-semibold">{isVariablePool ? `${number(row.dynamic_weight_share_percent)}%` : money(row.task_compensation)}</div>
                      </div>
                      <div className="rounded-xl bg-violet-50 p-3">
                        <div className="text-[11px] text-violet-900/70">{isVariablePool ? 'Variable task pay' : snapshot.rate_model === 'dynamic_task_rates' ? 'Dynamic task supplement' : 'Legacy performance bonus'}</div>
                        <div className="mt-1 text-sm font-semibold text-violet-950">{money(isVariablePool ? row.task_compensation : snapshot.rate_model === 'dynamic_task_rates' ? row.dynamic_task_supplement : row.performance_bonus)}</div>
                        <div className="mt-0.5 text-[10px] text-violet-900/70">
                          {row.bonus_eligible ? `${number(row.dynamic_weight_share_percent)}% share` : 'Not variable-pool eligible'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-black/[0.025] p-3">
                        <div className="text-[11px] text-[hsl(var(--muted))]">Before adjustments</div>
                        <div className="mt-1 text-sm font-semibold">{money(row.salary_before_adjustments)}</div>
                        <div className="mt-0.5 text-[10px] text-[hsl(var(--muted))]">
                          + {money(row.manual_bonus)} · − {money(row.manual_deduction)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <div className="text-[11px] text-emerald-900/70">{isApproved ? 'Approved salary' : 'Total draft salary'}</div>
                        <div className="mt-1 text-sm font-bold text-emerald-950">{money(row.calculated_salary)}</div>
                      </div>
                    </div>

                    {row.adjustment_breakdown.length ? (
                      <details className="mt-3 rounded-xl border border-black/10 p-3">
                        <summary className="cursor-pointer text-xs font-semibold">
                          Monthly adjustments · {row.adjustment_breakdown.length} line{row.adjustment_breakdown.length === 1 ? '' : 's'} · net {row.net_manual_adjustment >= 0 ? '+' : '−'} {money(Math.abs(row.net_manual_adjustment))}
                        </summary>
                        <div className="mt-3 space-y-2">
                          {row.adjustment_breakdown.map((item) => (
                            <div key={item.adjustment_id} className="grid gap-1 rounded-lg bg-black/[0.025] p-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                              <div>
                                <div className="font-medium">{item.reason}</div>
                                <div className="text-[hsl(var(--muted))]">{item.adjustment_type === 'bonus' ? 'Bonus' : 'Deduction'} · recorded by {item.created_by_name_snapshot}</div>
                              </div>
                              <div className={item.adjustment_type === 'bonus' ? 'font-semibold text-emerald-800 sm:text-right' : 'font-semibold text-rose-800 sm:text-right'}>
                                {item.adjustment_type === 'bonus' ? '+' : '−'} {money(item.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {row.task_rate_breakdown.length ? (
                      <details className="mt-3 rounded-xl border border-black/10 p-3">
                        <summary className="cursor-pointer text-xs font-semibold">
                          Task distribution · {row.task_rate_breakdown.length} line{row.task_rate_breakdown.length === 1 ? '' : 's'}
                        </summary>
                        <div className="mt-3 space-y-2">
                          {row.task_rate_breakdown.map((item) => (
                            <div key={item.task_log_id} className="grid gap-1 rounded-lg bg-black/[0.025] p-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                              <div>
                                <div className="font-medium">{item.task_name}</div>
                                <div className="text-[hsl(var(--muted))]">
                                  {number(item.actual_hours)} actual h × {number(item.importance_multiplier)} importance = {number(item.weighted_hours)} weighted h
                                </div>
                              </div>
                              <div className="sm:text-right">
                                <div className="font-semibold">{money(item.amount)}</div>
                                <div className="text-[hsl(var(--muted))]">
                                  {isVariablePool ? `Pool value ${money(snapshot.variable_weighted_hour_value)} / weighted h · effective ${money(item.effective_hourly_rate ?? 0)} / actual h` : `Floor ${money(item.guaranteed_hourly_rate ?? item.applied_rate)} / h · dynamic +${money(item.dynamic_supplement ?? 0)} · effective ${money(item.effective_hourly_rate ?? item.applied_rate)} / h`}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-[hsl(var(--muted))]">
                No staff calculations were generated for this month.
              </div>
            )}
          </section>

          {approvalVersions.length ? (
            <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
                Approval history
              </div>
              <h2 className="mt-1 text-xl font-bold">Payroll versions</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Approved versions are preserved permanently. Reopening creates a separate audit event and never rewrites a previous version.
              </p>

              <div className="mt-4 space-y-3">
                {approvalVersions.map((version) => {
                  const reopen = reopenEvents.find(
                    (event) => event.approval_version_id === version.id
                  )
                  const current =
                    isApproved &&
                    snapshot?.approval_version_no === version.version_no

                  return (
                    <div
                      key={version.id}
                      className={
                        'rounded-2xl border p-4 ' +
                        (current
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-black/10 bg-black/[0.015]')
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">Version {version.version_no}</span>
                            {current ? (
                              <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">
                                Current approved version
                              </span>
                            ) : null}
                            {reopen ? (
                              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                Reopened
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            Approved {dateTimeLabel(version.approved_at)} by {version.approved_by_name_snapshot}
                          </div>
                        </div>

                        <div className="text-left sm:text-right">
                          <div className="text-xs text-[hsl(var(--muted))]">Approved payroll</div>
                          <div className="font-bold">{money(version.calculated_payroll_total)}</div>
                          <div className="text-xs text-[hsl(var(--muted))]">{version.staff_count} staff</div>
                        </div>
                      </div>

                      {version.approval_note ? (
                        <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs">
                          Approval note: {version.approval_note}
                        </div>
                      ) : null}

                      {reopen ? (
                        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                          Reopened {dateTimeLabel(reopen.reopened_at)} by {reopen.reopened_by_name_snapshot}
                          <div className="mt-1 font-medium">Reason: {reopen.reason}</div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
            <div className="font-semibold">1D approves and locks payroll; it does not pay salaries.</div>
            <div className="mt-1 text-xs">
              Salary payment tracking, partial payments and payslips are handled in the Payments workflow.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
