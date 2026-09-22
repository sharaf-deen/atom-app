// Staff Payroll 2D — Effective-dated Compensation Rates
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffCompensationRatesManager from '@/components/staff-payroll/StaffCompensationRatesManager'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

const STAFF_ROLES = ['assistant_coach', 'coach', 'head_coach', 'reception', 'admin', 'super_admin']

export default async function StaffPayrollRatesPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/rates')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'
  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Compensation Rates</h1>
        <div className="mt-4 max-w-2xl"><AccessDeniedCard title="Forbidden" message="Only Admin / Super Admin can access compensation rates." nextPath="/admin/staff-payroll/rates" showBackHome signedInAs={me.email} /></div>
      </main>
    )
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return <main className="p-6"><h1 className="text-2xl font-bold">Staff Payroll · Compensation Rates</h1><p className="mt-3 text-sm text-rose-700">Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY</p></main>
  }

  const [staffResult, areasResult, tasksResult, periodsResult, taskRatesResult, approvedResult] = await Promise.all([
    admin.from('profiles').select('user_id,email,first_name,last_name,role').in('role', STAFF_ROLES).order('first_name', { ascending: true }).order('last_name', { ascending: true }),
    admin.from('staff_task_areas').select('id,name'),
    admin.from('staff_tasks').select('id,name,area_id').eq('is_active', true).order('name', { ascending: true }),
    admin.from('staff_compensation_rate_periods').select('id,staff_user_id,effective_from,effective_until,fixed_monthly_base,weighted_hour_rate,bonus_eligible,updated_at').order('effective_from', { ascending: false }),
    admin.from('staff_compensation_task_rates').select('rate_period_id,task_id,weighted_hour_rate').order('created_at', { ascending: true }),
    admin.from('staff_payroll_approval_calculations').select('staff_user_id,month_start,compensation_rate_period_id').limit(100000),
  ])

  const loadError = staffResult.error?.message || areasResult.error?.message || tasksResult.error?.message || periodsResult.error?.message || taskRatesResult.error?.message || approvedResult.error?.message || ''
  const migrationMissing = loadError.toLowerCase().includes('does not exist') || loadError.includes('staff_compensation_rate_periods') || loadError.includes('compensation_rate_period_id')

  if (loadError) {
    return <main className="mx-auto max-w-6xl p-4 sm:p-6"><h1 className="text-2xl font-bold">Staff Payroll · Compensation Rates</h1><div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{migrationMissing ? 'Deploy migration 20260921233000_staff_payroll_2d_effective_rates.sql, then reload this page.' : loadError}</div></main>
  }

  const areaMap = new Map(((areasResult.data ?? []) as any[]).map((row) => [String(row.id), String(row.name)]))
  const ratesByPeriod = new Map<string, Array<{ task_id: string; weighted_hour_rate: number }>>()
  for (const row of (taskRatesResult.data ?? []) as any[]) {
    const periodId = String(row.rate_period_id)
    const list = ratesByPeriod.get(periodId) ?? []
    list.push({ task_id: String(row.task_id), weighted_hour_rate: Number(row.weighted_hour_rate ?? 0) })
    ratesByPeriod.set(periodId, list)
  }
  const approvedPeriodIds = new Set(((approvedResult.data ?? []) as any[]).map((row) => String(row.compensation_rate_period_id)))
  const legacyApprovedCalculations = ((approvedResult.data ?? []) as any[]).filter(
    (row) => !row.compensation_rate_period_id
  )

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <StaffCompensationRatesManager
        canWrite={canWrite}
        staffProfiles={((staffResult.data ?? []) as any[]).map((row) => ({ user_id: String(row.user_id), email: row.email ? String(row.email) : null, first_name: row.first_name ? String(row.first_name) : null, last_name: row.last_name ? String(row.last_name) : null, role: row.role ? String(row.role) : null }))}
        tasks={((tasksResult.data ?? []) as any[]).map((row) => ({ id: String(row.id), name: String(row.name), area_name: areaMap.get(String(row.area_id)) ?? 'General' }))}
        periods={((periodsResult.data ?? []) as any[]).map((row) => ({ id: String(row.id), staff_user_id: String(row.staff_user_id), effective_from: String(row.effective_from), effective_until: row.effective_until ? String(row.effective_until) : null, fixed_monthly_base: Number(row.fixed_monthly_base ?? 0), weighted_hour_rate: Number(row.weighted_hour_rate ?? 0), bonus_eligible: Boolean(row.bonus_eligible), updated_at: String(row.updated_at), used_in_approved_payroll: approvedPeriodIds.has(String(row.id)) || legacyApprovedCalculations.some((calculation) => String(calculation.staff_user_id) === String(row.staff_user_id) && String(calculation.month_start) >= String(row.effective_from) && (!row.effective_until || String(calculation.month_start) < String(row.effective_until))), task_rates: ratesByPeriod.get(String(row.id)) ?? [] }))}
      />
    </main>
  )
}
