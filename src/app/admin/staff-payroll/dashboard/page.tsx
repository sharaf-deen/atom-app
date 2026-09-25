// Staff Payroll 2L — Payroll Dashboard & Monthly Close Summary
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  BadgeDollarSign,
  Banknote,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Gauge,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = { month?: string | string[] }

type SnapshotRow = {
  id: string
  month_start: string
  status: string
  approval_version_no: number | null
  membership_revenue: number | null
  paid_membership_refunds: number | null
  net_membership_revenue: number | null
  eligible_operating_expenses: number | null
  operating_result_before_payroll: number | null
  fixed_base_payroll: number | null
  guaranteed_payroll: number | null
  safety_reserve_percent: number | null
  safety_reserve_amount: number | null
  variable_payroll_percent: number | null
  variable_payroll_pool: number | null
  calculated_payroll_total: number | null
  staff_count: number | null
  missing_hours_task_count: number | null
  unconfigured_staff_count: number | null
  approved_at: string | null
  calculated_at: string | null
}

type ApprovalVersionRow = {
  id: string
  snapshot_id: string
  month_start: string
  version_no: number
  approved_at: string
  approved_by_name_snapshot: string | null
  calculated_payroll_total: number | null
  staff_count: number | null
}

type PaymentRow = {
  id: string
  approval_version_id: string
  approval_calculation_id: string
  month_start: string
  approval_version_no: number
  amount: number
  status: string
}

type CloseoutRow = {
  id: string
  approval_version_id: string
  month_start: string
  approval_version_no: number
  status: string
  active_payment_total: number
  active_payment_count: number
  staff_count: number
  closed_at: string
  closed_by_name_snapshot: string
  closeout_note: string | null
  reopened_at: string | null
  reopened_by_name_snapshot: string | null
  reopen_reason: string | null
}

