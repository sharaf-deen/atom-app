'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, CalendarDays, Clock3, Layers3, MapPin, RefreshCw, UserCheck, Users } from 'lucide-react'
import type {
  PublishedTrainingProgram,
  ScheduleSessionCoachAssignment,
  ScheduleSessionTrainingProgramAssignment,
  ScheduleTrainingSession,
} from '@/app/schedule/sessions/page'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'

type StaffOption = {
  user_id: string
  full_name: string
  email: string | null
  member_id: string | null
  role: 'assistant_coach' | 'coach' | 'head_coach' | 'super_admin'
}

function normalizeTime(value: string | null) {
  if (!value) return ''
  const match = value.match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : value
}

function formatTime(value: string | null) {
  const normalized = normalizeTime(value)
  if (!normalized) return '—'
  const [hoursRaw, minutes] = normalized.split(':')
  const hours = Number(hoursRaw)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes} ${suffix}`
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatCairoDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function activityLabel(value: ScheduleTrainingSession['activity_type_snapshot']) {
  const labels: Record<ScheduleTrainingSession['activity_type_snapshot'], string> = {
    jiu_jitsu: 'Jiu-Jitsu',
    competition: 'Competition',
    open_drills: 'Open Drills',
    open_mat: 'Open Mat',
    physical_preparation: 'Physical Preparation',
    wrestling: 'Wrestling',
    other: 'Other',
  }
  return labels[value]
}

function uniformLabel(value: ScheduleTrainingSession['uniform_snapshot']) {
  const labels: Record<ScheduleTrainingSession['uniform_snapshot'], string> = {
    gi: 'Gi',
    nogi: 'NoGi',
    gi_nogi: 'Gi & NoGi',
    none: 'Not specified',
  }
  return labels[value]
}

function staffRoleLabel(value: ScheduleSessionCoachAssignment['staff_profile_role_snapshot'] | StaffOption['role']) {
  const labels = {
    assistant_coach: 'Assistant Coach',
    coach: 'Coach',
    head_coach: 'Head Coach',
    super_admin: 'Super Admin',
  }
  return labels[value]
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? (data as Record<string, any>) : {}
}

export default function TrainingSessionsManager({
  canManageSessions,
  canManageAssignments,
  personalView,
  viewerUserId,
  sessions,
  assignments,
  programs,
  programAssignments,
  today,
  previewUntil,
  defaultSyncUntil,
}: {
  canManageSessions: boolean
  canManageAssignments: boolean
  personalView: boolean
  viewerUserId: string
  sessions: ScheduleTrainingSession[]
  assignments: ScheduleSessionCoachAssignment[]
  programs: PublishedTrainingProgram[]
  programAssignments: ScheduleSessionTrainingProgramAssignment[]
  today: string
  previewUntil: string
  defaultSyncUntil: string
}) {
  const router = useRouter()
  const [fromDate, setFromDate] = React.useState(today)
  const [toDate, setToDate] = React.useState(defaultSyncUntil)
  const [pending, setPending] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [assignmentSession, setAssignmentSession] = React.useState<ScheduleTrainingSession | null>(null)
  const [primaryUserId, setPrimaryUserId] = React.useState('')
  const [assistantUserIds, setAssistantUserIds] = React.useState<string[]>([])
  const [staffOptions, setStaffOptions] = React.useState<StaffOption[]>([])
  const [staffLoaded, setStaffLoaded] = React.useState(false)
  const [staffLoading, setStaffLoading] = React.useState(false)
  const [assignmentPending, setAssignmentPending] = React.useState(false)
  const [assignmentError, setAssignmentError] = React.useState<string | null>(null)

  const [programSession, setProgramSession] = React.useState<ScheduleTrainingSession | null>(null)
  const [programId, setProgramId] = React.useState('')
  const [programPending, setProgramPending] = React.useState(false)
  const [programError, setProgramError] = React.useState<string | null>(null)

  const assignmentsBySession = React.useMemo(() => {
    const map = new Map<string, ScheduleSessionCoachAssignment[]>()
    for (const row of assignments) {
      const current = map.get(row.training_session_id) ?? []
      current.push(row)
      map.set(row.training_session_id, current)
    }
    return map
  }, [assignments])

  const programAssignmentBySession = React.useMemo(() => {
    return new Map(programAssignments.map((row) => [row.training_session_id, row]))
  }, [programAssignments])

  function openProgramAssignment(row: ScheduleTrainingSession) {
    const current = programAssignmentBySession.get(row.id)
    setProgramSession(row)
    setProgramId(current?.program_id ?? '')
    setProgramError(null)
  }

  function closeProgramAssignment() {
    if (programPending) return
    setProgramSession(null)
    setProgramId('')
    setProgramError(null)
  }

  async function saveProgramAssignment() {
    if (!programSession) return
    setProgramPending(true)
    setProgramError(null)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/schedule/session-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: programSession.id, programId: programId || null }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to update the Training Program assignment.')
      }
      setMessage(programId ? 'Training Program assigned to the scheduled session.' : 'Training Program cleared from the scheduled session.')
      setProgramSession(null)
      setProgramId('')
      router.refresh()
    } catch (err: any) {
      setProgramError(err?.message || 'Failed to update the Training Program assignment.')
    } finally {
      setProgramPending(false)
    }
  }

  const eligibleProgramsForSession = React.useMemo(() => {
    if (!programSession) return [] as PublishedTrainingProgram[]
    const normalizedName = programSession.name_snapshot.trim().toLowerCase()
    return programs
      .filter((program) => programSession.session_date >= program.start_date && programSession.session_date <= program.end_date)
      .sort((a, b) => {
        const aMatch = a.target_group.trim().toLowerCase() === normalizedName ? 0 : 1
        const bMatch = b.target_group.trim().toLowerCase() === normalizedName ? 0 : 1
        if (aMatch !== bMatch) return aMatch - bMatch
        return a.title.localeCompare(b.title)
      })
  }, [programSession, programs])

  const grouped = React.useMemo(() => {
    const map = new Map<string, ScheduleTrainingSession[]>()
    for (const row of sessions) {
      const current = map.get(row.session_date) ?? []
      current.push(row)
      map.set(row.session_date, current)
    }
    return Array.from(map.entries())
  }, [sessions])

  const uniqueSeries = new Set(sessions.map((row) => row.series_key_snapshot)).size
  const sessionsWithPrimary = sessions.filter((row) =>
    (assignmentsBySession.get(row.id) ?? []).some((assignment) => assignment.assignment_role === 'primary_coach'),
  ).length
  const myPrimaryCount = assignments.filter(
    (row) => row.staff_user_id === viewerUserId && row.assignment_role === 'primary_coach',
  ).length
  const myAssistantCount = assignments.filter(
    (row) => row.staff_user_id === viewerUserId && row.assignment_role === 'assistant_coach',
  ).length

  async function syncSessions() {
    setPending(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch('/api/schedule/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'sync',
          fromDate,
          toDate,
        }),
      })

      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to synchronize scheduled sessions.')
      }

      setMessage(
        `Session sync complete: ${data.created ?? 0} created, ${data.refreshed ?? 0} refreshed, ${data.removed ?? 0} obsolete future placeholders removed, ${data.protected ?? 0} protected.`,
      )
      setConfirmOpen(false)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
      setConfirmOpen(false)
    } finally {
      setPending(false)
    }
  }

  async function loadStaff() {
    if (staffLoaded || staffLoading) return
    setStaffLoading(true)
    setAssignmentError(null)
    try {
      const response = await fetch('/api/schedule/session-assignments', {
        method: 'GET',
        cache: 'no-store',
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to load coaching staff.')
      }
      setStaffOptions((data.items ?? []) as StaffOption[])
      setStaffLoaded(true)
    } catch (cause: any) {
      setAssignmentError(String(cause?.message || cause))
    } finally {
      setStaffLoading(false)
    }
  }

  function openAssignments(row: ScheduleTrainingSession) {
    const current = assignmentsBySession.get(row.id) ?? []
    const primary = current.find((assignment) => assignment.assignment_role === 'primary_coach')
    const assistants = current.filter((assignment) => assignment.assignment_role === 'assistant_coach')

    setAssignmentSession(row)
    setPrimaryUserId(primary?.staff_user_id ?? '')
    setAssistantUserIds(assistants.map((assignment) => assignment.staff_user_id))
    setAssignmentError(null)
    void loadStaff()
  }

  function closeAssignments() {
    if (assignmentPending) return
    setAssignmentSession(null)
    setAssignmentError(null)
  }

  function toggleAssistant(userId: string) {
    setAssistantUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length >= 6
          ? current
          : [...current, userId],
    )
  }

  async function saveAssignments() {
    if (!assignmentSession) return
    if (!primaryUserId && assistantUserIds.length > 0) {
      setAssignmentError('Choose a Primary Coach before adding assistants.')
      return
    }

    setAssignmentPending(true)
    setAssignmentError(null)

    try {
      const response = await fetch('/api/schedule/session-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: assignmentSession.id,
          primaryUserId: primaryUserId || null,
          assistantUserIds,
        }),
      })

      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to save coach assignments.')
      }

      setAssignmentSession(null)
      setMessage('Coach assignments updated.')
      router.refresh()
    } catch (cause: any) {
      setAssignmentError(String(cause?.message || cause))
    } finally {
      setAssignmentPending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <CalendarDays className="h-4 w-4" /> {personalView ? 'Assigned sessions' : 'Preview sessions'}
          </div>
          <div className="mt-1 text-2xl font-bold">{sessions.length}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{today} → {previewUntil}</div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            {personalView ? <UserCheck className="h-4 w-4" /> : <Layers3 className="h-4 w-4" />}
            {personalView ? 'Primary responsibility' : 'Class series'}
          </div>
          <div className="mt-1 text-2xl font-bold">{personalView ? myPrimaryCount : uniqueSeries}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {personalView ? 'sessions where you are Primary Coach' : 'represented in the preview'}
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <Users className="h-4 w-4" /> {personalView ? 'Assistant role' : 'Primary assigned'}
          </div>
          <div className="mt-1 text-2xl font-bold">{personalView ? myAssistantCount : sessionsWithPrimary}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {personalView ? 'sessions where you assist' : `${sessions.length - sessionsWithPrimary} still unassigned`}
          </div>
        </div>
      </div>

      {canManageSessions ? (
        <div className="space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft sm:p-5">
          <div>
            <h2 className="font-semibold">Generate / sync dated sessions</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Default range is the next 90 days. Sessions with active staff, QR attendance, a planned Training Program or a linked Training Log are protected from automatic refresh/removal.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="space-y-1.5 text-sm font-medium">
              <span>From</span>
              <Input type="date" min={today} value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>To</span>
              <Input type="date" min={fromDate || today} value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>

            <Button
              type="button"
              onClick={() => {
                setError(null)
                setMessage(null)
                if (!fromDate || !toDate) {
                  setError('Choose both dates.')
                  return
                }
                if (toDate < fromDate) {
                  setError('The end date must be on or after the start date.')
                  return
                }
                setConfirmOpen(true)
              }}
              disabled={pending}
            >
              <RefreshCw className="h-4 w-4" />
              Sync sessions
            </Button>
          </div>

          {message ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="font-semibold">{personalView ? 'My upcoming assignments' : 'Upcoming session preview'}</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            {personalView
              ? 'Next 14 calendar days. Only sessions assigned to you are shown.'
              : 'Next 14 calendar days with internal coaching assignments.'}
          </p>
        </div>

        {grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted))]">
            {personalView
              ? 'No coaching sessions are currently assigned to you in this preview window.'
              : 'No dated sessions have been generated for this preview window yet. Use Sync sessions above.'}
          </div>
        ) : (
          grouped.map(([date, rows]) => (
            <section key={date} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft">
              <div className="border-b border-[hsl(var(--border))] px-4 py-3">
                <h3 className="font-semibold">{formatDate(date)}</h3>
                <p className="text-xs text-[hsl(var(--muted))]">{rows.length} class{rows.length === 1 ? '' : 'es'}</p>
              </div>

              <div className="divide-y divide-[hsl(var(--border))]">
                {rows.map((row) => {
                  const sessionAssignments = assignmentsBySession.get(row.id) ?? []
                  const primary = sessionAssignments.find((assignment) => assignment.assignment_role === 'primary_coach')
                  const assistants = sessionAssignments.filter((assignment) => assignment.assignment_role === 'assistant_coach')
                  const programAssignment = programAssignmentBySession.get(row.id)

                  return (
                    <article key={row.id} className="space-y-3 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{row.name_snapshot}</div>
                          <div className="mt-0.5 text-sm text-[hsl(var(--muted))]">
                            {row.level_snapshot} · {activityLabel(row.activity_type_snapshot)} · {uniformLabel(row.uniform_snapshot)}
                          </div>
                        </div>

                        <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                          {row.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-4 w-4 text-[hsl(var(--muted))]" />
                          {formatTime(row.start_time)}
                          {row.end_time ? ` – ${formatTime(row.end_time)}` : ''}
                        </span>

                        {row.mat_snapshot ? (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin className="h-4 w-4 text-[hsl(var(--muted))]" />
                            {row.mat_snapshot}
                          </span>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.04)] px-3 py-2.5">
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Primary Coach</div>
                            <div className="mt-0.5 font-medium">
                              {primary ? primary.staff_name_snapshot : 'Unassigned'}
                            </div>
                            {primary ? (
                              <div className="text-xs text-[hsl(var(--muted))]">
                                {staffRoleLabel(primary.staff_profile_role_snapshot)}
                              </div>
                            ) : null}
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Assistant Coach(s)</div>
                            <div className="mt-0.5 font-medium">
                              {assistants.length
                                ? assistants.map((assignment) => assignment.staff_name_snapshot).join(', ')
                                : 'None'}
                            </div>
                          </div>
                        </div>

                        {canManageAssignments && row.status === 'scheduled' ? (
                          <div className="mt-3">
                            <Button type="button" size="sm" variant="outline" onClick={() => openAssignments(row)}>
                              <Users className="h-4 w-4" />
                              Manage coaches
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.04)] px-3 py-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                              <BookOpen className="h-3.5 w-3.5" /> Planned Training Program
                            </div>
                            <div className="mt-1 font-medium">
                              {programAssignment ? programAssignment.program_title_snapshot : 'Not assigned'}
                            </div>
                            {programAssignment ? (
                              <div className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                                {programAssignment.target_group_snapshot} · {formatDate(programAssignment.program_start_date_snapshot)} → {formatDate(programAssignment.program_end_date_snapshot)}
                              </div>
                            ) : (
                              <div className="mt-0.5 text-xs text-[hsl(var(--muted))]">Head Coach has not linked a published Training Program yet.</div>
                            )}
                          </div>

                          {canManageAssignments && row.status === 'scheduled' ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => openProgramAssignment(row)}>
                              <BookOpen className="h-4 w-4" />
                              Manage program
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <div className="text-xs text-[hsl(var(--muted))]">
                        {sessionAssignments.length > 0 || programAssignment
                          ? `Operationally linked · protected from automatic template sync`
                          : `${row.template_managed ? 'Template-managed' : 'Exception-locked'} · last sync ${formatCairoDateTime(row.synced_at)}`}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        onCancel={() => !pending && setConfirmOpen(false)}
        onConfirm={syncSessions}
        pending={pending}
        pendingLabel="Synchronizing…"
        title="Synchronize dated sessions?"
        description={`Sync ${fromDate || '—'} through ${toDate || '—'} from the active Class Templates. Existing future template-managed scheduled rows may be refreshed or removed if the recurring template changed.`}
        confirmLabel="Sync sessions"
        summaryItems={[
          { label: 'From', value: fromDate || '—' },
          { label: 'To', value: toDate || '—' },
          { label: 'Source', value: 'Active Class Templates' },
        ]}
        warning="Past, completed, cancelled, exception-locked and operationally linked sessions are not rewritten by this synchronization."
      />

      <Modal
        open={Boolean(programSession)}
        onClose={closeProgramAssignment}
        title={programSession ? `Training Program · ${programSession.name_snapshot}` : 'Training Program'}
        className="max-h-[86vh] overflow-y-auto"
      >
        {programSession ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.04)] px-3 py-2 text-sm">
              <div className="font-semibold">{formatDate(programSession.session_date)}</div>
              <div className="text-[hsl(var(--muted))]">
                {formatTime(programSession.start_time)}
                {programSession.end_time ? ` – ${formatTime(programSession.end_time)}` : ''}
                {programSession.mat_snapshot ? ` · ${programSession.mat_snapshot}` : ''}
              </div>
            </div>

            <Select
              label="Published Training Program"
              value={programId}
              onChange={(event) => setProgramId(event.target.value)}
              disabled={programPending}
            >
              <option value="">No program assigned</option>
              {eligibleProgramsForSession.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.title} · {program.target_group}
                </option>
              ))}
            </Select>

            {!eligibleProgramsForSession.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No published Training Program covers this session date. Create/publish the program first, or extend its date range.
              </div>
            ) : (
              <div className="text-xs text-[hsl(var(--muted))]">
                Programs whose target group exactly matches this session are listed first. The server still validates the program period before saving.
              </div>
            )}

            {programError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {programError}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeProgramAssignment} disabled={programPending}>
                Cancel
              </Button>
              <Button type="button" onClick={saveProgramAssignment} loading={programPending} loadingText="Saving…">
                Save program
              </Button>
            </div>

            <div className="text-xs text-[hsl(var(--muted))]">
              Program assignment history is preserved. Once a Training Log is linked to this dated session, its planned program can no longer be changed or cleared.
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(assignmentSession)}
        onClose={closeAssignments}
        title={assignmentSession ? `Coach assignment · ${assignmentSession.name_snapshot}` : 'Coach assignment'}
        className="max-h-[86vh] overflow-y-auto"
      >
        {assignmentSession ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.04)] px-3 py-2 text-sm">
              <div className="font-semibold">{formatDate(assignmentSession.session_date)}</div>
              <div className="text-[hsl(var(--muted))]">
                {formatTime(assignmentSession.start_time)}
                {assignmentSession.end_time ? ` – ${formatTime(assignmentSession.end_time)}` : ''}
                {assignmentSession.mat_snapshot ? ` · ${assignmentSession.mat_snapshot}` : ''}
              </div>
            </div>

            {staffLoading ? (
              <div className="text-sm text-[hsl(var(--muted))]">Loading coaching staff…</div>
            ) : (
              <>
                <Select
                  label="Primary Coach"
                  value={primaryUserId}
                  onChange={(event) => {
                    const value = event.target.value
                    setPrimaryUserId(value)
                    setAssistantUserIds((current) => current.filter((id) => id !== value))
                  }}
                  disabled={assignmentPending}
                >
                  <option value="">Unassigned</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.user_id} value={staff.user_id}>
                      {staff.full_name} · {staffRoleLabel(staff.role)}
                    </option>
                  ))}
                </Select>

                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-medium">Assistant Coach(s)</div>
                    <div className="text-xs text-[hsl(var(--muted))]">Optional · up to 6 staff members.</div>
                  </div>

                  {!primaryUserId ? (
                    <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-3 text-sm text-[hsl(var(--muted))]">
                      Choose a Primary Coach before adding assistants.
                    </div>
                  ) : (
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-[hsl(var(--border))] p-2">
                      {staffOptions
                        .filter((staff) => staff.user_id !== primaryUserId)
                        .map((staff) => {
                          const checked = assistantUserIds.includes(staff.user_id)
                          return (
                            <label
                              key={staff.user_id}
                              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-black/5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={assignmentPending || (!checked && assistantUserIds.length >= 6)}
                                onChange={() => toggleAssistant(staff.user_id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{staff.full_name}</span>
                                <span className="block text-xs text-[hsl(var(--muted))]">{staffRoleLabel(staff.role)}</span>
                              </span>
                            </label>
                          )
                        })}
                    </div>
                  )}
                </div>
              </>
            )}

            {assignmentError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {assignmentError}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={closeAssignments} disabled={assignmentPending}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={saveAssignments}
                loading={assignmentPending}
                loadingText="Saving…"
                disabled={staffLoading || Boolean(assignmentError && !staffLoaded)}
              >
                Save assignments
              </Button>
            </div>

            <div className="text-xs text-[hsl(var(--muted))]">
              Clearing all assignments is allowed. Assignment changes keep an audit history in the database; previous rows are deactivated rather than physically deleted.
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
