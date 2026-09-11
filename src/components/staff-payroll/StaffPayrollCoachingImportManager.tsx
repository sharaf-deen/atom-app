'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type PayrollTask = {
  id: string
  name: string
  importance_level: string
  importance_multiplier: number
}

type TemplateMapping = {
  id: string
  payroll_task_id: string
  default_duration_hours: number | null
  is_active: boolean
  updated_at: string
}

type ScheduleTemplate = {
  id: string
  series_key: string
  name: string
  day_of_week: number
  start_time: string
  end_time: string | null
  mat: string | null
  is_active: boolean
  audience: string
  level: string
  activity_type: string
  uniform: string
  occurs_in_month: boolean
  mapping: TemplateMapping | null
}

type Candidate = {
  key: string
  session_id: string
  class_template_id: string
  session_date: string
  start_time: string
  end_time: string | null
  session_name: string
  mat: string | null
  activity_type: string
  uniform: string
  level: string
  staff_user_id: string
  staff_name: string
  staff_role: string
  assignment_role: string
  payroll_task_id: string | null
  payroll_task_name: string | null
  evidence_type: string | null
  has_qr: boolean
  has_completed_log: boolean
  manual_confirmation: {
    id: string
    reason: string
    confirmed_at: string
  } | null
  duration_hours: number | null
  duration_source: string | null
  status: string
  imported: {
    id: string
    evidence_type: string
    duration_hours: number
    duration_source: string
    imported_at: string
    monthly_task_log_id: string
  } | null
  existing_monthly_log: {
    id: string
    source: string
    task_name: string
    quantity: number
    actual_hours: number | null
  } | null
}

type Model = {
  month_start: string
  month_locked: boolean
  lock_version: number
  approved_at: string | null
  templates: ScheduleTemplate[]
  tasks: PayrollTask[]
  candidates: Candidate[]
  summary: Record<string, number>
}

type Props = {
  initialMonth: string
  canWrite: boolean
}

type MappingDraft = {
  taskId: string
  duration: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function monthLabel(month: string) {
  const [year, monthNo] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, monthNo - 1, 1)))
}

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function timeLabel(value: string | null) {
  if (!value) return '—'
  return value.slice(0, 5)
}

