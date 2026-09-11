// src/app/admin/staff-payroll/monthly-tasks/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffMonthlyTaskLogManager from '@/components/staff-payroll/StaffMonthlyTaskLogManager'
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

type StaffProfile = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

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

function currentCairoMonth() {
  const { year, month } = cairoYearMonth()
  return `${year}-${String(month).padStart(2, '0')}`
}

function normalizeMonth(value: string | undefined) {
  const fallback = previousCairoMonth()
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback

  const [yearRaw, monthRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback

  const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  return normalized > currentCairoMonth() ? fallback : normalized
}

function staffLabel(profile: StaffProfile) {
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

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1, 1))

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export default async function StaffPayrollMonthlyTasksPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) {
    redirect('/login?next=/admin/staff-payroll/monthly-tasks')
  }

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Monthly Tasks</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll monthly task logs."
            nextPath="/admin/staff-payroll/monthly-tasks"
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
        <h1 className="text-2xl font-bold">Staff Payroll · Monthly Tasks</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const staffResult = await admin
    .from('profiles')
    .select('user_id,email,first_name,last_name,role')
    .in('role', STAFF_ROLES)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })

  const staffProfiles = ((staffResult.data ?? []) as any[]).map(
    (row) =>
      ({
        user_id: String(row.user_id),
        email: row.email ? String(row.email) : null,
        first_name: row.first_name ? String(row.first_name) : null,
        last_name: row.last_name ? String(row.last_name) : null,
        role: row.role ? String(row.role) : null,
      }) satisfies StaffProfile
  )

  const requestedStaff = getOne(searchParams?.staff)?.trim() || ''
  const defaultStaff = staffProfiles.some((profile) => profile.user_id === me.id)
    ? me.id
    : staffProfiles[0]?.user_id ?? ''
  const selectedStaffId = staffProfiles.some(
    (profile) => profile.user_id === requestedStaff
  )
    ? requestedStaff
    : defaultStaff

  const selectedStaff =
    staffProfiles.find((profile) => profile.user_id === selectedStaffId) ?? null
  const selectedMonth = normalizeMonth(getOne(searchParams?.month))
  const monthStart = `${selectedMonth}-01`

  const [
    areasResult,
    tasksResult,
    assigneesResult,
    logsResult,
    payrollSnapshotResult,
  ] = await Promise.all([
    admin
      .from('staff_task_areas')
      .select('id,name,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('staff_tasks')
      .select(
        'id,area_id,name,frequency_label,estimated_time_label,unit,importance_level,importance_multiplier,sort_order,is_active'
      )
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin.from('staff_task_default_assignees').select('task_id,user_id'),
    selectedStaffId
      ? admin
          .from('staff_monthly_task_logs')
          .select(
            'id,month_start,staff_user_id,task_id,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot,work_quantity,actual_hours,weighted_hours,note,source,created_at,updated_at,voided_at,void_reason'
          )
          .eq('month_start', monthStart)
          .eq('staff_user_id', selectedStaffId)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null } as any),
    admin
      .from('staff_payroll_monthly_snapshots')
      .select('id,status,approval_version_no,approved_at')
      .eq('month_start', monthStart)
      .maybeSingle(),
  ])

  const loadError =
    staffResult.error?.message ||
    areasResult.error?.message ||
    tasksResult.error?.message ||
    assigneesResult.error?.message ||
    logsResult.error?.message ||
    payrollSnapshotResult.error?.message ||
    ''

  const migrationMissing =
    loadError.includes('staff_monthly_task_logs') ||
    loadError.includes('approval_version_no') ||
    loadError.toLowerCase().includes('does not exist')

  const areas = ((areasResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sort_order: Number(row.sort_order ?? 0),
    is_active: Boolean(row.is_active),
  }))

  const tasks = ((tasksResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    area_id: String(row.area_id),
    name: String(row.name),
    frequency_label: row.frequency_label ? String(row.frequency_label) : null,
    estimated_time_label: row.estimated_time_label
      ? String(row.estimated_time_label)
      : null,
    unit: String(row.unit ?? 'task'),
    importance_level: String(row.importance_level ?? 'standard'),
    importance_multiplier: Number(row.importance_multiplier ?? 1),
    sort_order: Number(row.sort_order ?? 0),
    is_active: Boolean(row.is_active),
  }))

  const defaultAssignees = ((assigneesResult.data ?? []) as any[]).map((row) => ({
    task_id: String(row.task_id),
    user_id: String(row.user_id),
  }))

  const logs = ((logsResult.data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    month_start: String(row.month_start),
    staff_user_id: String(row.staff_user_id),
    task_id: String(row.task_id),
    task_name_snapshot: String(row.task_name_snapshot),
    area_name_snapshot: String(row.area_name_snapshot),
    unit_snapshot: String(row.unit_snapshot),
    importance_level_snapshot: String(row.importance_level_snapshot),
    importance_multiplier_snapshot: Number(row.importance_multiplier_snapshot ?? 1),
    work_quantity: Number(row.work_quantity ?? 0),
    actual_hours:
      row.actual_hours === null || row.actual_hours === undefined
        ? null
        : Number(row.actual_hours),
    weighted_hours: Number(row.weighted_hours ?? 0),
    note: row.note ? String(row.note) : null,
    source: String(row.source ?? 'manual'),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    voided_at: row.voided_at ? String(row.voided_at) : null,
    void_reason: row.void_reason ? String(row.void_reason) : null,
  }))

  const activeLogs = logs.filter((log) => !log.voided_at)
  const totalHours = activeLogs.reduce(
    (sum, log) => sum + Number(log.actual_hours ?? 0),
    0
  )
  const weightedHours = activeLogs.reduce(
    (sum, log) => sum + Number(log.weighted_hours ?? 0),
    0
  )
  const areasCovered = new Set(activeLogs.map((log) => log.area_name_snapshot)).size
  const monthLocked = payrollSnapshotResult.data?.status === 'approved'
  const lockVersion = Number(payrollSnapshotResult.data?.approval_version_no ?? 0)
  const approvedAt = payrollSnapshotResult.data?.approved_at
    ? String(payrollSnapshotResult.data.approved_at)
    : null

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 1B
              </span>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (canWrite
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800')
                }
              >
                {canWrite ? 'Super Admin · task logging' : 'Admin · read-only'}
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Monthly Task Log</h1>
            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              Record the work actually performed by each staff member for a month.
              The default period is the previous month, ready for the future payroll calculation.
            </p>
            <p className="mt-2 text-xs text-[hsl(var(--muted))]">
              This lot records work only. It does not calculate salary, approve payroll or create payments.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
          <label className="text-sm font-medium">
            Staff member
            <select
              name="staff"
              defaultValue={selectedStaffId}
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            >
              {staffProfiles.map((profile) => (
                <option key={profile.user_id} value={profile.user_id}>
                  {staffLabel(profile)} · {roleLabel(profile.role)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium">
            Payroll month
            <input
              type="month"
              name="month"
              defaultValue={selectedMonth}
              max={currentCairoMonth()}
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Load
          </button>
        </form>

        <div className="mt-3 text-xs text-[hsl(var(--muted))]">
          Selected: <span className="font-semibold text-black">{selectedStaff ? staffLabel(selectedStaff) : 'No staff profile'}</span> · {monthLabel(selectedMonth)}
        </div>
      </section>

      {migrationMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Staff Payroll 1D migration required</div>
          <div className="mt-1 text-xs">
            Apply the Payroll Approval & Monthly Locking migration, then refresh this page.
          </div>
        </div>
      ) : null}

      {!migrationMissing && loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Monthly task log load warning: {loadError}
        </div>
      ) : null}

      {!migrationMissing && selectedStaff ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Logged tasks</div>
              <div className="mt-1 text-2xl font-bold">{activeLogs.length}</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Actual hours</div>
              <div className="mt-1 text-2xl font-bold">{formatNumber(totalHours)} h</div>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <div className="text-xs text-violet-900/70">Weighted hours</div>
              <div className="mt-1 text-2xl font-bold text-violet-950">
                {formatNumber(weightedHours)} h
              </div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Areas covered</div>
              <div className="mt-1 text-2xl font-bold">{areasCovered}</div>
            </div>
          </section>

          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
            <div className="font-semibold">Weighted hours are informational in 1B.</div>
            <div className="mt-1 text-xs">
              They equal actual hours × the importance multiplier snapshot. They are not yet a salary amount.
            </div>
          </div>

          <StaffMonthlyTaskLogManager
            monthStart={monthStart}
            staffUserId={selectedStaffId}
            areas={areas}
            tasks={tasks}
            defaultAssignees={defaultAssignees}
            logs={logs}
            canWrite={canWrite}
            monthLocked={monthLocked}
            lockVersion={lockVersion}
            approvedAt={approvedAt}
          />
        </>
      ) : null}
    </main>
  )
}
