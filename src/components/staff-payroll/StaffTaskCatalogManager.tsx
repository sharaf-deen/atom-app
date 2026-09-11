'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

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

type Props = {
  areas: AreaRow[]
  tasks: TaskRow[]
  assignments: AssignmentRow[]
  staffProfiles: StaffProfile[]
  canWrite: boolean
}

const UNIT_OPTIONS = [
  ['hour', 'Hour'],
  ['class', 'Class'],
  ['meeting', 'Meeting'],
  ['event', 'Event'],
  ['day', 'Day'],
  ['task', 'Task'],
  ['report', 'Report'],
  ['project', 'Project'],
] as const

const IMPORTANCE_OPTIONS = [
  ['standard', 'Standard', '1.00'],
  ['important', 'Important', '1.15'],
  ['responsibility', 'Responsibility', '1.35'],
  ['high_responsibility', 'High responsibility', '1.60'],
  ['critical', 'Critical / Direction', '2.00'],
] as const

function staffLabel(profile: StaffProfile) {
  const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  return name || profile.email || profile.user_id.slice(0, 8)
}

function roleLabel(role: string | null) {
  if (role === 'super_admin') return 'Super Admin'
  if (role === 'admin') return 'Admin'
  if (role === 'reception') return 'Reception'
  if (role === 'head_coach') return 'Head Coach'
  if (role === 'assistant_coach') return 'Assistant Coach'
  if (role === 'coach') return 'Coach'
  return role || 'Staff'
}

function importanceLabel(level: string) {
  return (
    IMPORTANCE_OPTIONS.find(([value]) => value === level)?.[1] ??
    level.replace(/_/g, ' ')
  )
}

function unitLabel(unit: string) {
  return UNIT_OPTIONS.find(([value]) => value === unit)?.[1] ?? unit
}

function errorMessage(code: string, details?: string) {
  switch (code) {
    case 'SUPER_ADMIN_REQUIRED':
      return 'Only Super Admin can modify the Staff Payroll task catalog.'
    case 'AREA_NAME_REQUIRED':
      return 'Area name is required.'
    case 'AREA_ALREADY_EXISTS':
      return 'An Area with this name already exists.'
    case 'AREA_HAS_ACTIVE_TASKS':
      return 'This Area still contains active tasks. Deactivate or move them first.'
    case 'AREA_INACTIVE':
      return 'This Area is inactive. Reactivate it before using it.'
    case 'TASK_NAME_REQUIRED':
      return 'Task name is required.'
    case 'TASK_ALREADY_EXISTS_IN_AREA':
      return 'A task with this name already exists in the selected Area.'
    case 'AREA_REQUIRED':
      return 'Select an Area.'
    case 'INVALID_UNIT':
      return 'Select a valid task unit.'
    case 'INVALID_IMPORTANCE':
      return 'Select a valid importance level.'
    case 'INVALID_ESTIMATED_HOURS':
    case 'INVALID_ESTIMATED_HOURS_RANGE':
      return 'Check the estimated weekly hours. Maximum must be equal to or higher than minimum.'
    case 'INVALID_DEFAULT_ASSIGNEE':
      return 'One of the selected default assignees is not an eligible staff profile.'
    case 'MIGRATION_REQUIRED':
      return 'Apply the Staff Payroll 1A database migration first.'
    default:
      return details || code.replace(/_/g, ' ')
  }
}

function taskMatches(
  task: TaskRow,
  area: AreaRow | undefined,
  query: string
) {
  const q = query.trim().toLowerCase()
  if (!q) return true

  return [
    task.name,
    task.frequency_label,
    task.estimated_time_label,
    task.source_assignment_label,
    area?.name,
    unitLabel(task.unit),
    importanceLabel(task.importance_level),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q)
}