function numberLabel(value: number | null) {
  if (value == null) return '—'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function evidenceLabel(value: string | null) {
  switch (value) {
    case 'qr_and_completed_log':
      return 'QR + Completed Log'
    case 'qr':
      return 'QR matched'
    case 'completed_log':
      return 'Completed Log'
    case 'manual_confirmation':
      return 'Manual confirmation'
    default:
      return 'No evidence'
  }
}

function roleLabel(value: string) {
  return value === 'primary_coach' ? 'Primary Coach' : 'Assistant Coach'
}

function statusMeta(status: string) {
  switch (status) {
    case 'ready':
      return { label: 'Ready', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
    case 'imported':
      return { label: 'Imported', cls: 'bg-sky-50 text-sky-800 border-sky-200' }
    case 'needs_mapping':
      return { label: 'Needs mapping', cls: 'bg-amber-50 text-amber-900 border-amber-200' }
    case 'needs_confirmation':
      return { label: 'Needs evidence', cls: 'bg-yellow-50 text-yellow-900 border-yellow-200' }
    case 'missing_duration':
      return { label: 'Missing duration', cls: 'bg-orange-50 text-orange-900 border-orange-200' }
    case 'manual_conflict':
      return { label: 'Manual conflict', cls: 'bg-rose-50 text-rose-800 border-rose-200' }
    default:
      return { label: status, cls: 'bg-black/[0.03] text-black border-black/10' }
  }
}

function errorLabel(code: string) {
  switch (code) {
    case 'PAYROLL_MONTH_LOCKED':
      return 'This payroll month is approved and locked.'
    case 'MANUAL_MONTHLY_TASK_CONFLICT':
      return 'A manual or adjusted Monthly Task already exists for one of these staff/task combinations. Review it before importing.'
    case 'COACHING_SESSION_ALREADY_IMPORTED':
      return 'One of the selected coaching sessions was already imported.'
    case 'COACHING_EVIDENCE_REQUIRED':
      return 'One of the selected sessions no longer has valid coaching evidence.'
    case 'PAYROLL_MAPPING_REQUIRED':
      return 'One of the selected sessions no longer has an active payroll mapping.'
    case 'MIGRATION_REQUIRED':
      return 'Staff Payroll 1G migration is required.'
    default:
      return code.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
  }
}

export default function StaffPayrollCoachingImportManager({ initialMonth, canWrite }: Props) {
  const router = useRouter()
  const [month, setMonth] = React.useState(initialMonth)
  const [model, setModel] = React.useState<Model | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [durations, setDurations] = React.useState<Record<string, string>>({})
  const [mappingDrafts, setMappingDrafts] = React.useState<Record<string, MappingDraft>>({})
  const [confirmingKey, setConfirmingKey] = React.useState<string | null>(null)
  const [confirmReason, setConfirmReason] = React.useState('')

  const currentMonth = React.useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date())
    const year = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    return year && m ? `${year}-${m}` : undefined
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/staff-payroll/coaching-import?month=${encodeURIComponent(`${month}-01`)}`, {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.details || `HTTP_${response.status}`)
      }

      const nextModel = payload as Model
      setModel(nextModel)

      const nextDurations: Record<string, string> = {}
      const nextSelected = new Set<string>()
      for (const candidate of nextModel.candidates) {
        if (candidate.duration_hours != null) nextDurations[candidate.key] = String(candidate.duration_hours)
        if (candidate.status === 'ready') nextSelected.add(candidate.key)
      }
      setDurations(nextDurations)
      setSelected(nextSelected)

      const nextMappings: Record<string, MappingDraft> = {}
      for (const template of nextModel.templates) {
        nextMappings[template.id] = {
          taskId: template.mapping?.is_active ? template.mapping.payroll_task_id : '',
          duration: template.mapping?.default_duration_hours == null
            ? ''
            : String(template.mapping.default_duration_hours),
        }
      }
      setMappingDrafts(nextMappings)
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'LOAD_FAILED'))
      setModel(null)
    } finally {
      setLoading(false)
    }
  }, [month])

  React.useEffect(() => {
    void load()
  }, [load])

  function changeMonth(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) return
    setMonth(value)
    setSuccess(null)
    router.replace(`/admin/staff-payroll/coaching-import?month=${encodeURIComponent(value)}`)
  }

  async function post(body: any) {
    const response = await fetch('/api/staff-payroll/coaching-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || payload?.details || `HTTP_${response.status}`)
    }
    return payload
  }

  async function saveMapping(template: ScheduleTemplate) {
    const draft = mappingDrafts[template.id]
    if (!draft?.taskId) {
      setError('Select a payroll task first.')
      return
    }
    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      await post({
        action: 'save_mapping',
        classTemplateId: template.id,
        payrollTaskId: draft.taskId,
        defaultDurationHours: draft.duration.trim() || null,
      })
      setSuccess(`Mapping saved for ${template.name}.`)
      await load()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'MAPPING_SAVE_FAILED'))
    } finally {
      setPending(false)
    }
  }

  async function disableMapping(template: ScheduleTemplate) {
    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      await post({ action: 'disable_mapping', classTemplateId: template.id })
      setSuccess(`Payroll mapping disabled for ${template.name}.`)
      await load()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'MAPPING_DISABLE_FAILED'))
    } finally {
      setPending(false)
    }
  }

  async function confirm(candidate: Candidate) {
    if (confirmReason.trim().length < 3) {
      setError('A short confirmation reason is required.')
      return
    }
    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      await post({
        action: 'confirm',
        monthStart: `${month}-01`,
        sessionId: candidate.session_id,
        staffUserId: candidate.staff_user_id,
        reason: confirmReason.trim(),
      })
      setSuccess(`Manual coaching confirmation recorded for ${candidate.staff_name}.`)
      setConfirmingKey(null)
      setConfirmReason('')
      await load()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'CONFIRMATION_FAILED'))
    } finally {
      setPending(false)
    }
  }

  async function revokeConfirmation(candidate: Candidate) {
    const reason = window.prompt('Reason for revoking this manual coaching confirmation:')?.trim() ?? ''
    if (reason.length < 3) return
    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      await post({
        action: 'revoke_confirmation',
        monthStart: `${month}-01`,
        sessionId: candidate.session_id,
        staffUserId: candidate.staff_user_id,
        reason,
      })
      setSuccess('Manual confirmation revoked.')
      await load()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'CONFIRMATION_REVOKE_FAILED'))
    } finally {
      setPending(false)
    }
  }

  async function importSelected() {
    if (!model) return
    const chosen = model.candidates.filter((candidate) => selected.has(candidate.key))
    if (!chosen.length) {
      setError('Select at least one confirmed coaching session to import.')
      return
    }

    const items = chosen.map((candidate) => ({
      sessionId: candidate.session_id,
      staffUserId: candidate.staff_user_id,
      durationHours: Number(durations[candidate.key]),
    }))
    if (items.some((item) => !Number.isFinite(item.durationHours) || item.durationHours <= 0 || item.durationHours > 12)) {
      setError('Every selected session needs a valid duration between 0 and 12 hours.')
      return
    }

    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      const payload = await post({ action: 'import', monthStart: `${month}-01`, items })
      const count = Number(payload?.result?.imported_count ?? items.length)
      setSuccess(`${count} confirmed coaching session${count === 1 ? '' : 's'} imported into Monthly Tasks.`)
      await load()
      router.refresh()
    } catch (e: any) {
      setError(errorLabel(e?.message ?? 'COACHING_IMPORT_FAILED'))
    } finally {
      setPending(false)
    }
  }

  const mappingTemplates = React.useMemo(
    () => (model?.templates ?? []).filter((template) => template.occurs_in_month),
    [model]
  )

  const selectedCount = selected.size

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-semibold">Payroll month</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">
              Previous month is the default. Current month is also available to prepare coaching work before payroll close.
            </div>
          </div>
          <input
            type="month"
            value={month}
            max={currentMonth}
            onChange={(event) => changeMonth(event.target.value)}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold"
          />
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{success}</div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-[hsl(var(--muted))]">
          Generating coaching review…
        </div>
      ) : null}

      {!loading && model ? (
        <>
          {model.month_locked ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <div className="font-semibold">Payroll month approved & locked</div>
              <div className="mt-1 text-xs">
                Coaching import is read-only for {monthLabel(month)}.
                {model.lock_version ? ` Approval Version ${model.lock_version}.` : ''}
              </div>
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {[
              ['Assigned', model.summary.total ?? 0],
              ['Ready', model.summary.ready ?? 0],
              ['Imported', model.summary.imported ?? 0],
              ['Needs mapping', model.summary.needs_mapping ?? 0],
              ['Needs evidence', model.summary.needs_confirmation ?? 0],
              ['Needs review', (model.summary.missing_duration ?? 0) + (model.summary.manual_conflict ?? 0)],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="text-xs font-medium text-[hsl(var(--muted))]">{label}</div>
                <div className="mt-1 text-2xl font-bold">{value}</div>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-bold">Class → Payroll Task mappings</h2>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                  Map each class occurrence to one active class-based Payroll Task. Default duration is only used when the session has no End Time.
                </p>
              </div>
              {!canWrite ? <span className="text-xs font-semibold text-sky-700">Admin · read-only</span> : null}
            </div>

            <div className="mt-4 space-y-3">
              {mappingTemplates.length === 0 ? (
                <div className="rounded-xl bg-black/[0.02] p-4 text-sm text-[hsl(var(--muted))]">
                  No Structured Schedule sessions exist for this month.
                </div>
              ) : mappingTemplates.map((template) => {
                const draft = mappingDrafts[template.id] ?? { taskId: '', duration: '' }
                const scheduledDuration = template.end_time
                  ? `${timeLabel(template.start_time)}–${timeLabel(template.end_time)}`
                  : `${timeLabel(template.start_time)} · no End Time`
                return (
                  <div key={template.id} className="rounded-2xl border border-black/10 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1.4fr_1.2fr_0.6fr_auto] lg:items-end">
                      <div>
                        <div className="text-sm font-semibold">{template.name}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {DAYS[template.day_of_week] ?? 'Day'} · {scheduledDuration}
                          {template.mat ? ` · ${template.mat}` : ''} · {template.uniform.toUpperCase()}
                        </div>
                      </div>
                      <label className="text-xs font-medium">
                        Payroll Task
                        <select
                          value={draft.taskId}
                          onChange={(event) => setMappingDrafts((prev) => ({
                            ...prev,
                            [template.id]: { ...draft, taskId: event.target.value },
                          }))}
                          disabled={!canWrite || model.month_locked || pending}
                          className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60"
                        >
                          <option value="">Not mapped</option>
                          {model.tasks.map((task) => (
                            <option key={task.id} value={task.id}>{task.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-medium">
                        Default hours
                        <input
                          type="number"
                          min="0.25"
                          max="12"
                          step="0.25"
                          value={draft.duration}
                          onChange={(event) => setMappingDrafts((prev) => ({
                            ...prev,
                            [template.id]: { ...draft, duration: event.target.value },
                          }))}
                          disabled={!canWrite || model.month_locked || pending}
                          placeholder="e.g. 1.5"
                          className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60"
                        />
                      </label>
                      {canWrite && !model.month_locked ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveMapping(template)}
                            disabled={pending || !draft.taskId}
                            className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            Save
                          </button>
                          {template.mapping?.is_active ? (
                            <button
                              type="button"
                              onClick={() => disableMapping(template)}
                              disabled={pending}
                              className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold"
                            >
                              Disable
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-bold">Generate → Review → Import</h2>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                  A schedule assignment alone is never enough. Review evidence and duration before adding coaching to Monthly Tasks.
                </p>
              </div>
              {canWrite && !model.month_locked ? (
                <button
                  type="button"
                  onClick={importSelected}
                  disabled={pending || selectedCount === 0}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {pending ? 'Working…' : `Import selected (${selectedCount})`}
                </button>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {model.candidates.length === 0 ? (
                <div className="rounded-xl bg-black/[0.02] p-4 text-sm text-[hsl(var(--muted))]">
                  No active coach assignments were found for {monthLabel(month)}.
                </div>
              ) : model.candidates.map((candidate) => {
                const meta = statusMeta(candidate.status)
                const selectable =
                  canWrite &&
                  !model.month_locked &&
                  !candidate.imported &&
                  Boolean(candidate.payroll_task_id) &&
                  Boolean(candidate.evidence_type) &&
                  candidate.status !== 'manual_conflict'
                const selectedNow = selected.has(candidate.key)
                const duration = durations[candidate.key] ?? ''

                return (
                  <div key={candidate.key} className="rounded-2xl border border-black/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {selectable ? (
                            <input
                              type="checkbox"
                              checked={selectedNow}
                              onChange={(event) => setSelected((prev) => {
                                const next = new Set(prev)
                                if (event.target.checked) next.add(candidate.key)
                                else next.delete(candidate.key)
                                return next
                              })}
                              className="h-4 w-4"
                            />
                          ) : null}
                          <span className="text-sm font-semibold">{candidate.staff_name}</span>
                          <span className="text-xs text-[hsl(var(--muted))]">{roleLabel(candidate.assignment_role)}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                        </div>
                        <div className="mt-2 text-sm">
                          {dateLabel(candidate.session_date)} · {timeLabel(candidate.start_time)} · {candidate.session_name}
                          {candidate.mat ? ` · ${candidate.mat}` : ''}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted))]">
                          <span>Evidence: <strong className="text-black">{evidenceLabel(candidate.evidence_type)}</strong></span>
                          <span>Payroll Task: <strong className="text-black">{candidate.payroll_task_name ?? 'Not mapped'}</strong></span>
                          {candidate.imported ? (
                            <span>Imported: <strong className="text-black">{numberLabel(candidate.imported.duration_hours)} h</strong></span>
                          ) : null}
                        </div>

                        {candidate.status === 'manual_conflict' && candidate.existing_monthly_log ? (
                          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                            Existing Monthly Task source: <strong>{candidate.existing_monthly_log.source}</strong>. ATOM will not overwrite it. Review Monthly Tasks first.
                          </div>
                        ) : null}

                        {candidate.manual_confirmation ? (
                          <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] p-3 text-xs">
                            Manual confirmation: {candidate.manual_confirmation.reason}
                            {canWrite && !model.month_locked && !candidate.imported && !candidate.has_qr && !candidate.has_completed_log ? (
                              <button
                                type="button"
                                onClick={() => revokeConfirmation(candidate)}
                                disabled={pending}
                                className="ml-2 font-semibold underline"
                              >
                                Revoke
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {canWrite && !model.month_locked && candidate.status === 'needs_confirmation' ? (
                          confirmingKey === candidate.key ? (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <label className="text-xs font-semibold text-amber-950">
                                Manual confirmation reason
                                <input
                                  value={confirmReason}
                                  onChange={(event) => setConfirmReason(event.target.value)}
                                  maxLength={500}
                                  placeholder="e.g. Coach forgot QR; class confirmed by Head Coach."
                                  className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-black"
                                />
                              </label>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => confirm(candidate)}
                                  disabled={pending || confirmReason.trim().length < 3}
                                  className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                                >
                                  Confirm coaching
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setConfirmingKey(null); setConfirmReason('') }}
                                  disabled={pending}
                                  className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setConfirmingKey(candidate.key); setConfirmReason('') }}
                              className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950"
                            >
                              Manual Confirm
                            </button>
                          )
                        ) : null}
                      </div>

                      {!candidate.imported && candidate.payroll_task_id && candidate.evidence_type ? (
                        <label className="w-full text-xs font-medium lg:w-36">
                          Duration hours
                          <input
                            type="number"
                            min="0.25"
                            max="12"
                            step="0.25"
                            value={duration}
                            onChange={(event) => setDurations((prev) => ({ ...prev, [candidate.key]: event.target.value }))}
                            disabled={!canWrite || model.month_locked || candidate.status === 'manual_conflict'}
                            placeholder="Required"
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60"
                          />
                          <span className="mt-1 block font-normal text-[hsl(var(--muted))]">
                            {candidate.duration_source === 'session_end'
                              ? 'From End Time'
                              : candidate.duration_source === 'mapping_default'
                                ? 'Mapping default'
                                : 'Review required'}
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
