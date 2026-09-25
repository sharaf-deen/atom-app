// Staff Payroll 2K — Salary Payments, Payment Closeout & Audit History
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollPaymentsManager from '@/components/staff-payroll/StaffPayrollPaymentsManager'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

function getOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function cairoYearMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  if (!year || !month) {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  }

  return { year, month }
}

function previousCairoMonth() {
  const { year, month } = cairoYearMonth()
  const date = new Date(Date.UTC(year, month - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeClosedMonth(value: string | undefined) {
  const fallback = previousCairoMonth()
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback

  const [yearRaw, monthRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback

  const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  if (normalized < '2026-08') return '2026-08'
  if (normalized > previousCairoMonth()) return fallback
  return normalized
}

export default async function StaffPayrollPaymentsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/payments')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Salary Payments</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll salary payments."
            nextPath="/admin/staff-payroll/payments"
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
        <h1 className="text-2xl font-bold">Staff Payroll · Salary Payments</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const selectedMonth = normalizeClosedMonth(getOne(searchParams?.month))
  const monthStart = `${selectedMonth}-01`

  const [snapshotResult, versionsResult, paymentsResult, closeoutsResult] = await Promise.all([
    admin
      .from('staff_payroll_monthly_snapshots')
      .select('id,month_start,status,approval_version_no,approved_at,calculated_payroll_total,staff_count')
      .eq('month_start', monthStart)
      .maybeSingle(),
    admin
      .from('staff_payroll_approval_versions')
      .select('id,snapshot_id,month_start,version_no,approved_at,approved_by_name_snapshot,calculated_payroll_total,staff_count')
      .eq('month_start', monthStart)
      .order('version_no', { ascending: false }),
    admin
      .from('staff_payroll_salary_payments')
      .select('id,approval_version_id,approval_calculation_id,snapshot_id,month_start,approval_version_no,staff_user_id,staff_name_snapshot,approved_salary_amount,amount,payment_method,payment_date,reference,note,status,recorded_at,recorded_by_name_snapshot,reversed_at,reversed_by_name_snapshot,reversal_reason')
      .eq('month_start', monthStart)
      .order('recorded_at', { ascending: false }),
    admin
      .from('staff_payroll_payment_closeouts')
      .select('id,approval_version_id,snapshot_id,month_start,approval_version_no,approved_payroll_total,payable_salary_total,active_payment_total,active_payment_count,staff_count,status,closeout_note,closed_at,closed_by_name_snapshot,reopened_at,reopened_by_name_snapshot,reopen_reason')
      .eq('month_start', monthStart)
      .order('closed_at', { ascending: false }),
  ])

  const loadError =
    snapshotResult.error?.message ||
    versionsResult.error?.message ||
    paymentsResult.error?.message ||
    closeoutsResult.error?.message ||
    ''

  const migrationMissing =
    loadError.includes('staff_payroll_salary_payments') ||
    loadError.includes('staff_payroll_payment_closeouts') ||
    loadError.toLowerCase().includes('does not exist')

  const snapshot = snapshotResult.data
    ? {
        id: String(snapshotResult.data.id),
        month_start: String(snapshotResult.data.month_start),
        status: String(snapshotResult.data.status ?? 'draft'),
        approval_version_no: Number(snapshotResult.data.approval_version_no ?? 0),
        approved_at: snapshotResult.data.approved_at
          ? String(snapshotResult.data.approved_at)
          : null,
        calculated_payroll_total: Number(snapshotResult.data.calculated_payroll_total ?? 0),
        staff_count: Number(snapshotResult.data.staff_count ?? 0),
      }
    : null

  const versions = ((versionsResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    snapshot_id: String(row.snapshot_id),
    month_start: String(row.month_start),
    version_no: Number(row.version_no ?? 0),
    approved_at: String(row.approved_at),
    approved_by_name_snapshot: String(row.approved_by_name_snapshot ?? 'Super Admin'),
    calculated_payroll_total: Number(row.calculated_payroll_total ?? 0),
    staff_count: Number(row.staff_count ?? 0),
  }))

  const currentVersion =
    snapshot?.status === 'approved'
      ? versions.find((version) => version.version_no === snapshot.approval_version_no) ?? null
      : null

  let calculationsResult: any = { data: [], error: null }
  if (!migrationMissing && currentVersion?.id) {
    calculationsResult = await admin
      .from('staff_payroll_approval_calculations')
      .select('id,approval_version_id,snapshot_id,month_start,staff_user_id,staff_name_snapshot,staff_role_snapshot,fixed_monthly_base,weighted_hour_rate,actual_hours,weighted_hours,task_compensation,performance_bonus,dynamic_task_supplement,salary_before_adjustments,manual_bonus,manual_deduction,net_manual_adjustment,calculated_salary,adjustment_breakdown')
      .eq('approval_version_id', currentVersion.id)
      .order('staff_name_snapshot', { ascending: true })
  }

  const calculations = ((calculationsResult.data ?? []) as any[]).map((row) => {
    const calculatedSalary = Number(row.calculated_salary ?? 0)
    const manualBonus = Number(row.manual_bonus ?? 0)
    const manualDeduction = Number(row.manual_deduction ?? 0)
    const adjustmentBreakdown = Array.isArray(row.adjustment_breakdown)
      ? row.adjustment_breakdown
      : []
    const storedSalaryBefore = Number(row.salary_before_adjustments ?? 0)
    const salaryBeforeAdjustments =
      storedSalaryBefore === 0 && manualBonus === 0 && manualDeduction === 0 && !adjustmentBreakdown.length
        ? calculatedSalary
        : storedSalaryBefore

    return {
    id: String(row.id),
    approval_version_id: String(row.approval_version_id),
    snapshot_id: String(row.snapshot_id),
    month_start: String(row.month_start),
    staff_user_id: String(row.staff_user_id),
    staff_name_snapshot: String(row.staff_name_snapshot),
    staff_role_snapshot: row.staff_role_snapshot ? String(row.staff_role_snapshot) : null,
    fixed_monthly_base: Number(row.fixed_monthly_base ?? 0),
    weighted_hour_rate: Number(row.weighted_hour_rate ?? 0),
    actual_hours: Number(row.actual_hours ?? 0),
    weighted_hours: Number(row.weighted_hours ?? 0),
    task_compensation: Number(row.task_compensation ?? 0),
    performance_bonus: Number(row.performance_bonus ?? 0),
    dynamic_task_supplement: Number(row.dynamic_task_supplement ?? 0),
    salary_before_adjustments: salaryBeforeAdjustments,
    manual_bonus: manualBonus,
    manual_deduction: manualDeduction,
    net_manual_adjustment: Number(row.net_manual_adjustment ?? 0),
    calculated_salary: calculatedSalary,
    adjustment_breakdown: adjustmentBreakdown,
  }
  })

  const payments = ((paymentsResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    approval_version_id: String(row.approval_version_id),
    approval_calculation_id: String(row.approval_calculation_id),
    snapshot_id: String(row.snapshot_id),
    month_start: String(row.month_start),
    approval_version_no: Number(row.approval_version_no ?? 0),
    staff_user_id: String(row.staff_user_id),
    staff_name_snapshot: String(row.staff_name_snapshot),
    approved_salary_amount: Number(row.approved_salary_amount ?? 0),
    amount: Number(row.amount ?? 0),
    payment_method: String(row.payment_method),
    payment_date: String(row.payment_date),
    reference: row.reference ? String(row.reference) : null,
    note: row.note ? String(row.note) : null,
    status: String(row.status ?? 'active'),
    recorded_at: String(row.recorded_at),
    recorded_by_name_snapshot: String(row.recorded_by_name_snapshot ?? 'Super Admin'),
    reversed_at: row.reversed_at ? String(row.reversed_at) : null,
    reversed_by_name_snapshot: row.reversed_by_name_snapshot
      ? String(row.reversed_by_name_snapshot)
      : null,
    reversal_reason: row.reversal_reason ? String(row.reversal_reason) : null,
  }))

  const closeouts = ((closeoutsResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    approval_version_id: String(row.approval_version_id),
    snapshot_id: String(row.snapshot_id),
    month_start: String(row.month_start),
    approval_version_no: Number(row.approval_version_no ?? 0),
    approved_payroll_total: Number(row.approved_payroll_total ?? 0),
    payable_salary_total: Number(row.payable_salary_total ?? 0),
    active_payment_total: Number(row.active_payment_total ?? 0),
    active_payment_count: Number(row.active_payment_count ?? 0),
    staff_count: Number(row.staff_count ?? 0),
    status: String(row.status ?? 'closed'),
    closeout_note: row.closeout_note ? String(row.closeout_note) : null,
    closed_at: String(row.closed_at),
    closed_by_name_snapshot: String(row.closed_by_name_snapshot ?? 'Super Admin'),
    reopened_at: row.reopened_at ? String(row.reopened_at) : null,
    reopened_by_name_snapshot: row.reopened_by_name_snapshot
      ? String(row.reopened_by_name_snapshot)
      : null,
    reopen_reason: row.reopen_reason ? String(row.reopen_reason) : null,
  }))

  const calculationError = calculationsResult.error?.message || ''

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 2K
              </span>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (canWrite
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800')
                }
              >
                {canWrite ? 'Super Admin · payment & closeout control' : 'Admin · read-only'}
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              Salary Payments & Payment Closeout
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))] sm:text-base">
              Record real salary payments against the immutable approved payroll version, then close the payment cycle once every salary is fully settled. Closed cycles are locked and can only be reopened by Super Admin with an audit reason.
            </p>
          </div>
        </div>
      </section>

      {migrationMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Database update required</div>
          <div className="mt-1 text-xs">
            Deploy the latest database changes, then refresh this page.
          </div>
        </div>
      ) : null}

      {!migrationMissing && (loadError || calculationError) ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Payment data load warning: {loadError || calculationError}
        </div>
      ) : null}

      {!migrationMissing ? (
        <StaffPayrollPaymentsManager
          monthStart={monthStart}
          snapshot={snapshot}
          currentVersion={currentVersion}
          versions={versions}
          calculations={calculations}
          payments={payments}
          closeouts={closeouts}
          canWrite={canWrite}
        />
      ) : null}
    </main>
  )
}
