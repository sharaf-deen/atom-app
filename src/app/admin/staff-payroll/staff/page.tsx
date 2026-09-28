// Staff Payroll 2O — Staff Profiles & Default Task Assignments
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollStaffProfilesManager from '@/components/staff-payroll/StaffPayrollStaffProfilesManager'
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

type StaffAccount = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type StaffPayrollProfile = {
  staff_user_id: string
  primary_role: string
  secondary_roles: string[]
  employment_status: 'active' | 'inactive'
  employment_start_date: string | null
  employment_end_date: string | null
  notes: string | null
  updated_at: string
}

type AccountLink = {
  linked_user_id: string
  staff_user_id: string
}

type AreaRow = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

type TaskRow = {
  id: string
  area_id: string
  name: string
  frequency_label: string | null
  estimated_time_label: string | null
  importance_level: string
  importance_multiplier: number
  unit: string
  sort_order: number
  is_active: boolean
}

type DefaultAssignment = {
  task_id: string
  user_id: string
}

export default async function StaffPayrollStaffPage() {
  const me = await getSessionUser()

  if (!me) {
    redirect('/login?next=/admin/staff-payroll/staff')
  }

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Staff Profiles</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll staff profiles."
            nextPath="/admin/staff-payroll/staff"
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
        <h1 className="text-2xl font-bold">Staff Payroll · Staff Profiles</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const [
    accountsResult,
    profilesResult,
    linksResult,
    areasResult,
    tasksResult,
    defaultsResult,
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,role')
      .in('role', STAFF_ROLES)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true }),
    admin
      .from('staff_payroll_staff_profiles')
      .select(
        'staff_user_id,primary_role,secondary_roles,employment_status,employment_start_date,employment_end_date,notes,updated_at'
      )
      .order('updated_at', { ascending: false }),
    admin
      .from('staff_payroll_account_links')
      .select('linked_user_id,staff_user_id'),
    admin
      .from('staff_task_areas')
      .select('id,name,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('staff_tasks')
      .select(
        'id,area_id,name,frequency_label,estimated_time_label,importance_level,importance_multiplier,unit,sort_order,is_active'
      )
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('staff_task_default_assignees')
      .select('task_id,user_id'),
  ])

  const loadError =
    accountsResult.error?.message ||
    profilesResult.error?.message ||
    linksResult.error?.message ||
    areasResult.error?.message ||
    tasksResult.error?.message ||
    defaultsResult.error?.message ||
    ''

  const migrationMissing =
    loadError.includes('staff_payroll_staff_profiles') ||
    loadError.includes('staff_payroll_account_links') ||
    loadError.toLowerCase().includes('does not exist')

  const accounts = ((accountsResult.data ?? []) as any[]).map(
    (row) =>
      ({
        user_id: String(row.user_id),
        email: row.email ? String(row.email) : null,
        first_name: row.first_name ? String(row.first_name) : null,
        last_name: row.last_name ? String(row.last_name) : null,
        role: row.role ? String(row.role) : null,
      }) satisfies StaffAccount
  )

  const staffProfiles = ((profilesResult.data ?? []) as any[]).map(
    (row) =>
      ({
        staff_user_id: String(row.staff_user_id),
        primary_role: String(row.primary_role),
        secondary_roles: Array.isArray(row.secondary_roles)
          ? row.secondary_roles.map(String)
          : [],
        employment_status:
          row.employment_status === 'inactive' ? 'inactive' : 'active',
        employment_start_date: row.employment_start_date
          ? String(row.employment_start_date)
          : null,
        employment_end_date: row.employment_end_date
          ? String(row.employment_end_date)
          : null,
        notes: row.notes ? String(row.notes) : null,
        updated_at: String(row.updated_at),
      }) satisfies StaffPayrollProfile
  )

  const accountLinks = ((linksResult.data ?? []) as any[]).map(
    (row) =>
      ({
        linked_user_id: String(row.linked_user_id),
        staff_user_id: String(row.staff_user_id),
      }) satisfies AccountLink
  )

  const areas = ((areasResult.data ?? []) as any[]).map(
    (row) =>
      ({
        id: String(row.id),
        name: String(row.name),
        sort_order: Number(row.sort_order ?? 0),
        is_active: Boolean(row.is_active),
      }) satisfies AreaRow
  )

  const tasks = ((tasksResult.data ?? []) as any[]).map(
    (row) =>
      ({
        id: String(row.id),
        area_id: String(row.area_id),
        name: String(row.name),
        frequency_label: row.frequency_label
          ? String(row.frequency_label)
          : null,
        estimated_time_label: row.estimated_time_label
          ? String(row.estimated_time_label)
          : null,
        importance_level: String(row.importance_level ?? 'standard'),
        importance_multiplier: Number(row.importance_multiplier ?? 1),
        unit: String(row.unit ?? 'task'),
        sort_order: Number(row.sort_order ?? 0),
        is_active: Boolean(row.is_active),
      }) satisfies TaskRow
  )

  const defaultAssignments = ((defaultsResult.data ?? []) as any[]).map(
    (row) =>
      ({
        task_id: String(row.task_id),
        user_id: String(row.user_id),
      }) satisfies DefaultAssignment
  )

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="max-w-4xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
              Staff Payroll 2O
            </span>
            <span
              className={
                'rounded-full px-3 py-1 text-xs font-semibold ' +
                (canWrite
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-sky-50 text-sky-800')
              }
            >
              {canWrite
                ? 'Super Admin · staff configuration'
                : 'Admin · read-only'}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
            Staff Profiles & Default Tasks
          </h1>

          <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
            Define one payroll identity per employee, record primary and
            secondary responsibilities, link secondary ATOM accounts, and
            assign the default tasks that normally belong to that employee.
          </p>

          <p className="mt-2 text-xs text-[hsl(var(--muted))]">
            Default tasks are a monthly template only. Actual hours remain
            mandatory in Monthly Tasks, and historical approved payroll
            snapshots are never rewritten when this profile changes.
          </p>
        </div>
      </section>

      {migrationMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Database update required</div>
          <div className="mt-1 text-xs">
            Deploy the Staff Payroll 2O migration, then refresh this page.
          </div>
        </div>
      ) : null}

      {!migrationMissing && loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Staff profile load warning: {loadError}
        </div>
      ) : null}

      {!migrationMissing ? (
        <StaffPayrollStaffProfilesManager
          accounts={accounts}
          staffProfiles={staffProfiles}
          accountLinks={accountLinks}
          areas={areas}
          tasks={tasks}
          defaultAssignments={defaultAssignments}
          canWrite={canWrite}
        />
      ) : null}
    </main>
  )
}
