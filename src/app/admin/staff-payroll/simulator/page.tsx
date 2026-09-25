export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollScenarioSimulator from '@/components/staff-payroll/StaffPayrollScenarioSimulator'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = { month?: string | string[] }

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function cairoMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
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

export default async function StaffPayrollSimulatorPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/simulator')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canTransfer = me.role === 'super_admin'
  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Simulator</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard title="Forbidden" message="Only Admin / Super Admin can access Staff Payroll simulation." nextPath="/admin/staff-payroll/simulator" showBackHome signedInAs={me.email} />
        </div>
      </main>
    )
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return <main className="p-6"><h1 className="text-2xl font-bold">Staff Payroll · Simulator</h1><p className="mt-3 text-sm text-rose-700">Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY</p></main>
  }

  const selectedMonth = normalizeClosedMonth(first(searchParams?.month).trim())
  const monthStart = `${selectedMonth}-01`
  const snapshotResult = await admin
    .from('staff_payroll_monthly_snapshots')
    .select('id,month_start,status,rate_model,variable_payroll_percent,safety_reserve_percent,membership_revenue,paid_membership_refunds,net_membership_revenue,eligible_operating_expenses,operating_result_before_payroll,fixed_base_payroll,guaranteed_payroll,safety_reserve_amount,variable_payroll_pool,variable_pool_weighted_hours,variable_weighted_hour_value,manual_bonus_total,manual_deduction_total,calculated_payroll_total,missing_hours_task_count,unconfigured_staff_count')
    .eq('month_start', monthStart)
    .maybeSingle()

  let calculationsResult: any = { data: [], error: null }
  if (snapshotResult.data?.id) {
    calculationsResult = await admin
      .from('staff_payroll_monthly_calculations')
      .select('id,staff_user_id,staff_name_snapshot,staff_role_snapshot,compensation_configured,fixed_monthly_base,bonus_eligible,weighted_hours,missing_hours_task_count,manual_bonus,manual_deduction,calculated_salary')
      .eq('snapshot_id', snapshotResult.data.id)
      .order('staff_name_snapshot', { ascending: true })
  }

  const loadError = snapshotResult.error?.message || calculationsResult.error?.message || ''
  const snapshot = snapshotResult.data ? {
    id: String(snapshotResult.data.id),
    month_start: String(snapshotResult.data.month_start),
    status: String(snapshotResult.data.status ?? 'draft'),
    rate_model: String(snapshotResult.data.rate_model ?? ''),
    variable_payroll_percent: Number(snapshotResult.data.variable_payroll_percent ?? 30),
    safety_reserve_percent: Number(snapshotResult.data.safety_reserve_percent ?? 20),
    membership_revenue: Number(snapshotResult.data.membership_revenue ?? 0),
    paid_membership_refunds: Number(snapshotResult.data.paid_membership_refunds ?? 0),
    net_membership_revenue: Number(snapshotResult.data.net_membership_revenue ?? 0),
    eligible_operating_expenses: Number(snapshotResult.data.eligible_operating_expenses ?? 0),
    operating_result_before_payroll: Number(snapshotResult.data.operating_result_before_payroll ?? 0),
    fixed_base_payroll: Number(snapshotResult.data.fixed_base_payroll ?? snapshotResult.data.guaranteed_payroll ?? 0),
    safety_reserve_amount: Number(snapshotResult.data.safety_reserve_amount ?? 0),
    variable_payroll_pool: Number(snapshotResult.data.variable_payroll_pool ?? 0),
    variable_pool_weighted_hours: Number(snapshotResult.data.variable_pool_weighted_hours ?? 0),
    variable_weighted_hour_value: Number(snapshotResult.data.variable_weighted_hour_value ?? 0),
    manual_bonus_total: Number(snapshotResult.data.manual_bonus_total ?? 0),
    manual_deduction_total: Number(snapshotResult.data.manual_deduction_total ?? 0),
    calculated_payroll_total: Number(snapshotResult.data.calculated_payroll_total ?? 0),
    missing_hours_task_count: Number(snapshotResult.data.missing_hours_task_count ?? 0),
    unconfigured_staff_count: Number(snapshotResult.data.unconfigured_staff_count ?? 0),
  } : null

  const calculations = ((calculationsResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    staff_user_id: String(row.staff_user_id),
    staff_name_snapshot: String(row.staff_name_snapshot ?? 'Staff'),
    staff_role_snapshot: row.staff_role_snapshot ? String(row.staff_role_snapshot) : null,
    compensation_configured: Boolean(row.compensation_configured),
    fixed_monthly_base: Number(row.fixed_monthly_base ?? 0),
    bonus_eligible: Boolean(row.bonus_eligible),
    weighted_hours: Number(row.weighted_hours ?? 0),
    missing_hours_task_count: Number(row.missing_hours_task_count ?? 0),
    manual_bonus: Number(row.manual_bonus ?? 0),
    manual_deduction: Number(row.manual_deduction ?? 0),
    calculated_salary: Number(row.calculated_salary ?? 0),
  }))

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">Staff Payroll 2J</span>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">Read-only simulation</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Payroll Simulation & Budget Guardrails</h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))]">Test revenue, expenses, reserve and variable payroll assumptions without changing the official payroll draft. Scenario values remain in this browser page only.</p>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-sm font-medium">Payroll month<input type="month" name="month" min="2026-08" max={previousCairoMonth()} defaultValue={selectedMonth} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-[220px]" /></label>
          <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">Load month</button>
        </form>
      </section>

      {loadError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Simulator load warning: {loadError}</div> : null}
      {!loadError && !snapshot ? (
        <section className="rounded-3xl border border-dashed border-black/15 bg-white p-8 text-center">
          <div className="text-lg font-semibold">No reference payroll exists for {selectedMonth}</div>
          <div className="mt-2 text-sm text-[hsl(var(--muted))]">Calculate this month once in Salary Calculation before running scenarios. The simulator needs the latest draft or approved calculation as its real-world baseline.</div>
        </section>
      ) : null}
      {snapshot ? <StaffPayrollScenarioSimulator monthStart={monthStart} snapshot={snapshot} calculations={calculations} canTransfer={canTransfer} /> : null}
    </main>
  )
}
