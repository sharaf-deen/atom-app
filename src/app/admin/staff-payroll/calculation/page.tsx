// Staff Payroll 1C — Financial Snapshot & Salary Calculation Engine
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollCalculationManager from '@/components/staff-payroll/StaffPayrollCalculationManager'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

const STAFF_ROLES = [
  'assistant_coach',
  'coach',
  'head_coach',
  'reception',
  'admin',
  'super_admin',
]

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

export default async function StaffPayrollCalculationPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/calculation')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Salary Calculation</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll salary calculations."
            nextPath="/admin/staff-payroll/calculation"
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
        <h1 className="text-2xl font-bold">Staff Payroll · Salary Calculation</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const selectedMonth = normalizeClosedMonth(getOne(searchParams?.month))
  const monthStart = `${selectedMonth}-01`

  const [staffResult, compensationResult, snapshotResult] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,role')
      .in('role', STAFF_ROLES)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true }),
    admin
      .from('staff_compensation_profiles')
      .select('staff_user_id,fixed_monthly_base,weighted_hour_rate,bonus_eligible,updated_at')
      .order('updated_at', { ascending: false }),
    admin
      .from('staff_payroll_monthly_snapshots')
      .select(
        'id,month_start,status,eligible_revenue_scope,bonus_pool_percent,membership_revenue,membership_payment_count,paid_membership_refunds,paid_membership_refund_count,net_membership_revenue,eligible_operating_expenses,eligible_expense_count,excluded_payroll_expenses,excluded_payroll_expense_count,operating_result_before_payroll,guaranteed_payroll,available_result_after_guaranteed_payroll,performance_bonus_pool,calculated_payroll_total,staff_count,missing_hours_task_count,unconfigured_staff_count,calculated_at,source_data_as_of'
      )
      .eq('month_start', monthStart)
      .maybeSingle(),
  ])

  const loadError =
    staffResult.error?.message ||
    compensationResult.error?.message ||
    snapshotResult.error?.message ||
    ''

  const migrationMissing =
    loadError.includes('staff_compensation_profiles') ||
    loadError.includes('staff_payroll_monthly_snapshots') ||
    loadError.includes('staff_payroll_monthly_calculations') ||
    loadError.toLowerCase().includes('does not exist')

  let calculationsResult: any = { data: [], error: null }
  if (!migrationMissing && snapshotResult.data?.id) {
    calculationsResult = await admin
      .from('staff_payroll_monthly_calculations')
      .select(
        'id,snapshot_id,month_start,staff_user_id,staff_name_snapshot,staff_role_snapshot,compensation_configured,fixed_monthly_base,weighted_hour_rate,bonus_eligible,active_task_count,missing_hours_task_count,actual_hours,weighted_hours,task_compensation,guaranteed_compensation,bonus_weight_share_percent,performance_bonus,calculated_salary,updated_at'
      )
      .eq('snapshot_id', snapshotResult.data.id)
      .order('staff_name_snapshot', { ascending: true })
  }

  const calculationError = calculationsResult.error?.message || ''

  const staffProfiles = ((staffResult.data ?? []) as any[]).map((row) => ({
    user_id: String(row.user_id),
    email: row.email ? String(row.email) : null,
    first_name: row.first_name ? String(row.first_name) : null,
    last_name: row.last_name ? String(row.last_name) : null,
    role: row.role ? String(row.role) : null,
  }))

  const compensationProfiles = ((compensationResult.data ?? []) as any[]).map(
    (row) => ({
      staff_user_id: String(row.staff_user_id),
      fixed_monthly_base: Number(row.fixed_monthly_base ?? 0),
      weighted_hour_rate: Number(row.weighted_hour_rate ?? 0),
      bonus_eligible: Boolean(row.bonus_eligible),
      updated_at: row.updated_at ? String(row.updated_at) : null,
    })
  )

  const snapshot = snapshotResult.data
    ? {
        id: String(snapshotResult.data.id),
        month_start: String(snapshotResult.data.month_start),
        status: String(snapshotResult.data.status ?? 'draft'),
        eligible_revenue_scope: String(
          snapshotResult.data.eligible_revenue_scope ?? 'membership_only'
        ),
        bonus_pool_percent: Number(snapshotResult.data.bonus_pool_percent ?? 0),
        membership_revenue: Number(snapshotResult.data.membership_revenue ?? 0),
        membership_payment_count: Number(
          snapshotResult.data.membership_payment_count ?? 0
        ),
        paid_membership_refunds: Number(
          snapshotResult.data.paid_membership_refunds ?? 0
        ),
        paid_membership_refund_count: Number(
          snapshotResult.data.paid_membership_refund_count ?? 0
        ),
        net_membership_revenue: Number(
          snapshotResult.data.net_membership_revenue ?? 0
        ),
        eligible_operating_expenses: Number(
          snapshotResult.data.eligible_operating_expenses ?? 0
        ),
        eligible_expense_count: Number(snapshotResult.data.eligible_expense_count ?? 0),
        excluded_payroll_expenses: Number(
          snapshotResult.data.excluded_payroll_expenses ?? 0
        ),
        excluded_payroll_expense_count: Number(
          snapshotResult.data.excluded_payroll_expense_count ?? 0
        ),
        operating_result_before_payroll: Number(
          snapshotResult.data.operating_result_before_payroll ?? 0
        ),
        guaranteed_payroll: Number(snapshotResult.data.guaranteed_payroll ?? 0),
        available_result_after_guaranteed_payroll: Number(
          snapshotResult.data.available_result_after_guaranteed_payroll ?? 0
        ),
        performance_bonus_pool: Number(
          snapshotResult.data.performance_bonus_pool ?? 0
        ),
        calculated_payroll_total: Number(
          snapshotResult.data.calculated_payroll_total ?? 0
        ),
        staff_count: Number(snapshotResult.data.staff_count ?? 0),
        missing_hours_task_count: Number(
          snapshotResult.data.missing_hours_task_count ?? 0
        ),
        unconfigured_staff_count: Number(
          snapshotResult.data.unconfigured_staff_count ?? 0
        ),
        calculated_at: String(snapshotResult.data.calculated_at),
        source_data_as_of: String(snapshotResult.data.source_data_as_of),
      }
    : null

  const calculations = ((calculationsResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    snapshot_id: String(row.snapshot_id),
    month_start: String(row.month_start),
    staff_user_id: String(row.staff_user_id),
    staff_name_snapshot: String(row.staff_name_snapshot),
    staff_role_snapshot: row.staff_role_snapshot
      ? String(row.staff_role_snapshot)
      : null,
    compensation_configured: Boolean(row.compensation_configured),
    fixed_monthly_base: Number(row.fixed_monthly_base ?? 0),
    weighted_hour_rate: Number(row.weighted_hour_rate ?? 0),
    bonus_eligible: Boolean(row.bonus_eligible),
    active_task_count: Number(row.active_task_count ?? 0),
    missing_hours_task_count: Number(row.missing_hours_task_count ?? 0),
    actual_hours: Number(row.actual_hours ?? 0),
    weighted_hours: Number(row.weighted_hours ?? 0),
    task_compensation: Number(row.task_compensation ?? 0),
    guaranteed_compensation: Number(row.guaranteed_compensation ?? 0),
    bonus_weight_share_percent: Number(row.bonus_weight_share_percent ?? 0),
    performance_bonus: Number(row.performance_bonus ?? 0),
    calculated_salary: Number(row.calculated_salary ?? 0),
    updated_at: String(row.updated_at),
  }))

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 1C
              </span>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (canWrite
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800')
                }
              >
                {canWrite ? 'Super Admin · draft calculation' : 'Admin · read-only'}
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              Financial Snapshot & Salary Calculation
            </h1>
            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              Calculate a monthly payroll draft from membership payments, paid membership refunds,
              operating expenses and the weighted work recorded in Monthly Tasks.
            </p>
            <p className="mt-2 text-xs text-[hsl(var(--muted))]">
              Eligible revenue is membership/subscription payments only. External Income, Store revenue,
              Funding and other revenue streams are excluded from Staff Payroll 1C.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-sm font-medium">
            Payroll month
            <input
              type="month"
              name="month"
              min="2026-08"
              max={previousCairoMonth()}
              defaultValue={selectedMonth}
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-[220px]"
            />
          </label>
          <button
            type="submit"
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Load month
          </button>
        </form>
        <div className="mt-2 text-xs text-[hsl(var(--muted))]">
          Reliable Staff Payroll financial baseline starts in August 2026. Only completed months can be calculated.
        </div>
      </section>

      {migrationMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Staff Payroll 1C migration required</div>
          <div className="mt-1 text-xs">
            Apply the Financial Snapshot & Salary Calculation migration, then refresh this page.
          </div>
        </div>
      ) : null}

      {!migrationMissing && (loadError || calculationError) ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Payroll calculation load warning: {loadError || calculationError}
        </div>
      ) : null}

      {!migrationMissing ? (
        <StaffPayrollCalculationManager
          monthStart={monthStart}
          staffProfiles={staffProfiles}
          compensationProfiles={compensationProfiles}
          snapshot={snapshot}
          calculations={calculations}
          canWrite={canWrite}
        />
      ) : null}
    </main>
  )
}
