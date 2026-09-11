// src/app/admin/staff-payroll/tasks/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffTaskCatalogManager from '@/components/staff-payroll/StaffTaskCatalogManager'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type AreaRow = {
  id: string
  slug: string
  name: string
  sort_order: number
  is_active: boolean
}

type TaskRow = {
  id: string
  area_id: string
  source_key: string | null
  name: string
  frequency_label: string | null
  estimated_time_label: string | null
  estimated_min_hours_per_week: number | null
  estimated_max_hours_per_week: number | null
  unit: string
  importance_level: string
  importance_multiplier: number
  source_assignment_label: string | null
  notes: string | null
  sort_order: number
  is_active: boolean
}

type AssignmentRow = {
  task_id: string
  user_id: string
}

type StaffProfile = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

const STAFF_ROLES = [
  'assistant_coach',
  'coach',
  'head_coach',
  'reception',
  'admin',
  'super_admin',
]

export default async function StaffPayrollTasksPage() {
  const me = await getSessionUser()

  if (!me) {
    redirect('/login?next=/admin/staff-payroll/tasks')
  }

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Task Catalog</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access the Staff Payroll task catalog."
            nextPath="/admin/staff-payroll/tasks"
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
        <h1 className="text-2xl font-bold">Staff Payroll · Task Catalog</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL /
          SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const [
    areasResult,
    tasksResult,
    assignmentsResult,
    staffResult,
  ] = await Promise.all([
    admin
      .from('staff_task_areas')
      .select('id,slug,name,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('staff_tasks')
      .select(
        'id,area_id,source_key,name,frequency_label,estimated_time_label,estimated_min_hours_per_week,estimated_max_hours_per_week,unit,importance_level,importance_multiplier,source_assignment_label,notes,sort_order,is_active'
      )
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('staff_task_default_assignees')
      .select('task_id,user_id'),
    admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,role')
      .in('role', STAFF_ROLES)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true }),
  ])

  const loadError =
    areasResult.error?.message ||
    tasksResult.error?.message ||
    assignmentsResult.error?.message ||
    staffResult.error?.message ||
    ''

  const migrationMissing =
    loadError.includes('staff_task_areas') ||
    loadError.includes('staff_tasks') ||
    loadError.includes('staff_task_default_assignees') ||
    loadError.toLowerCase().includes('does not exist')

  const areas = ((areasResult.data ?? []) as any[]).map(
    (row) =>
      ({
        id: String(row.id),
        slug: String(row.slug),
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
        source_key: row.source_key ? String(row.source_key) : null,
        name: String(row.name),
        frequency_label: row.frequency_label
          ? String(row.frequency_label)
          : null,
        estimated_time_label: row.estimated_time_label
          ? String(row.estimated_time_label)
          : null,
        estimated_min_hours_per_week:
          row.estimated_min_hours_per_week === null ||
          row.estimated_min_hours_per_week === undefined
            ? null
            : Number(row.estimated_min_hours_per_week),
        estimated_max_hours_per_week:
          row.estimated_max_hours_per_week === null ||
          row.estimated_max_hours_per_week === undefined
            ? null
            : Number(row.estimated_max_hours_per_week),
        unit: String(row.unit ?? 'hour'),
        importance_level: String(row.importance_level ?? 'standard'),
        importance_multiplier: Number(row.importance_multiplier ?? 1),
        source_assignment_label: row.source_assignment_label
          ? String(row.source_assignment_label)
          : null,
        notes: row.notes ? String(row.notes) : null,
        sort_order: Number(row.sort_order ?? 0),
        is_active: Boolean(row.is_active),
      }) satisfies TaskRow
  )

  const assignments = ((assignmentsResult.data ?? []) as any[]).map(
    (row) =>
      ({
        task_id: String(row.task_id),
        user_id: String(row.user_id),
      }) satisfies AssignmentRow
  )

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

  const activeAreas = areas.filter((area) => area.is_active).length
  const activeTasks = tasks.filter((task) => task.is_active).length
  const configuredAssignments = new Set(
    assignments.map((assignment) => assignment.task_id)
  ).size
  const nonStandardImportance = tasks.filter(
    (task) => task.importance_level !== 'standard'
  ).length

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 1A
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
                  ? 'Super Admin · catalog management'
                  : 'Admin · read-only'}
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              Task Catalog & Compensation Foundation
            </h1>

            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              Define the work performed inside ATOM before monthly salary
              calculations begin. Tasks are grouped by Area and carry their
              unit, expected workload, importance and optional default staff
              assignment.
            </p>

            <p className="mt-2 text-xs text-[hsl(var(--muted))]">
              The initial catalog contains the 59 tasks from the ATOM planning
              sheet. Their source assignment names are kept as planning hints,
              while real default assignments are linked explicitly to staff
              profiles.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
            >
              ← Admin
            </Link>
          </div>
        </div>
      </section>

      {migrationMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">
            Staff Payroll 1A migration required
          </div>
          <div className="mt-1 text-xs">
            Apply the Staff Payroll 1A migration, then refresh this page. No
            payroll calculation has been created yet.
          </div>
        </div>
      ) : null}

      {!migrationMissing && loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Catalog load warning: {loadError}
        </div>
      ) : null}

      {!migrationMissing ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">
                Active Areas
              </div>
              <div className="mt-1 text-2xl font-bold">{activeAreas}</div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">
                Active Tasks
              </div>
              <div className="mt-1 text-2xl font-bold">{activeTasks}</div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">
                Tasks with default staff
              </div>
              <div className="mt-1 text-2xl font-bold">
                {configuredAssignments}
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs text-[hsl(var(--muted))]">
                Importance classified
              </div>
              <div className="mt-1 text-2xl font-bold">
                {nonStandardImportance}
              </div>
            </div>
          </section>

          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
            <div className="font-semibold">
              Compensation weights are intentionally neutral at launch.
            </div>
            <div className="mt-1 text-xs">
              The source planning sheet does not define task-value
              coefficients, so imported tasks start at Standard ×1.00. Super
              Admin can classify importance here before the monthly salary
              calculation lot is introduced.
            </div>
          </div>

          <StaffTaskCatalogManager
            areas={areas}
            tasks={tasks}
            assignments={assignments}
            staffProfiles={staffProfiles}
            canWrite={canWrite}
          />
        </>
      ) : null}
    </main>
  )
}
