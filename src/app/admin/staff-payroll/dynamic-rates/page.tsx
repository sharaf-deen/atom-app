// Staff Payroll 2H — Dynamic Task Rates & Guaranteed Minimums
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollDynamicRatesManager from '@/components/staff-payroll/StaffPayrollDynamicRatesManager'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

export default async function StaffPayrollDynamicRatesPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/dynamic-rates')
  const canView = me.role === 'admin' || me.role === 'super_admin'
  if (!canView) {
    return <main className="p-6"><h1 className="text-2xl font-bold">Staff Payroll · Dynamic Task Rates</h1><div className="mt-4 max-w-2xl"><AccessDeniedCard title="Forbidden" message="Only Admin / Super Admin can access dynamic task rates." nextPath="/admin/staff-payroll/dynamic-rates" showBackHome signedInAs={me.email} /></div></main>
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try { admin = getSupabaseAdminClientCached() } catch {
    return <main className="p-6"><h1 className="text-2xl font-bold">Staff Payroll · Dynamic Task Rates</h1><p className="mt-3 text-sm text-rose-700">Server env missing.</p></main>
  }

  const [areasResult, tasksResult, ratesResult, snapshotsResult] = await Promise.all([
    admin.from('staff_task_areas').select('id,name'),
    admin.from('staff_tasks').select('id,name,area_id,importance_level,importance_multiplier,is_active').eq('is_active', true).order('sort_order').order('name'),
    admin.from('staff_payroll_task_minimum_rate_periods').select('id,task_id,effective_from,effective_until,minimum_hourly_rate,recommendation_basis,updated_at').order('effective_from', { ascending: false }),
    admin.from('staff_payroll_monthly_snapshots').select('id,month_start,approval_version_no,operating_result_before_payroll').eq('status', 'approved').order('month_start', { ascending: false }).limit(3),
  ])
  const loadError = areasResult.error?.message || tasksResult.error?.message || ratesResult.error?.message || snapshotsResult.error?.message || ''
  if (loadError) {
    const migrationMissing = loadError.includes('staff_payroll_task_minimum_rate_periods') || loadError.toLowerCase().includes('does not exist')
    return <main className="mx-auto max-w-6xl p-4 sm:p-6"><h1 className="text-2xl font-bold">Staff Payroll · Dynamic Task Rates</h1><div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{migrationMissing ? 'Deploy migration 20260922203000_staff_payroll_2h_dynamic_task_rates.sql, then reload this page.' : loadError}</div></main>
  }

  const snapshots = (snapshotsResult.data ?? []) as any[]
  const snapshotIds = snapshots.map((row) => String(row.id))
  let approvedCalculations: any[] = []
  if (snapshotIds.length) {
    const versionsResult = await admin.from('staff_payroll_approval_versions').select('id,snapshot_id,version_no').in('snapshot_id', snapshotIds)
    if (!versionsResult.error) {
      const currentVersionIds = ((versionsResult.data ?? []) as any[])
        .filter((version) => snapshots.some((snapshot) => String(snapshot.id) === String(version.snapshot_id) && Number(snapshot.approval_version_no) === Number(version.version_no)))
        .map((version) => String(version.id))
      if (currentVersionIds.length) {
        const calculationsResult = await admin.from('staff_payroll_approval_calculations').select('approval_version_id,fixed_monthly_base,weighted_hours').in('approval_version_id', currentVersionIds).limit(100000)
        if (!calculationsResult.error) approvedCalculations = (calculationsResult.data ?? []) as any[]
      }
    }
  }

  const historyMonths = Math.max(snapshots.length, 1)
  const averageOperatingResult = snapshots.reduce((sum, row) => sum + Number(row.operating_result_before_payroll ?? 0), 0) / historyMonths
  const averageFixedPayroll = approvedCalculations.reduce((sum, row) => sum + Number(row.fixed_monthly_base ?? 0), 0) / historyMonths
  const averageWeightedHours = approvedCalculations.reduce((sum, row) => sum + Number(row.weighted_hours ?? 0), 0) / historyMonths
  const areaMap = new Map(((areasResult.data ?? []) as any[]).map((row) => [String(row.id), String(row.name)]))

  return <main className="mx-auto max-w-6xl p-4 sm:p-6"><StaffPayrollDynamicRatesManager
    canWrite={me.role === 'super_admin'}
    tasks={((tasksResult.data ?? []) as any[]).map((row) => ({ id: String(row.id), name: String(row.name), area_name: areaMap.get(String(row.area_id)) ?? 'General', importance_level: String(row.importance_level), importance_multiplier: Number(row.importance_multiplier ?? 1) }))}
    periods={((ratesResult.data ?? []) as any[]).map((row) => ({ id: String(row.id), task_id: String(row.task_id), effective_from: String(row.effective_from), effective_until: row.effective_until ? String(row.effective_until) : null, minimum_hourly_rate: Number(row.minimum_hourly_rate ?? 0), updated_at: String(row.updated_at) }))}
    history={{ months: snapshots.length, average_operating_result: averageOperatingResult, average_fixed_payroll: averageFixedPayroll, average_weighted_hours: averageWeightedHours }}
  /></main>
}
