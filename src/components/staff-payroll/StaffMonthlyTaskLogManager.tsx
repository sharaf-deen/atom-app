'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

export type StaffTaskArea = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

export type StaffTaskCatalogItem = {
  id: string
  area_id: string
  name: string
  frequency_label: string | null
  estimated_time_label: string | null
  unit: string
  importance_level: string
  importance_multiplier: number
  sort_order: number
  is_active: boolean
}

export type StaffTaskDefaultAssignee = {
  task_id: string
  user_id: string
}

export type MonthlyTaskLogRow = {
  id: string
  month_start: string
  staff_user_id: string
  task_id: string
  task_name_snapshot: string
  area_name_snapshot: string
  unit_snapshot: string
  importance_level_snapshot: string
  importance_multiplier_snapshot: number
  work_quantity: number
  actual_hours: number | null
  weighted_hours: number
  note: string | null
  source: string
  created_at: string
  updated_at: string
  voided_at: string | null
  void_reason: string | null
}

type Props = {
  monthStart: string
  staffUserId: string
  areas: StaffTaskArea[]
  tasks: StaffTaskCatalogItem[]
  defaultAssignees: StaffTaskDefaultAssignee[]
  logs: MonthlyTaskLogRow[]
  canWrite: boolean
}

function unitLabel(unit: string, quantity = 1) {
  const plural = quantity !== 1
  switch (unit) {
    case 'hour':
      return plural ? 'hours' : 'hour'
    case 'class':
      return plural ? 'classes' : 'class'
    case 'meeting':
      return plural ? 'meetings' : 'meeting'
    case 'event':
      return plural ? 'events' : 'event'
    case 'day':
      return plural ? 'days' : 'day'
    case 'report':
      return plural ? 'reports' : 'report'
    case 'project':
      return plural ? 'projects' : 'project'
    default:
      return plural ? 'tasks' : 'task'
  }
}

function importanceLabel(level: string) {
  switch (level) {
    case 'important':
      return 'Important'
    case 'responsibility':
      return 'Responsibility'
    case 'high_responsibility':
      return 'High responsibility'
    case 'critical':
      return 'Critical / Direction'
    default:
      return 'Standard'
  }
}