type ApprovalCalculationRow = {
  id: string
  approval_version_id: string
  staff_user_id: string
  staff_name_snapshot: string
  calculated_salary: number
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function cairoMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (year && month) return `${year}-${month}`
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousCairoMonth() {
  return shiftMonth(cairoMonth(), -1)
}

function normalizeClosedMonth(value: string) {
  const fallback = previousCairoMonth()
  if (!/^\d{4}-\d{2}$/.test(value)) return fallback
  const [year, month] = value.split('-').map(Number)
  if (year < 2026 || year > 2200 || month < 1 || month > 12) return fallback
  const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  if (normalized < '2026-08') return '2026-08'
  if (normalized > fallback) return fallback
  return normalized
}

function monthLabel(value: string) {
  const normalized = value.slice(0, 7)
  const [year, month] = normalized.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function shortMonthLabel(value: string) {
  const normalized = value.slice(0, 7)
  const [year, month] = normalized.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    year: '2-digit',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function money(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(Number(value ?? 0))
  } catch {
    return `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
  }
}

function number(value: number) {
  return Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function percent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${number(value)}%`
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function ratio(payroll: number, netRevenue: number) {
  if (netRevenue <= 0) return null
  return (payroll / netRevenue) * 100
}

function ratioTone(value: number | null) {
  if (value == null) return 'border-slate-200 bg-slate-50 text-slate-700'
  if (value > 65) return 'border-rose-200 bg-rose-50 text-rose-900'
  if (value > 50) return 'border-amber-200 bg-amber-50 text-amber-950'
  return 'border-emerald-200 bg-emerald-50 text-emerald-900'
}

function workflowStatus(args: {
  snapshot: SnapshotRow | null
  paidTotal: number
  remainingDue: number
  closed: boolean
  latestCloseout: CloseoutRow | null
}) {
  const { snapshot, paidTotal, remainingDue, closed, latestCloseout } = args
  if (!snapshot) return { label: 'Not calculated', tone: 'neutral' as const }
  if (snapshot.status !== 'approved') return { label: 'Draft', tone: 'warning' as const }
  if (closed) return { label: 'Closed', tone: 'closed' as const }
  if (latestCloseout?.status === 'reopened') {
    return { label: 'Closeout reopened', tone: 'warning' as const }
  }
  if (remainingDue <= 0.005) return { label: 'Ready to close', tone: 'ready' as const }
  if (paidTotal > 0) return { label: 'Payments in progress', tone: 'warning' as const }
  return { label: 'Approved · unpaid', tone: 'neutral' as const }
}

function statusClass(tone: 'neutral' | 'warning' | 'ready' | 'closed') {
  if (tone === 'closed') return 'border-emerald-200 bg-emerald-700 text-white'
  if (tone === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default async function StaffPayrollDashboardPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/dashboard')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Dashboard</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access the Staff Payroll dashboard."
            nextPath="/admin/staff-payroll/dashboard"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Dashboard</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const selectedMonth = normalizeClosedMonth(first(searchParams?.month).trim())
  const monthStart = `${selectedMonth}-01`
  const historyStartMonth = shiftMonth(selectedMonth, -5)
  const historyStart = `${historyStartMonth}-01`

  const [snapshotsResult, versionsResult, paymentsResult, closeoutsResult] = await Promise.all([
    admin
      .from('staff_payroll_monthly_snapshots')
      .select(
        'id,month_start,status,approval_version_no,membership_revenue,paid_membership_refunds,net_membership_revenue,eligible_operating_expenses,operating_result_before_payroll,fixed_base_payroll,guaranteed_payroll,safety_reserve_percent,safety_reserve_amount,variable_payroll_percent,variable_payroll_pool,calculated_payroll_total,staff_count,missing_hours_task_count,unconfigured_staff_count,approved_at,calculated_at'
      )
      .gte('month_start', historyStart)
      .lte('month_start', monthStart)
      .order('month_start', { ascending: false }),
    admin
      .from('staff_payroll_approval_versions')
      .select(
        'id,snapshot_id,month_start,version_no,approved_at,approved_by_name_snapshot,calculated_payroll_total,staff_count'
      )
      .gte('month_start', historyStart)
      .lte('month_start', monthStart)
      .order('approved_at', { ascending: false }),
    admin
      .from('staff_payroll_salary_payments')
      .select(
        'id,approval_version_id,approval_calculation_id,month_start,approval_version_no,amount,status'
      )
      .gte('month_start', historyStart)
      .lte('month_start', monthStart)
      .limit(50000),
    admin
      .from('staff_payroll_payment_closeouts')
      .select(
        'id,approval_version_id,month_start,approval_version_no,status,active_payment_total,active_payment_count,staff_count,closed_at,closed_by_name_snapshot,closeout_note,reopened_at,reopened_by_name_snapshot,reopen_reason'
      )
      .gte('month_start', historyStart)
      .lte('month_start', monthStart)
      .order('closed_at', { ascending: false }),
  ])

  const loadError =
    snapshotsResult.error?.message ||
    versionsResult.error?.message ||
    paymentsResult.error?.message ||
    closeoutsResult.error?.message ||
    ''

  const snapshots = ((snapshotsResult.data ?? []) as SnapshotRow[]).map((row) => ({
    ...row,
    approval_version_no: Number(row.approval_version_no ?? 0),
    membership_revenue: Number(row.membership_revenue ?? 0),
    paid_membership_refunds: Number(row.paid_membership_refunds ?? 0),
    net_membership_revenue: Number(row.net_membership_revenue ?? 0),
    eligible_operating_expenses: Number(row.eligible_operating_expenses ?? 0),
    operating_result_before_payroll: Number(row.operating_result_before_payroll ?? 0),
    fixed_base_payroll: Number(row.fixed_base_payroll ?? row.guaranteed_payroll ?? 0),
    guaranteed_payroll: Number(row.guaranteed_payroll ?? 0),
    safety_reserve_percent: Number(row.safety_reserve_percent ?? 0),
    safety_reserve_amount: Number(row.safety_reserve_amount ?? 0),
    variable_payroll_percent: Number(row.variable_payroll_percent ?? 0),
    variable_payroll_pool: Number(row.variable_payroll_pool ?? 0),
    calculated_payroll_total: Number(row.calculated_payroll_total ?? 0),
    staff_count: Number(row.staff_count ?? 0),
    missing_hours_task_count: Number(row.missing_hours_task_count ?? 0),
    unconfigured_staff_count: Number(row.unconfigured_staff_count ?? 0),
  }))
  const versions = ((versionsResult.data ?? []) as ApprovalVersionRow[]).map((row) => ({
    ...row,
    version_no: Number(row.version_no ?? 0),
    calculated_payroll_total: Number(row.calculated_payroll_total ?? 0),
    staff_count: Number(row.staff_count ?? 0),
  }))
  const payments = ((paymentsResult.data ?? []) as PaymentRow[]).map((row) => ({
    ...row,
    approval_version_no: Number(row.approval_version_no ?? 0),
    amount: Number(row.amount ?? 0),
  }))
  const closeouts = ((closeoutsResult.data ?? []) as CloseoutRow[]).map((row) => ({
    ...row,
    approval_version_no: Number(row.approval_version_no ?? 0),
    active_payment_total: Number(row.active_payment_total ?? 0),
    active_payment_count: Number(row.active_payment_count ?? 0),
    staff_count: Number(row.staff_count ?? 0),
  }))

  const selectedSnapshot =
    snapshots.find((row) => String(row.month_start).slice(0, 7) === selectedMonth) ?? null
  const selectedVersion = selectedSnapshot?.status === 'approved'
    ? versions.find(
        (row) =>
          row.snapshot_id === selectedSnapshot.id &&
          row.version_no === Number(selectedSnapshot.approval_version_no ?? 0)
      ) ?? null
    : null

  const currentVersionIds = snapshots
    .filter((snapshot) => snapshot.status === 'approved')
    .map((snapshot) =>
      versions.find(
        (version) =>
          version.snapshot_id === snapshot.id &&
          version.version_no === Number(snapshot.approval_version_no ?? 0)
      )?.id
    )
    .filter((value): value is string => Boolean(value))

  let calculationsResult: any = { data: [], error: null }
  if (currentVersionIds.length) {
    calculationsResult = await admin
      .from('staff_payroll_approval_calculations')
      .select('id,approval_version_id,staff_user_id,staff_name_snapshot,calculated_salary')
      .in('approval_version_id', currentVersionIds)
      .order('staff_name_snapshot', { ascending: true })
  }

  const calculations = ((calculationsResult.data ?? []) as ApprovalCalculationRow[]).map((row) => ({
    ...row,
    calculated_salary: Number(row.calculated_salary ?? 0),
  }))
  const calculationError = calculationsResult.error?.message || ''
  const selectedCalculations = selectedVersion
    ? calculations.filter((row) => row.approval_version_id === selectedVersion.id)
    : []

  const selectedPayments = selectedVersion
    ? payments.filter(
        (row) => row.approval_version_id === selectedVersion.id && row.status === 'active'
      )
    : []
  const paidByCalculation = new Map<string, number>()
  for (const payment of selectedPayments) {
    paidByCalculation.set(
      payment.approval_calculation_id,
      (paidByCalculation.get(payment.approval_calculation_id) ?? 0) + payment.amount
    )
  }

  let paidStaff = 0
  let partialStaff = 0
  let unpaidStaff = 0
  for (const calculation of selectedCalculations) {
    const due = Math.max(0, calculation.calculated_salary)
    const paid = paidByCalculation.get(calculation.id) ?? 0
    const remaining = Math.max(0, due - paid)
    if (due <= 0 || remaining <= 0.005) paidStaff += 1
    else if (paid > 0) partialStaff += 1
    else unpaidStaff += 1
  }

  const selectedPaidTotal = selectedPayments.reduce((sum, row) => sum + row.amount, 0)
  const payrollTotal = Number(selectedSnapshot?.calculated_payroll_total ?? 0)
  const payableSalaryTotal = selectedCalculations.length
    ? selectedCalculations.reduce(
        (sum, row) => sum + Math.max(0, row.calculated_salary),
        0
      )
    : payrollTotal
  const selectedRemainingDue = Math.max(0, payableSalaryTotal - selectedPaidTotal)
  const selectedCloseouts = selectedVersion
    ? closeouts.filter((row) => row.approval_version_id === selectedVersion.id)
    : []
  const currentClosedCloseout =
    selectedCloseouts.find((row) => row.status === 'closed') ?? null
  const latestCloseout = selectedCloseouts[0] ?? null
  const selectedStatus = workflowStatus({
    snapshot: selectedSnapshot,
    paidTotal: selectedPaidTotal,
    remainingDue: selectedRemainingDue,
    closed: Boolean(currentClosedCloseout),
    latestCloseout,
  })

  const netRevenue = Number(selectedSnapshot?.net_membership_revenue ?? 0)
  const operatingResult = Number(selectedSnapshot?.operating_result_before_payroll ?? 0)
  const atomResultAfterPayroll = operatingResult - payrollTotal
  const payrollRatio = ratio(payrollTotal, netRevenue)

  const blockers: Array<{ label: string; href?: string }> = []
  if (!selectedSnapshot) {
    blockers.push({
      label: 'No payroll calculation exists for this month.',
      href: `/admin/staff-payroll/calculation?month=${selectedMonth}`,
    })
  } else if (selectedSnapshot.status === 'approved' && !selectedVersion) {
    blockers.push({
      label: 'The approved payroll version could not be loaded. Review Salary Calculation before continuing.',
      href: `/admin/staff-payroll/calculation?month=${selectedMonth}`,
    })
  } else if (selectedSnapshot.status !== 'approved') {
    if (Number(selectedSnapshot.missing_hours_task_count ?? 0) > 0) {
      blockers.push({
        label: `${selectedSnapshot.missing_hours_task_count} task${selectedSnapshot.missing_hours_task_count === 1 ? '' : 's'} still missing actual hours.`,
        href: `/admin/staff-payroll/monthly-tasks?month=${selectedMonth}`,
      })
    }
    if (Number(selectedSnapshot.unconfigured_staff_count ?? 0) > 0) {
      blockers.push({
        label: `${selectedSnapshot.unconfigured_staff_count} staff compensation configuration${selectedSnapshot.unconfigured_staff_count === 1 ? '' : 's'} missing.`,
        href: '/admin/staff-payroll/rates',
      })
    }
    blockers.push({
      label: 'Payroll draft still requires approval before salary payments can be finalized.',
      href: `/admin/staff-payroll/calculation?month=${selectedMonth}`,
    })
  } else if (selectedRemainingDue > 0.005) {
    blockers.push({
      label: `${money(selectedRemainingDue)} remains unpaid before payment closeout can be completed.`,
      href: `/admin/staff-payroll/payments?month=${selectedMonth}`,
    })
  } else if (!currentClosedCloseout) {
    blockers.push({
      label:
        latestCloseout?.status === 'reopened'
          ? 'The previous payment closeout was reopened. Close the payment cycle again after confirming the ledger.'
          : 'Payroll is fully paid and ready for final payment closeout.',
      href: `/admin/staff-payroll/payments?month=${selectedMonth}`,
    })
  }

  const historyMonths = Array.from({ length: 6 }, (_, index) =>
    shiftMonth(selectedMonth, index - 5)
  )
    .filter((month) => month >= '2026-08')
    .reverse()

  const history = historyMonths.map((month) => {
    const snapshot = snapshots.find((row) => String(row.month_start).slice(0, 7) === month) ?? null
    const version = snapshot?.status === 'approved'
      ? versions.find(
          (row) =>
            row.snapshot_id === snapshot.id &&
            row.version_no === Number(snapshot.approval_version_no ?? 0)
        ) ?? null
      : null
    const activePayments = version
      ? payments.filter((row) => row.approval_version_id === version.id && row.status === 'active')
      : []
    const paid = activePayments.reduce((sum, row) => sum + row.amount, 0)
    const payroll = Number(snapshot?.calculated_payroll_total ?? 0)
    const versionCalculations = version
      ? calculations.filter((calculation) => calculation.approval_version_id === version.id)
      : []
    const payable = versionCalculations.length
      ? versionCalculations.reduce(
          (sum, calculation) => sum + Math.max(0, calculation.calculated_salary),
          0
        )
      : payroll
    const remaining = Math.max(0, payable - paid)
    const monthCloseouts = version
      ? closeouts.filter((row) => row.approval_version_id === version.id)
      : []
    const closed = monthCloseouts.some((row) => row.status === 'closed')
    const latest = monthCloseouts[0] ?? null
    return {
      month,
      snapshot,
      paid,
      payroll,
      remaining,
      payrollRatio: ratio(payroll, Number(snapshot?.net_membership_revenue ?? 0)),
      status: workflowStatus({ snapshot, paidTotal: paid, remainingDue: remaining, closed, latestCloseout: latest }),
    }
  })

  const quickLinks = [
    {
      label: 'Salary Calculation',
      href: `/admin/staff-payroll/calculation?month=${selectedMonth}`,
      icon: Calculator,
    },
    {
      label: 'Simulator',
      href: `/admin/staff-payroll/simulator?month=${selectedMonth}`,
      icon: Gauge,
    },
    {
      label: 'Payments',
      href: `/admin/staff-payroll/payments?month=${selectedMonth}`,
      icon: Banknote,
    },
    {
      label: 'Accounting',
      href: `/admin/staff-payroll/accounting?month=${selectedMonth}`,
      icon: BadgeDollarSign,
    },
  ]

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 2L
              </span>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (canWrite
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800')
                }
              >
                {canWrite ? 'Super Admin · dashboard & controls' : 'Admin · read-only'}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              Payroll Dashboard & Monthly Close Summary
            </h1>
            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              One read-only operational view of payroll health, payment completion, closeout status and recent monthly trends.
            </p>
          </div>

          <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="text-sm font-medium">
              Payroll month
              <input
                type="month"
                name="month"
                min="2026-08"
                max={previousCairoMonth()}
                defaultValue={selectedMonth}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-[210px]"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Load dashboard
            </button>
          </form>
        </div>
      </section>

      {loadError || calculationError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Payroll dashboard could not load completely: {loadError || calculationError}
        </div>
      ) : null}

      <section className="flex flex-col gap-3 rounded-3xl border border-black/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
            Monthly status
          </div>
          <div className="mt-1 text-xl font-bold">{monthLabel(selectedMonth)}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
            {selectedSnapshot?.status === 'approved'
              ? `Approval version ${selectedSnapshot.approval_version_no}`
              : selectedSnapshot
                ? 'Payroll draft exists'
                : 'No payroll draft yet'}
          </div>
        </div>
        <div
          className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${statusClass(selectedStatus.tone)}`}
        >
          {selectedStatus.tone === 'closed' ? <LockKeyhole size={16} /> : null}
          {selectedStatus.tone === 'ready' ? <CheckCircle2 size={16} /> : null}
          {selectedStatus.tone === 'warning' ? <CircleAlert size={16} /> : null}
          {selectedStatus.tone === 'neutral' ? <Clock3 size={16} /> : null}
          {selectedStatus.label}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            Net membership revenue
          </div>
          <div className="mt-2 text-2xl font-bold">{selectedSnapshot ? money(netRevenue) : '—'}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {selectedSnapshot
              ? `${money(Number(selectedSnapshot.membership_revenue ?? 0))} gross · − ${money(Number(selectedSnapshot.paid_membership_refunds ?? 0))} refunds`
              : 'No snapshot'}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            Payroll total
          </div>
          <div className="mt-2 text-2xl font-bold">{selectedSnapshot ? money(payrollTotal) : '—'}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {selectedSnapshot ? `${selectedSnapshot.staff_count} staff in calculation` : 'Not calculated'}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            Paid / remaining
          </div>
          <div className="mt-2 text-2xl font-bold">{selectedVersion ? money(selectedPaidTotal) : '—'}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {selectedVersion ? `${money(selectedRemainingDue)} remaining` : 'Available after approval'}
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${ratioTone(payrollRatio)}`}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
            <TrendingUp size={15} /> Payroll / net revenue
          </div>
          <div className="mt-2 text-2xl font-bold">{percent(payrollRatio)}</div>
          <div className="mt-1 text-xs opacity-80">
            {payrollRatio == null
              ? 'Net revenue unavailable'
              : payrollRatio > 65
                ? 'Above reinforced 65% guardrail'
                : payrollRatio > 50
                  ? 'Above 50% payroll guardrail'
                  : 'Within 50% payroll guardrail'}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Operating result before payroll</div>
          <div className="mt-1 text-xl font-bold">{selectedSnapshot ? money(operatingResult) : '—'}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            After eligible operating expenses
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-900/70">
            <ShieldCheck size={15} /> Protected reserve
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-950">
            {selectedSnapshot ? money(Number(selectedSnapshot.safety_reserve_amount ?? 0)) : '—'}
          </div>
          <div className="mt-1 text-xs text-emerald-900/70">
            {selectedSnapshot ? `${number(Number(selectedSnapshot.safety_reserve_percent ?? 0))}% safety reserve` : 'No snapshot'}
          </div>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <div className="text-xs text-violet-900/70">Variable payroll pool</div>
          <div className="mt-1 text-xl font-bold text-violet-950">
            {selectedSnapshot ? money(Number(selectedSnapshot.variable_payroll_pool ?? 0)) : '—'}
          </div>
          <div className="mt-1 text-xs text-violet-900/70">
            {selectedSnapshot ? `${number(Number(selectedSnapshot.variable_payroll_percent ?? 0))}% variable payroll` : 'No snapshot'}
          </div>
        </div>
        <div className={atomResultAfterPayroll < 0 ? 'rounded-2xl border border-rose-200 bg-rose-50 p-4' : 'rounded-2xl border border-sky-200 bg-sky-50 p-4'}>
          <div className={atomResultAfterPayroll < 0 ? 'text-xs text-rose-900/70' : 'text-xs text-sky-900/70'}>
            ATOM result after payroll
          </div>
          <div className={atomResultAfterPayroll < 0 ? 'mt-1 text-xl font-bold text-rose-950' : 'mt-1 text-xl font-bold text-sky-950'}>
            {selectedSnapshot ? money(atomResultAfterPayroll) : '—'}
          </div>
          <div className={atomResultAfterPayroll < 0 ? 'mt-1 text-xs text-rose-900/70' : 'mt-1 text-xs text-sky-900/70'}>
            Operating result minus calculated payroll
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
                Monthly close summary
              </div>
              <h2 className="mt-1 text-xl font-bold">Approval → payment → closeout</h2>
            </div>
            {currentClosedCloseout ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white">
                <LockKeyhole size={14} /> Payment cycle closed
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl bg-black/[0.025] p-3">
              <div className="text-xs text-[hsl(var(--muted))]">Approved by</div>
              <div className="mt-1 text-sm font-semibold">
                {selectedVersion?.approved_by_name_snapshot || '—'}
              </div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                {dateTimeLabel(selectedVersion?.approved_at)}
              </div>
            </div>
            <div className="rounded-2xl bg-black/[0.025] p-3">
              <div className="text-xs text-[hsl(var(--muted))]">Closeout by</div>
              <div className="mt-1 text-sm font-semibold">
                {currentClosedCloseout?.closed_by_name_snapshot || '—'}
              </div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                {dateTimeLabel(currentClosedCloseout?.closed_at)}
              </div>
            </div>
            <div className="rounded-2xl bg-black/[0.025] p-3">
              <div className="text-xs text-[hsl(var(--muted))]">Active payments</div>
              <div className="mt-1 text-sm font-semibold">{selectedPayments.length}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                {money(selectedPaidTotal)} recorded
              </div>
            </div>
          </div>

          {selectedVersion ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-xs text-emerald-900/70">
                  <CheckCircle2 size={14} /> Paid staff
                </div>
                <div className="mt-1 text-xl font-bold text-emerald-950">{paidStaff}</div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-xs text-amber-900/70">
                  <Clock3 size={14} /> Partially paid
                </div>
                <div className="mt-1 text-xl font-bold text-amber-950">{partialStaff}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <UsersRound size={14} /> Unpaid staff
                </div>
                <div className="mt-1 text-xl font-bold text-slate-950">{unpaidStaff}</div>
              </div>
            </div>
          ) : null}

          {latestCloseout?.status === 'reopened' && !currentClosedCloseout ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="font-semibold">Previous closeout reopened</div>
              <div className="mt-1 text-xs">
                {dateTimeLabel(latestCloseout.reopened_at)}
                {latestCloseout.reopened_by_name_snapshot
                  ? ` by ${latestCloseout.reopened_by_name_snapshot}`
                  : ''}
                {' · '}
                {latestCloseout.reopen_reason || 'No reason recorded'}
              </div>
            </div>
          ) : null}

          {currentClosedCloseout?.closeout_note ? (
            <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                Closeout note
              </div>
              <div className="mt-1">{currentClosedCloseout.closeout_note}</div>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
              Attention
            </div>
            <h2 className="mt-1 text-lg font-bold">Current blockers</h2>
            {blockers.length ? (
              <div className="mt-3 space-y-2">
                {blockers.map((item) => (
                  <div key={item.label} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <div className="flex items-start gap-2">
                      <CircleAlert size={16} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div>{item.label}</div>
                        {item.href ? (
                          <Link href={item.href} className="mt-1 inline-block text-xs font-semibold underline">
                            Open related workflow
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={16} /> No payroll blocker for this month.
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
              Shortcuts
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {quickLinks.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center gap-2 rounded-xl border border-black/10 p-3 text-sm font-semibold hover:bg-black/[0.025]"
                  >
                    <Icon size={16} /> {item.label}
                  </Link>
                )
              })}
            </div>
          </section>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
                Recent trend
              </div>
              <h2 className="mt-1 text-xl font-bold">Six-month payroll comparison</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Compare payroll size, net revenue, payment completion and closeout state without changing historical data.
              </p>
            </div>
            <Gauge size={22} className="text-[hsl(var(--muted))]" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="border-b border-black/10 bg-black/[0.015] text-xs text-[hsl(var(--muted))]">
              <tr>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Net revenue</th>
                <th className="px-4 py-3 text-right">Payroll</th>
                <th className="px-4 py-3 text-right">Ratio</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.month} className="border-b border-black/5 last:border-b-0">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/admin/staff-payroll/dashboard?month=${row.month}`} className="underline-offset-2 hover:underline">
                      {shortMonthLabel(row.month)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(row.status.tone)}`}>
                      {row.status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.snapshot ? money(Number(row.snapshot.net_membership_revenue ?? 0)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {row.snapshot ? money(row.payroll) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">{percent(row.payrollRatio)}</td>
                  <td className="px-4 py-3 text-right">{row.snapshot?.status === 'approved' ? money(row.paid) : '—'}</td>
                  <td className="px-4 py-3 text-right">{row.snapshot?.status === 'approved' ? money(row.remaining) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <div className="flex items-start gap-2">
          <ShieldCheck size={17} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Dashboard is read-only.</div>
            <div className="mt-1 text-xs">
              Staff Payroll 2L does not recalculate payroll, record salary payments, approve payroll or close a payment cycle. Actions remain in their dedicated workflows and preserve the 2I–2K controls.
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
