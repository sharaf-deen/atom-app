// Staff Payroll 2F — Monthly Salary Adjustments
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollAdjustmentsManager from '@/components/staff-payroll/StaffPayrollAdjustmentsManager'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

const STAFF_ROLES = ['assistant_coach', 'coach', 'head_coach', 'reception', 'admin', 'super_admin']

function getOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function previousCairoMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const date = year && month ? new Date(Date.UTC(year, month - 2, 1)) : new Date()
  if (!year || !month) date.setUTCMonth(date.getUTCMonth() - 1, 1)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeClosedMonth(value: string | undefined) {
  const fallback = previousCairoMonth()
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback
  const [year, month] = value.split('-').map(Number)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback
  if (value < '2026-08') return '2026-08'
  if (value > fallback) return fallback
  return value
}

export default async function StaffPayrollAdjustmentsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/adjustments')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'
  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Bonuses & Deductions</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard title="Forbidden" message="Only Admin / Super Admin can access payroll adjustments." nextPath="/admin/staff-payroll/adjustments" showBackHome signedInAs={me.email} />
        </div>
      </main>
    )
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return <main className="p-6"><h1 className="text-2xl font-bold">Staff Payroll · Bonuses & Deductions</h1><p className="mt-3 text-sm text-rose-700">Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY</p></main>
  }

  const selectedMonth = normalizeClosedMonth(getOne(searchParams?.month))
  const monthStart = `${selectedMonth}-01`
  const [staffResult, adjustmentsResult, snapshotResult] = await Promise.all([
    admin.from('profiles').select('user_id,email,first_name,last_name,role').in('role', STAFF_ROLES).order('first_name', { ascending: true }).order('last_name', { ascending: true }),
    admin.from('staff_payroll_monthly_adjustments').select('id,month_start,staff_user_id,staff_name_snapshot,adjustment_type,amount,reason,status,created_at,created_by,created_by_name_snapshot,voided_at,voided_by,voided_by_name_snapshot,void_reason').eq('month_start', monthStart).order('created_at', { ascending: false }),
    admin.from('staff_payroll_monthly_snapshots').select('id,status,approval_version_no,approved_at,draft_calculation_hash').eq('month_start', monthStart).maybeSingle(),
  ])

  const loadError = staffResult.error?.message || adjustmentsResult.error?.message || snapshotResult.error?.message || ''
  const migrationMissing = loadError.includes('staff_payroll_monthly_adjustments') || loadError.toLowerCase().includes('does not exist')

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      {migrationMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Database update required</div>
          <div className="mt-1 text-xs">Deploy migration 20260922143000_staff_payroll_2f_monthly_adjustments.sql, then reload this page.</div>
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Adjustment data load warning: {loadError}</div>
      ) : (
        <StaffPayrollAdjustmentsManager
          monthStart={monthStart}
          canWrite={canWrite}
          locked={snapshotResult.data?.status === 'approved'}
          approvalVersionNo={Number(snapshotResult.data?.approval_version_no ?? 0)}
          draftNeedsRecalculation={Boolean(snapshotResult.data?.id && !snapshotResult.data?.draft_calculation_hash && snapshotResult.data?.status !== 'approved')}
          staffProfiles={((staffResult.data ?? []) as any[]).map((row) => ({
            user_id: String(row.user_id),
            email: row.email ? String(row.email) : null,
            first_name: row.first_name ? String(row.first_name) : null,
            last_name: row.last_name ? String(row.last_name) : null,
            role: row.role ? String(row.role) : null,
          }))}
          adjustments={((adjustmentsResult.data ?? []) as any[]).map((row) => ({
            id: String(row.id),
            month_start: String(row.month_start),
            staff_user_id: String(row.staff_user_id),
            staff_name_snapshot: String(row.staff_name_snapshot),
            adjustment_type: String(row.adjustment_type) as 'bonus' | 'deduction',
            amount: Number(row.amount ?? 0),
            reason: String(row.reason ?? ''),
            status: String(row.status) as 'active' | 'voided',
            created_at: String(row.created_at),
            created_by_name_snapshot: String(row.created_by_name_snapshot ?? 'Super Admin'),
            voided_at: row.voided_at ? String(row.voided_at) : null,
            voided_by_name_snapshot: row.voided_by_name_snapshot ? String(row.voided_by_name_snapshot) : null,
            void_reason: row.void_reason ? String(row.void_reason) : null,
          }))}
        />
      )}
    </main>
  )
}