function buildTaskPayload(form: HTMLFormElement) {
  const formData = new FormData(form)

  return {
    areaId: String(formData.get('area_id') ?? ''),
    name: String(formData.get('name') ?? ''),
    frequencyLabel: String(formData.get('frequency_label') ?? ''),
    estimatedTimeLabel: String(formData.get('estimated_time_label') ?? ''),
    estimatedMinHoursPerWeek: String(
      formData.get('estimated_min_hours_per_week') ?? ''
    ),
    estimatedMaxHoursPerWeek: String(
      formData.get('estimated_max_hours_per_week') ?? ''
    ),
    unit: String(formData.get('unit') ?? 'hour'),
    importanceLevel: String(
      formData.get('importance_level') ?? 'standard'
    ),
    notes: String(formData.get('notes') ?? ''),
    defaultAssigneeIds: formData
      .getAll('default_assignee_ids')
      .map((value) => String(value)),
  }
}

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode
  hint?: string
}) {
  return (
    <span className="mb-1 block text-sm font-medium">
      {children}
      {hint ? (
        <span className="ml-1 text-xs font-normal text-[hsl(var(--muted))]">
          {hint}
        </span>
      ) : null}
    </span>
  )
}

function StaffChecks({
  staffProfiles,
  selectedIds,
}: {
  staffProfiles: StaffProfile[]
  selectedIds: Set<string>
}) {
  if (!staffProfiles.length) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--muted))]">
        No eligible staff profiles found.
      </div>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {staffProfiles.map((profile) => (
        <label
          key={profile.user_id}
          className="flex cursor-pointer items-start gap-2 rounded-xl border border-[hsl(var(--border))] bg-white p-2.5 text-sm"
        >
          <input
            type="checkbox"
            name="default_assignee_ids"
            value={profile.user_id}
            defaultChecked={selectedIds.has(profile.user_id)}
            className="mt-1"
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {staffLabel(profile)}
            </span>
            <span className="block text-xs text-[hsl(var(--muted))]">
              {roleLabel(profile.role)}
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

function TaskFields({
  areas,
  staffProfiles,
  task,
  defaultAreaId,
}: {
  areas: AreaRow[]
  staffProfiles: StaffProfile[]
  task?: TaskRow
  defaultAreaId?: string
}) {
  const selectedIds = new Set<string>()

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <label>
          <FieldLabel>Area</FieldLabel>
          <select
            name="area_id"
            defaultValue={task?.area_id ?? defaultAreaId ?? ''}
            required
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          >
            <option value="" disabled>
              Select Area…
            </option>
            {areas
              .filter((area) => area.is_active || area.id === task?.area_id)
              .map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                  {!area.is_active ? ' · inactive' : ''}
                </option>
              ))}
          </select>
        </label>

        <label>
          <FieldLabel>Task name</FieldLabel>
          <input
            name="name"
            defaultValue={task?.name ?? ''}
            required
            maxLength={160}
            placeholder="Example: Monthly supplier price review"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label>
          <FieldLabel>Frequency</FieldLabel>
          <input
            name="frequency_label"
            defaultValue={task?.frequency_label ?? ''}
            maxLength={120}
            placeholder="Weekly, Monthly, As needed…"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          />
        </label>

        <label>
          <FieldLabel>Unit</FieldLabel>
          <select
            name="unit"
            defaultValue={task?.unit ?? 'hour'}
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          >
            {UNIT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <FieldLabel>Importance</FieldLabel>
          <select
            name="importance_level"
            defaultValue={task?.importance_level ?? 'standard'}
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          >
            {IMPORTANCE_OPTIONS.map(([value, label, multiplier]) => (
              <option key={value} value={value}>
                {label} · ×{multiplier}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label>
          <FieldLabel>Estimated time label</FieldLabel>
          <input
            name="estimated_time_label"
            defaultValue={task?.estimated_time_label ?? ''}
            maxLength={120}
            placeholder="Example: 1–2 h/week"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          />
        </label>

        <label>
          <FieldLabel>Min h/week</FieldLabel>
          <input
            name="estimated_min_hours_per_week"
            type="number"
            inputMode="decimal"
            min="0"
            max="168"
            step="0.25"
            defaultValue={task?.estimated_min_hours_per_week ?? ''}
            placeholder="0"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          />
        </label>

        <label>
          <FieldLabel>Max h/week</FieldLabel>
          <input
            name="estimated_max_hours_per_week"
            type="number"
            inputMode="decimal"
            min="0"
            max="168"
            step="0.25"
            defaultValue={task?.estimated_max_hours_per_week ?? ''}
            placeholder="0"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
          />
        </label>
      </div>

      <label>
        <FieldLabel>Notes</FieldLabel>
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={task?.notes ?? ''}
          placeholder="Optional operational note."
          className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
        />
      </label>

      <div>
        <FieldLabel hint="optional">Default assignees</FieldLabel>
        <StaffChecks
          staffProfiles={staffProfiles}
          selectedIds={selectedIds}
        />
      </div>
    </div>
  )
}

export default function StaffTaskCatalogManager({
  areas,
  tasks,
  assignments,
  staffProfiles,
  canWrite,
}: Props) {
  const router = useRouter()
  const addTaskRef = React.useRef<HTMLDetailsElement | null>(null)

  const [query, setQuery] = React.useState('')
  const [areaFilter, setAreaFilter] = React.useState('all')
  const [statusFilter, setStatusFilter] = React.useState<
    'active' | 'inactive' | 'all'
  >('active')
  const [newTaskAreaId, setNewTaskAreaId] = React.useState(
    areas.find((area) => area.is_active)?.id ?? ''
  )
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const areaById = React.useMemo(
    () => new Map(areas.map((area) => [area.id, area] as const)),
    [areas]
  )

  const staffById = React.useMemo(
    () =>
      new Map(
        staffProfiles.map((profile) => [profile.user_id, profile] as const)
      ),
    [staffProfiles]
  )

  const assignmentIdsByTask = React.useMemo(() => {
    const map = new Map<string, Set<string>>()

    for (const assignment of assignments) {
      const current = map.get(assignment.task_id) ?? new Set<string>()
      current.add(assignment.user_id)
      map.set(assignment.task_id, current)
    }

    return map
  }, [assignments])

  const visibleAreas = React.useMemo(() => {
    return areas.filter((area) => {
      if (areaFilter !== 'all' && area.id !== areaFilter) return false

      const matchingTasks = tasks.filter((task) => {
        if (task.area_id !== area.id) return false
        if (statusFilter === 'active' && !task.is_active) return false
        if (statusFilter === 'inactive' && task.is_active) return false
        return taskMatches(task, area, query)
      })

      const areaNameMatches = area.name
        .toLowerCase()
        .includes(query.trim().toLowerCase())

      return matchingTasks.length > 0 || (query.trim() && areaNameMatches)
    })
  }, [areas, tasks, areaFilter, statusFilter, query])

  async function runAction(
    payload: Record<string, unknown>,
    key: string,
    successMessage: string
  ) {
    setPendingKey(key)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/staff-payroll/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(
          errorMessage(
            data?.error || `HTTP_${response.status}`,
            data?.details
          )
        )
      }

      setSuccess(successMessage)
      router.refresh()
      return true
    } catch (cause: any) {
      setError(cause?.message ?? 'Catalog update failed.')
      return false
    } finally {
      setPendingKey(null)
    }
  }

  function beginAddTask(areaId: string) {
    setNewTaskAreaId(areaId)
    requestAnimationFrame(() => {
      if (addTaskRef.current) {
        addTaskRef.current.open = true
        addTaskRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }
    })
  }

  const activeTaskCount = tasks.filter((task) => task.is_active).length
  const inactiveTaskCount = tasks.length - activeTaskCount

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="font-semibold">Could not save:</span> {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {canWrite ? (
        <section className="grid gap-3 lg:grid-cols-2">
          <details className="rounded-2xl border border-black/10 bg-white">
            <summary className="cursor-pointer px-4 py-3 font-semibold">
              + New Area
            </summary>

            <form
              className="space-y-3 border-t border-black/10 p-4"
              onSubmit={async (event) => {
                event.preventDefault()
                const form = event.currentTarget
                const formData = new FormData(form)

                const ok = await runAction(
                  {
                    action: 'create_area',
                    name: String(formData.get('name') ?? ''),
                  },
                  'create-area',
                  'Area created.'
                )

                if (ok) form.reset()
              }}
            >
              <label className="block">
                <FieldLabel>Area name</FieldLabel>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Example: HR / Staff Administration"
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                />
              </label>

              <button
                type="submit"
                disabled={pendingKey === 'create-area'}
                className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pendingKey === 'create-area'
                  ? 'Creating…'
                  : 'Create Area'}
              </button>
            </form>
          </details>

          <details
            ref={addTaskRef}
            className="rounded-2xl border border-black/10 bg-white"
          >
            <summary className="cursor-pointer px-4 py-3 font-semibold">
              + New Task
            </summary>

            <form
              className="space-y-4 border-t border-black/10 p-4"
              onSubmit={async (event) => {
                event.preventDefault()
                const form = event.currentTarget
                const payload = buildTaskPayload(form)

                const ok = await runAction(
                  {
                    action: 'create_task',
                    ...payload,
                  },
                  'create-task',
                  'Task added to the catalog.'
                )

                if (ok) {
                  form.reset()
                  setNewTaskAreaId(
                    areas.find((area) => area.is_active)?.id ?? ''
                  )
                  if (addTaskRef.current) addTaskRef.current.open = false
                }
              }}
            >
              <TaskFields
                key={newTaskAreaId || 'new-task'}
                areas={areas}
                staffProfiles={staffProfiles}
                defaultAreaId={newTaskAreaId}
              />

              <button
                type="submit"
                disabled={pendingKey === 'create-task'}
                className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pendingKey === 'create-task'
                  ? 'Saving…'
                  : 'Add Task'}
              </button>
            </form>
          </details>
        </section>
      ) : (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <div className="font-semibold">Read-only access</div>
          <div className="mt-1 text-xs">
            Admin can review task definitions and planning assumptions. Only
            Super Admin can add, edit, assign, deactivate or reactivate catalog
            items.
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr]">
          <label>
            <FieldLabel>Search</FieldLabel>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Task, Area, assignment, frequency…"
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
            />
          </label>

          <label>
            <FieldLabel>Area</FieldLabel>
            <select
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
            >
              <option value="all">All Areas</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                  {!area.is_active ? ' · inactive' : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            <FieldLabel>Status</FieldLabel>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as 'active' | 'inactive' | 'all'
                )
              }
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
            >
              <option value="active">Active tasks</option>
              <option value="inactive">Inactive tasks</option>
              <option value="all">All tasks</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1">
            {areas.length} Areas
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">
            {activeTaskCount} active tasks
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
            {inactiveTaskCount} inactive
          </span>
        </div>
      </section>

      <div className="space-y-4">
        {visibleAreas.map((area) => {
          const areaTasks = tasks.filter((task) => {
            if (task.area_id !== area.id) return false
            if (statusFilter === 'active' && !task.is_active) return false
            if (statusFilter === 'inactive' && task.is_active) return false

            const areaNameMatches = area.name
              .toLowerCase()
              .includes(query.trim().toLowerCase())

            return areaNameMatches || taskMatches(task, area, query)
          })

          return (
            <section
              key={area.id}
              className="overflow-hidden rounded-3xl border border-black/10 bg-white"
            >
              <div className="flex flex-col gap-3 border-b border-black/10 bg-black/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{area.name}</h2>
                    {!area.is_active ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        Inactive Area
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {areaTasks.length}{' '}
                    {areaTasks.length === 1 ? 'visible task' : 'visible tasks'}
                  </div>
                </div>

                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    {area.is_active ? (
                      <button
                        type="button"
                        onClick={() => beginAddTask(area.id)}
                        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]"
                      >
                        + Add task
                      </button>
                    ) : null}

                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold">
                        Area settings
                      </summary>

                      <div className="mt-2 w-full rounded-2xl border border-black/10 bg-white p-3 shadow-lg sm:absolute sm:right-0 sm:z-10 sm:w-80">
                        <form
                          className="space-y-3"
                          onSubmit={async (event) => {
                            event.preventDefault()
                            const formData = new FormData(
                              event.currentTarget
                            )

                            await runAction(
                              {
                                action: 'update_area',
                                areaId: area.id,
                                name: String(formData.get('name') ?? ''),
                              },
                              `area-${area.id}`,
                              'Area updated.'
                            )
                          }}
                        >
                          <label className="block">
                            <FieldLabel>Area name</FieldLabel>
                            <input
                              name="name"
                              defaultValue={area.name}
                              required
                              minLength={2}
                              maxLength={100}
                              className="w-full rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm"
                            />
                          </label>

                          <button
                            type="submit"
                            disabled={pendingKey === `area-${area.id}`}
                            className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Save name
                          </button>
                        </form>

                        <div className="mt-3 border-t border-black/10 pt-3">
                          <button
                            type="button"
                            disabled={pendingKey === `toggle-area-${area.id}`}
                            onClick={async () => {
                              const next = !area.is_active

                              if (
                                !next &&
                                !window.confirm(
                                  'Deactivate this Area? It is only allowed when no active task remains inside it.'
                                )
                              ) {
                                return
                              }

                              await runAction(
                                {
                                  action: 'toggle_area',
                                  areaId: area.id,
                                  isActive: next,
                                },
                                `toggle-area-${area.id}`,
                                next
                                  ? 'Area reactivated.'
                                  : 'Area deactivated.'
                              )
                            }}
                            className={
                              'rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ' +
                              (area.is_active
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-800')
                            }
                          >
                            {area.is_active
                              ? 'Deactivate Area'
                              : 'Reactivate Area'}
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 p-3 lg:grid-cols-2">
                {!areaTasks.length ? (
                  <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-5 text-sm text-[hsl(var(--muted))] lg:col-span-2">
                    No task matches the current filters in this Area.
                  </div>
                ) : null}

                {areaTasks.map((task) => {
                  const taskAssignmentIds =
                    assignmentIdsByTask.get(task.id) ?? new Set<string>()
                  const assignedProfiles = Array.from(taskAssignmentIds)
                    .map((id) => staffById.get(id))
                    .filter(Boolean) as StaffProfile[]

                  return (
                    <article
                      key={task.id}
                      className={
                        'rounded-2xl border p-4 ' +
                        (task.is_active
                          ? 'border-black/10 bg-white'
                          : 'border-slate-200 bg-slate-50')
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{task.name}</h3>
                            {!task.is_active ? (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                                Inactive
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                            <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-800">
                              {importanceLabel(task.importance_level)} · ×
                              {Number(task.importance_multiplier).toFixed(2)}
                            </span>
                            <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-800">
                              {unitLabel(task.unit)}
                            </span>
                            {task.frequency_label ? (
                              <span className="rounded-full bg-black/[0.04] px-2 py-1">
                                {task.frequency_label}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <div className="text-xs text-[hsl(var(--muted))]">
                            Estimated time
                          </div>
                          <div>{task.estimated_time_label || '—'}</div>
                        </div>

                        <div>
                          <div className="text-xs text-[hsl(var(--muted))]">
                            Weekly planning range
                          </div>
                          <div>
                            {task.estimated_min_hours_per_week !== null ||
                            task.estimated_max_hours_per_week !== null
                              ? `${task.estimated_min_hours_per_week ?? '—'} → ${task.estimated_max_hours_per_week ?? '—'} h/week`
                              : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl bg-black/[0.025] p-3 text-xs">
                        <div className="font-semibold">Default assignees</div>
                        <div className="mt-1 text-[hsl(var(--muted))]">
                          {assignedProfiles.length
                            ? assignedProfiles
                                .map((profile) => staffLabel(profile))
                                .join(' · ')
                            : 'None linked yet'}
                        </div>

                        {task.source_assignment_label ? (
                          <div className="mt-2 border-t border-black/10 pt-2">
                            <span className="font-medium">
                              Source planning hint:
                            </span>{' '}
                            {task.source_assignment_label}
                          </div>
                        ) : null}
                      </div>

                      {task.notes ? (
                        <div className="mt-3 whitespace-pre-wrap text-xs text-[hsl(var(--muted))]">
                          {task.notes}
                        </div>
                      ) : null}

                      {canWrite ? (
                        <details className="mt-3 rounded-xl border border-black/10">
                          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                            Edit task
                          </summary>

                          <form
                            className="space-y-4 border-t border-black/10 p-3"
                            onSubmit={async (event) => {
                              event.preventDefault()
                              const payload = buildTaskPayload(
                                event.currentTarget
                              )

                              await runAction(
                                {
                                  action: 'update_task',
                                  taskId: task.id,
                                  ...payload,
                                },
                                `task-${task.id}`,
                                'Task updated.'
                              )
                            }}
                          >
                            <div className="grid gap-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <label>
                                  <FieldLabel>Area</FieldLabel>
                                  <select
                                    name="area_id"
                                    defaultValue={task.area_id}
                                    required
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  >
                                    {areas
                                      .filter(
                                        (candidate) =>
                                          candidate.is_active ||
                                          candidate.id === task.area_id
                                      )
                                      .map((candidate) => (
                                        <option
                                          key={candidate.id}
                                          value={candidate.id}
                                        >
                                          {candidate.name}
                                          {!candidate.is_active
                                            ? ' · inactive'
                                            : ''}
                                        </option>
                                      ))}
                                  </select>
                                </label>

                                <label>
                                  <FieldLabel>Task name</FieldLabel>
                                  <input
                                    name="name"
                                    defaultValue={task.name}
                                    required
                                    maxLength={160}
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  />
                                </label>
                              </div>

                              <div className="grid gap-4 lg:grid-cols-3">
                                <label>
                                  <FieldLabel>Frequency</FieldLabel>
                                  <input
                                    name="frequency_label"
                                    defaultValue={
                                      task.frequency_label ?? ''
                                    }
                                    maxLength={120}
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  />
                                </label>

                                <label>
                                  <FieldLabel>Unit</FieldLabel>
                                  <select
                                    name="unit"
                                    defaultValue={task.unit}
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  >
                                    {UNIT_OPTIONS.map(
                                      ([value, label]) => (
                                        <option
                                          key={value}
                                          value={value}
                                        >
                                          {label}
                                        </option>
                                      )
                                    )}
                                  </select>
                                </label>

                                <label>
                                  <FieldLabel>Importance</FieldLabel>
                                  <select
                                    name="importance_level"
                                    defaultValue={task.importance_level}
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  >
                                    {IMPORTANCE_OPTIONS.map(
                                      ([value, label, multiplier]) => (
                                        <option
                                          key={value}
                                          value={value}
                                        >
                                          {label} · ×{multiplier}
                                        </option>
                                      )
                                    )}
                                  </select>
                                </label>
                              </div>

                              <div className="grid gap-4 lg:grid-cols-3">
                                <label>
                                  <FieldLabel>
                                    Estimated time label
                                  </FieldLabel>
                                  <input
                                    name="estimated_time_label"
                                    defaultValue={
                                      task.estimated_time_label ?? ''
                                    }
                                    maxLength={120}
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  />
                                </label>

                                <label>
                                  <FieldLabel>Min h/week</FieldLabel>
                                  <input
                                    name="estimated_min_hours_per_week"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="168"
                                    step="0.25"
                                    defaultValue={
                                      task.estimated_min_hours_per_week ??
                                      ''
                                    }
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  />
                                </label>

                                <label>
                                  <FieldLabel>Max h/week</FieldLabel>
                                  <input
                                    name="estimated_max_hours_per_week"
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="168"
                                    step="0.25"
                                    defaultValue={
                                      task.estimated_max_hours_per_week ??
                                      ''
                                    }
                                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                  />
                                </label>
                              </div>

                              <label>
                                <FieldLabel>Notes</FieldLabel>
                                <textarea
                                  name="notes"
                                  rows={3}
                                  maxLength={2000}
                                  defaultValue={task.notes ?? ''}
                                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                                />
                              </label>

                              <div>
                                <FieldLabel hint="optional">
                                  Default assignees
                                </FieldLabel>
                                <StaffChecks
                                  staffProfiles={staffProfiles}
                                  selectedIds={taskAssignmentIds}
                                />
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="submit"
                                disabled={
                                  pendingKey === `task-${task.id}`
                                }
                                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              >
                                {pendingKey === `task-${task.id}`
                                  ? 'Saving…'
                                  : 'Save changes'}
                              </button>

                              <button
                                type="button"
                                disabled={
                                  pendingKey ===
                                  `toggle-task-${task.id}`
                                }
                                onClick={async () => {
                                  const next = !task.is_active

                                  if (
                                    !next &&
                                    !window.confirm(
                                      'Deactivate this task? It will stay in history and can be reactivated later.'
                                    )
                                  ) {
                                    return
                                  }

                                  await runAction(
                                    {
                                      action: 'toggle_task',
                                      taskId: task.id,
                                      isActive: next,
                                    },
                                    `toggle-task-${task.id}`,
                                    next
                                      ? 'Task reactivated.'
                                      : 'Task deactivated.'
                                  )
                                }}
                                className={
                                  'rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ' +
                                  (task.is_active
                                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-800')
                                }
                              >
                                {task.is_active
                                  ? 'Deactivate task'
                                  : 'Reactivate task'}
                              </button>
                            </div>
                          </form>
                        </details>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}

        {!visibleAreas.length ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-8 text-center text-sm text-[hsl(var(--muted))]">
            No Area or task matches the current filters.
          </div>
        ) : null}
      </div>
    </div>
  )
}