function formatNumber(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function errorLabel(code: string) {
  if (!code) return 'Unable to save monthly task log.'
  if (code === 'HOURS_REQUIRED') return 'Actual hours are required for hour-based tasks.'
  if (code === 'QUANTITY_REQUIRED') return 'A quantity greater than zero is required.'
  if (code === 'TASK_ALREADY_LOGGED_FOR_MONTH') return 'This task is already logged for this staff member and month.'
  if (code === 'INACTIVE_TASK_CANNOT_BE_ADDED') return 'Inactive tasks cannot be added to a new month.'
  if (code === 'FUTURE_MONTH_NOT_ALLOWED') return 'Future months cannot be logged.'
  if (code === 'VOID_REASON_REQUIRED') return 'A reason is required to remove a monthly task entry.'
  if (code === 'FORBIDDEN') return 'Only Super Admin can change monthly task logs.'
  if (code === 'MIGRATION_REQUIRED') return 'Apply the Staff Payroll 1B migration first.'
  return code.replace(/_/g, ' ')
}

export default function StaffMonthlyTaskLogManager({
  monthStart,
  staffUserId,
  areas,
  tasks,
  defaultAssignees,
  logs,
  canWrite,
}: Props) {
  const router = useRouter()
  const activeLogs = logs.filter((log) => !log.voided_at)
  const voidedLogs = logs.filter((log) => Boolean(log.voided_at))
  const loggedTaskIds = new Set(activeLogs.map((log) => log.task_id))
  const defaultTaskIds = new Set(
    defaultAssignees
      .filter((assignment) => assignment.user_id === staffUserId)
      .map((assignment) => assignment.task_id)
  )

  const [search, setSearch] = React.useState('')
  const [areaFilter, setAreaFilter] = React.useState('all')
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)
  const [editingLogId, setEditingLogId] = React.useState<string | null>(null)
  const [quantity, setQuantity] = React.useState('1')
  const [actualHours, setActualHours] = React.useState('')
  const [note, setNote] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [voidingLogId, setVoidingLogId] = React.useState<string | null>(null)
  const [voidReason, setVoidReason] = React.useState('')

  const areaMap = React.useMemo(
    () => new Map(areas.map((area) => [area.id, area])),
    [areas]
  )

  const filteredTasks = React.useMemo(() => {
    const q = search.trim().toLowerCase()

    return tasks
      .filter((task) => task.is_active)
      .filter((task) => !loggedTaskIds.has(task.id))
      .filter((task) => areaFilter === 'all' || task.area_id === areaFilter)
      .filter((task) => {
        if (!q) return true
        const area = areaMap.get(task.area_id)?.name ?? ''
        return `${task.name} ${area} ${task.frequency_label ?? ''}`
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        const aSuggested = defaultTaskIds.has(a.id) ? 0 : 1
        const bSuggested = defaultTaskIds.has(b.id) ? 0 : 1
        if (aSuggested !== bSuggested) return aSuggested - bSuggested

        const aArea = areaMap.get(a.area_id)?.sort_order ?? 999
        const bArea = areaMap.get(b.area_id)?.sort_order ?? 999
        if (aArea !== bArea) return aArea - bArea
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
        return a.name.localeCompare(b.name)
      })
  }, [tasks, search, areaFilter, loggedTaskIds, defaultTaskIds, areaMap])

  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null

  const editingLog = editingLogId
    ? activeLogs.find((log) => log.id === editingLogId) ?? null
    : null

  function resetForm() {
    setSelectedTaskId(null)
    setEditingLogId(null)
    setQuantity('1')
    setActualHours('')
    setNote('')
    setError(null)
  }

  function openTask(task: StaffTaskCatalogItem) {
    setEditingLogId(null)
    setSelectedTaskId(task.id)
    setQuantity(task.unit === 'hour' ? '' : '1')
    setActualHours('')
    setNote('')
    setError(null)
    setSuccess(null)
  }

  function editLog(log: MonthlyTaskLogRow) {
    setSelectedTaskId(null)
    setEditingLogId(log.id)
    setQuantity(String(log.work_quantity))
    setActualHours(log.actual_hours == null ? '' : String(log.actual_hours))
    setNote(log.note ?? '')
    setVoidReason('')
    setVoidingLogId(null)
    setError(null)
    setSuccess(null)
  }

  async function saveLog() {
    const task = selectedTask ?? (editingLog ? tasks.find((item) => item.id === editingLog.task_id) ?? null : null)
    if (!task) return

    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/staff-payroll/monthly-task-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          logId: editingLog?.id ?? null,
          monthStart,
          staffUserId,
          taskId: task.id,
          quantity: task.unit === 'hour' ? actualHours : quantity,
          actualHours: actualHours || null,
          note: note.trim() || null,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.details || `HTTP_${response.status}`)
      }

      setSuccess(editingLog ? 'Monthly task updated.' : 'Task added to the monthly log.')
      resetForm()
      router.refresh()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'SAVE_FAILED'))
    } finally {
      setPending(false)
    }
  }

  async function voidLog(logId: string) {
    if (voidReason.trim().length < 3) {
      setError('A short reason is required to remove this monthly task entry.')
      return
    }

    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/staff-payroll/monthly-task-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'void',
          logId,
          reason: voidReason.trim(),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.details || `HTTP_${response.status}`)
      }

      setSuccess('Monthly task removed from the active log. Audit history was preserved.')
      setVoidingLogId(null)
      setVoidReason('')
      setEditingLogId(null)
      router.refresh()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'VOID_FAILED'))
    } finally {
      setPending(false)
    }
  }

  function LogEditForm({ task, isEditing }: { task: StaffTaskCatalogItem; isEditing: boolean }) {
    return (
      <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.015] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{task.name}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">
              {areaMap.get(task.area_id)?.name ?? 'Area'} · {importanceLabel(task.importance_level)} ×{formatNumber(task.importance_multiplier)}
            </div>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]"
            disabled={pending}
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {task.unit !== 'hour' ? (
            <label className="text-sm font-medium">
              Quantity ({unitLabel(task.unit, 2)})
              <input
                type="number"
                min="0.01"
                step="0.25"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
              />
            </label>
          ) : null}

          <label className="text-sm font-medium">
            Actual hours {task.unit === 'hour' ? '(required)' : '(optional)'}
            <input
              type="number"
              min="0.01"
              step="0.25"
              value={actualHours}
              onChange={(event) => setActualHours(event.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
              placeholder={task.unit === 'hour' ? 'e.g. 6' : 'Total time spent'}
            />
          </label>
        </div>

        {task.estimated_time_label ? (
          <div className="mt-2 text-xs text-[hsl(var(--muted))]">
            Catalog estimate: {task.estimated_time_label}
          </div>
        ) : null}

        <label className="mt-3 block text-sm font-medium">
          Monthly note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Optional context about the work performed during this month."
            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={saveLog}
            disabled={pending || (task.unit === 'hour' && !actualHours.trim())}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? 'Saving…' : isEditing ? 'Save changes' : 'Add to month'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Logged work</h2>
            <p className="text-sm text-[hsl(var(--muted))]">
              One active row per task for this staff member and month.
            </p>
          </div>
        </div>

        {!activeLogs.length ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white p-6 text-center text-sm text-[hsl(var(--muted))]">
            No task has been logged for this staff member and month yet.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {activeLogs.map((log) => {
              const catalogTask = tasks.find((task) => task.id === log.task_id)
              const editing = editingLogId === log.id
              const quantity = Number(log.work_quantity ?? 0)

              return (
                <article key={log.id} className="rounded-3xl border border-black/10 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white">
                          {log.area_name_snapshot}
                        </span>
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
                          {importanceLabel(log.importance_level_snapshot)} ×{formatNumber(log.importance_multiplier_snapshot)}
                        </span>
                      </div>
                      <div className="mt-2 text-base font-semibold">{log.task_name_snapshot}</div>
                    </div>

                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => editLog(log)}
                        className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]"
                        disabled={pending}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Quantity</div>
                      <div className="font-semibold">
                        {formatNumber(quantity)} {unitLabel(log.unit_snapshot, quantity)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Actual hours</div>
                      <div className="font-semibold">
                        {log.actual_hours == null ? '—' : `${formatNumber(log.actual_hours)} h`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Weighted hours</div>
                      <div className="font-semibold">{formatNumber(log.weighted_hours)} h</div>
                    </div>
                  </div>

                  {log.note ? (
                    <div className="mt-3 rounded-2xl bg-black/[0.02] p-3 text-sm">
                      {log.note}
                    </div>
                  ) : null}

                  {editing && catalogTask ? <LogEditForm task={catalogTask} isEditing /> : null}

                  {canWrite && !editing ? (
                    <div className="mt-4 border-t border-black/10 pt-3">
                      {voidingLogId === log.id ? (
                        <div className="space-y-2">
                          <label className="block text-xs font-medium">
                            Reason for removing this monthly entry
                            <input
                              value={voidReason}
                              onChange={(event) => setVoidReason(event.target.value)}
                              maxLength={500}
                              placeholder="Required for audit trail"
                              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                            />
                          </label>
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setVoidingLogId(null)
                                setVoidReason('')
                              }}
                              className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold"
                              disabled={pending}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => voidLog(log.id)}
                              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                              disabled={pending || voidReason.trim().length < 3}
                            >
                              {pending ? 'Removing…' : 'Confirm removal'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidingLogId(log.id)
                            setVoidReason('')
                            setError(null)
                          }}
                          className="text-xs font-semibold text-rose-700"
                          disabled={pending}
                        >
                          Remove from this month
                        </button>
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {canWrite ? (
        <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">Add performed task</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Search the catalog instead of using a long dropdown. Default tasks for this staff member are shown first.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search task or Area…"
              className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
            />
            <select
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All Areas</option>
              {areas.filter((area) => area.is_active).map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {!filteredTasks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 p-5 text-center text-sm text-[hsl(var(--muted))]">
                No available task matches the current search/filter.
              </div>
            ) : (
              filteredTasks.map((task) => {
                const area = areaMap.get(task.area_id)
                const suggested = defaultTaskIds.has(task.id)
                const selected = selectedTaskId === task.id

                return (
                  <div key={task.id} className="rounded-2xl border border-black/10 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                            {area?.name ?? 'Area'}
                          </span>
                          {suggested ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Suggested
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 font-semibold">{task.name}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {unitLabel(task.unit)} · {importanceLabel(task.importance_level)} ×{formatNumber(task.importance_multiplier)}
                          {task.estimated_time_label ? ` · ${task.estimated_time_label}` : ''}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => (selected ? resetForm() : openTask(task))}
                        className={
                          'rounded-xl px-3 py-2 text-xs font-semibold ' +
                          (selected
                            ? 'border border-black bg-black text-white'
                            : 'border border-black/10 hover:bg-black/[0.03]')
                        }
                        disabled={pending}
                      >
                        {selected ? 'Selected' : 'Add'}
                      </button>
                    </div>

                    {selected ? <LogEditForm task={task} isEditing={false} /> : null}
                  </div>
                )
              })
            )}
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <div className="font-semibold">Read-only access</div>
          <div className="mt-1 text-xs">
            Only Super Admin can add, edit or remove monthly task entries.
          </div>
        </div>
      )}

      {voidedLogs.length ? (
        <details className="rounded-2xl border border-black/10 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Removed task audit ({voidedLogs.length})
          </summary>
          <div className="mt-3 space-y-2">
            {voidedLogs.map((log) => (
              <div key={log.id} className="rounded-xl bg-black/[0.02] p-3 text-xs">
                <div className="font-semibold">{log.task_name_snapshot}</div>
                <div className="mt-1 text-[hsl(var(--muted))]">
                  {log.area_name_snapshot} · {formatNumber(log.work_quantity)} {unitLabel(log.unit_snapshot, log.work_quantity)}
                  {log.actual_hours ? ` · ${formatNumber(log.actual_hours)} h` : ''}
                </div>
                <div className="mt-1 text-rose-700">Removed: {log.void_reason || '—'}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
