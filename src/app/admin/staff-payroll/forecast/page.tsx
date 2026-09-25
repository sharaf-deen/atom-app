// Staff Payroll 2M — Payroll Forecast & Multi-Month Planning
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollForecastPlanner from '@/components/staff-payroll/StaffPayrollForecastPlanner'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = { baseline?: string | string[] }

type SnapshotRow = {
  id: string
  month_start: string
  status: string
  rate_model: string | null
  net_membership_revenue: number | null
  eligible_operating_expenses: number | null
  operating_result_before_payroll: number | null
  fixed_base_payroll: number | null
  guaranteed_payroll: number | null
  safety_reserve_percent: number | null
  safety_reserve_amount: number | null
  variable_payroll_percent: number | null
  variable_payroll_pool: number | null
  variable_pool_weighted_hours: number | null
  variable_weighted_hour_value: number | null
  manual_bonus_total: number | null
  manual_deduction_total: number | null
  calculated_payroll_total: number | null
  staff_count: number | null
  missing_hours_task_count: number | null
  unconfigured_staff_count: number | null
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
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousCairoMonth() {
  return shiftMonth(cairoMonth(), -1)
}

function monthKey(value: string) {
  return String(value).slice(0, 7)
}

export default async function StaffPayrollForecastPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/forecast')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Forecast</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll forecasting."
            nextPath="/admin/staff-payroll/forecast"
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
        <h1 className="text-2xl font-bold">Staff Payroll · Forecast</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const maxMonth = previousCairoMonth()
  const historyStart = `${shiftMonth(maxMonth, -11)}-01`
  const historyEnd = `${maxMonth}-01`

  const snapshotsResult = await admin
    .from('staff_payroll_monthly_snapshots')
    .select(
      'id,month_start,status,rate_model,net_membership_revenue,eligible_operating_expenses,operating_result_before_payroll,fixed_base_payroll,guaranteed_payroll,safety_reserve_percent,safety_reserve_amount,variable_payroll_percent,variable_payroll_pool,variable_pool_weighted_hours,variable_weighted_hour_value,manual_bonus_total,manual_deduction_total,calculated_payroll_total,staff_count,missing_hours_task_count,unconfigured_staff_count'
    )
    .gte('month_start', historyStart)
    .lte('month_start', historyEnd)
    .order('month_start', { ascending: false })

  const loadError = snapshotsResult.error?.message ?? ''
  const snapshots = ((snapshotsResult.data ?? []) as SnapshotRow[]).map((row) => ({
    id: String(row.id),
    month_start: String(row.month_start),
    status: String(row.status ?? 'draft'),
    rate_model: String(row.rate_model ?? ''),
    net_membership_revenue: Number(row.net_membership_revenue ?? 0),
    eligible_operating_expenses: Number(row.eligible_operating_expenses ?? 0),
    operating_result_before_payroll: Number(row.operating_result_before_payroll ?? 0),
    fixed_base_payroll: Number(row.fixed_base_payroll ?? row.guaranteed_payroll ?? 0),
    safety_reserve_percent: Number(row.safety_reserve_percent ?? 20),
    safety_reserve_amount: Number(row.safety_reserve_amount ?? 0),
    variable_payroll_percent: Number(row.variable_payroll_percent ?? 30),
    variable_payroll_pool: Number(row.variable_payroll_pool ?? 0),
    variable_pool_weighted_hours: Number(row.variable_pool_weighted_hours ?? 0),
    variable_weighted_hour_value: Number(row.variable_weighted_hour_value ?? 0),
    manual_bonus_total: Number(row.manual_bonus_total ?? 0),
    manual_deduction_total: Number(row.manual_deduction_total ?? 0),
    calculated_payroll_total: Number(row.calculated_payroll_total ?? 0),
    staff_count: Number(row.staff_count ?? 0),
    missing_hours_task_count: Number(row.missing_hours_task_count ?? 0),
    unconfigured_staff_count: Number(row.unconfigured_staff_count ?? 0),
  }))

  const requestedBaseline = first(searchParams?.baseline).trim()
  const requestedSnapshot = snapshots.find((row) => monthKey(row.month_start) === requestedBaseline)
  const baseline = requestedSnapshot ?? snapshots[0] ?? null

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
            Staff Payroll 2M
          </span>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
            Read-only planning
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Payroll Forecast & Multi-Month Planning</h1>
        <p className="mt-2 max-w-4xl text-sm text-[hsl(var(--muted))] sm:text-base">
          Project payroll, protected reserve and ATOM result over the next 3, 6 or 12 months. Forecast assumptions stay in this browser page and never change official payroll data.
        </p>
      </section>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Forecast data could not be loaded: {loadError}
        </div>
      ) : null}

      {!loadError && !baseline ? (
        <section className="rounded-3xl border border-dashed border-black/15 bg-white p-8 text-center">
          <div className="text-lg font-semibold">No payroll baseline is available yet.</div>
          <div className="mt-2 text-sm text-[hsl(var(--muted))]">
            Calculate at least one payroll month before creating a multi-month forecast.
          </div>
        </section>
      ) : null}

      {baseline ? (
        <>
          <section className="rounded-2xl border border-black/10 bg-white p-4">
            <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="text-sm font-medium">
                Reference payroll month
                <select
                  name="baseline"
                  defaultValue={monthKey(baseline.month_start)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-[240px]"
                >
                  {snapshots.map((snapshot) => (
                    <option key={snapshot.id} value={monthKey(snapshot.month_start)}>
                      {monthKey(snapshot.month_start)} · {snapshot.status === 'approved' ? 'Approved' : 'Draft'}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">
                Load baseline
              </button>
            </form>
          </section>

          <StaffPayrollForecastPlanner key={baseline.id} baseline={baseline} historical={snapshots} />
        </>
      ) : null}
    </main>
  )
}
