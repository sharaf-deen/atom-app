'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileClock,
  Link2,
  ScanLine,
  UsersRound,
} from 'lucide-react'

type CoachingProfile = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  role: string
}

type ProgramRow = {
  id: string
  title: string
  target_group: string
  start_date: string
  end_date: string
  status: 'draft' | 'published' | 'archived'
  published_at: string | null
  updated_at: string
}

type TrainingLogRow = {
  id: string
  program_id: string
  training_session_id: string | null
  target_group_snapshot: string
  training_date: string
  session_time: string
  coach_user_id: string | null
  coach_name_snapshot: string
  coach_role_snapshot: string
  status: 'draft' | 'completed'
  completed_at: string | null
  updated_at: string
}

type StaffAttendanceRow = {
  id: string
  staff_user_id: string
  staff_name_snapshot: string
  staff_member_id_snapshot: string | null
  staff_role_snapshot: string
  attendance_date: string
  checked_in_at: string
  training_session_id: string | null
  session_match_status: 'matched' | 'unlinked' | 'ambiguous'
  session_match_candidate_count: number
  assignment_role_snapshot: 'primary_coach' | 'assistant_coach' | null
  session_name_snapshot: string | null
  session_start_time_snapshot: string | null
  arrival_delta_minutes: number | null
}

type IncidentRow = {
  id: string
  member_id: string
  member_name_snapshot: string
  member_code_snapshot: string | null
  training_group_snapshot: string | null
  training_date_snapshot: string | null
  category: string
  severity: 'low' | 'medium' | 'high'
  description: string
  status: 'open' | 'resolved'
  reported_by: string | null
  reporter_name_snapshot: string
  reporter_role_snapshot: string
  reported_at: string
  resolved_at: string | null
}

type TrainingSessionRow = {
  id: string
  session_date: string
  start_time: string
  end_time: string | null
  name_snapshot: string
  series_key_snapshot: string
  mat_snapshot: string | null
  status: 'scheduled' | 'completed' | 'cancelled'
  template_managed: boolean
}

type SessionAssignmentRow = {
  id: string
  training_session_id: string
  staff_user_id: string
  assignment_role: 'primary_coach' | 'assistant_coach'
  staff_name_snapshot: string
  staff_profile_role_snapshot: string
  is_active: boolean
}

type Props = {
  profiles: CoachingProfile[]
  programs: ProgramRow[]
  logs: TrainingLogRow[]
  attendance: StaffAttendanceRow[]
  incidents: IncidentRow[]
  sessions: TrainingSessionRow[]
  assignments: SessionAssignmentRow[]
}

type EvidenceFilter = 'all' | 'matched' | 'no_qr' | 'needs_review'
type AssignmentRoleFilter = 'all' | 'primary_coach' | 'assistant_coach'

const CAIRO_TZ = 'Africa/Cairo'

function cairoDateFromTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

function cairoNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function cairoToday() {
  return cairoDateFromTimestamp(new Date().toISOString())
}

function shiftDate(value: string, offsetDays: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function inRange(value: string | null | undefined, start: string, end: string) {
  return !!value && value >= start && value <= end
}

function displayDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function normalizeTime(value: string | null | undefined) {
  if (!value) return null
  const match = value.match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : value
}

function displayTime(value: string | null | undefined) {
  const normalized = normalizeTime(value)
  if (!normalized) return '—'
  const [hourText, minute] = normalized.split(':')
  const hour = Number(hourText)
  if (!Number.isFinite(hour)) return normalized
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute} ${suffix}`
}

function timeToMinutes(value: string | null | undefined) {
  const normalized = normalizeTime(value)
  if (!normalized) return null
  const [hour, minute] = normalized.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

function roleLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function categoryLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function assignmentRoleLabel(value: 'primary_coach' | 'assistant_coach') {
  return value === 'primary_coach' ? 'Primary Coach' : 'Assistant Coach'
}

function profileName(profile: CoachingProfile) {
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return name || profile.member_id || profile.user_id
}

function average(values: number[]) {
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return 'At scheduled start'
  if (value < 0) return `${Math.abs(value)} min before start`
  return `${value} min after start`
}

function MetricCard({
  label,
  value,
  icon,
  note,
}: {
  label: string
  value: string | number
  icon: ReactNode
  note?: string
}) {
  return (
    <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-3xl font-black tracking-tight">{value}</div>
      {note ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">{note}</div> : null}
    </div>
  )
}

export default function CoachOversightDashboard({
  profiles,
  programs,
  logs,
  attendance,
  incidents,
  sessions,
  assignments,
}: Props) {
  const [periodDays, setPeriodDays] = useState('30')
  const [coachFilter, setCoachFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [assignmentRoleFilter, setAssignmentRoleFilter] = useState<AssignmentRoleFilter>('all')
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all')

  const today = cairoToday()
  const nowMinutes = cairoNowMinutes()
  const startDate = shiftDate(today, -(Number(periodDays) - 1))

  const sessionMap = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const logBySession = useMemo(() => {
    const map = new Map<string, TrainingLogRow>()
    for (const log of logs) if (log.training_session_id) map.set(log.training_session_id, log)
    return map
  }, [logs])
  const attendanceByStaffSession = useMemo(() => {
    const map = new Map<string, StaffAttendanceRow>()
    for (const row of attendance) {
      if (row.training_session_id && row.session_match_status === 'matched') {
        map.set(`${row.staff_user_id}|${row.training_session_id}`, row)
      }
    }
    return map
  }, [attendance])
  const ambiguousByStaffDate = useMemo(() => {
    const map = new Map<string, StaffAttendanceRow[]>()
    for (const row of attendance) {
      if (row.session_match_status !== 'ambiguous') continue
      const key = `${row.staff_user_id}|${row.attendance_date}`
      const current = map.get(key) ?? []
      current.push(row)
      map.set(key, current)
    }
    return map
  }, [attendance])

  const groups = useMemo(() => {
    const values = new Set<string>()
    for (const session of sessions) if (session.name_snapshot) values.add(session.name_snapshot)
    for (const program of programs) if (program.target_group) values.add(program.target_group)
    for (const log of logs) if (log.target_group_snapshot) values.add(log.target_group_snapshot)
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [sessions, programs, logs])

  const periodSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          inRange(session.session_date, startDate, today) &&
          (groupFilter === 'all' || session.name_snapshot === groupFilter),
      ),
    [sessions, startDate, today, groupFilter],
  )
  const periodSessionIds = useMemo(() => new Set(periodSessions.map((session) => session.id)), [periodSessions])

  const obligationRows = useMemo(() => {
    return assignments
      .filter(
        (assignment) =>
          assignment.is_active &&
          periodSessionIds.has(assignment.training_session_id) &&
          (coachFilter === 'all' || assignment.staff_user_id === coachFilter) &&
          (assignmentRoleFilter === 'all' || assignment.assignment_role === assignmentRoleFilter),
      )
      .map((assignment) => {
        const session = sessionMap.get(assignment.training_session_id)!
        const startMinutes = timeToMinutes(session.start_time)
        const isCancelled = session.status === 'cancelled'
        const isDue =
          !isCancelled &&
          (session.status === 'completed' ||
            session.session_date < today ||
            (session.session_date === today && startMinutes !== null && startMinutes <= nowMinutes))
        const linkedAttendance = attendanceByStaffSession.get(`${assignment.staff_user_id}|${session.id}`) ?? null
        const ambiguousScans = ambiguousByStaffDate.get(`${assignment.staff_user_id}|${session.session_date}`) ?? []
        const trainingLog = logBySession.get(session.id) ?? null

        return {
          assignment,
          session,
          isCancelled,
          isDue,
          linkedAttendance,
          ambiguousScans,
          trainingLog,
          needsReview: isDue && !linkedAttendance && ambiguousScans.length > 0,
        }
      })
      .sort((a, b) => {
        if (a.session.session_date !== b.session.session_date) return b.session.session_date.localeCompare(a.session.session_date)
        return b.session.start_time.localeCompare(a.session.start_time)
      })
  }, [
    assignments,
    periodSessionIds,
    coachFilter,
    assignmentRoleFilter,
    sessionMap,
    attendanceByStaffSession,
    ambiguousByStaffDate,
    logBySession,
    today,
    nowMinutes,
  ])

  const dueObligations = obligationRows.filter((row) => row.isDue)
  const matchedObligations = dueObligations.filter((row) => !!row.linkedAttendance)
  const noQrObligations = dueObligations.filter((row) => !row.linkedAttendance)
  const needsReviewObligations = noQrObligations.filter((row) => row.needsReview)
  const cancelledAssignments = obligationRows.filter((row) => row.isCancelled)

  const matchedDeltas = matchedObligations
    .map((row) => row.linkedAttendance?.arrival_delta_minutes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  const uniqueDueSessionIds = new Set(dueObligations.map((row) => row.session.id))
  const sessionsWithCompletedLog = [...uniqueDueSessionIds].filter(
    (sessionId) => logBySession.get(sessionId)?.status === 'completed',
  ).length

  const periodAttendance = useMemo(
    () =>
      attendance.filter((row) => {
        if (!inRange(row.attendance_date, startDate, today)) return false
        if (coachFilter !== 'all' && row.staff_user_id !== coachFilter) return false
        if (groupFilter === 'all') return true
        return !!row.training_session_id && sessionMap.get(row.training_session_id)?.name_snapshot === groupFilter
      }),
    [attendance, startDate, today, coachFilter, groupFilter, sessionMap],
  )
  const ambiguousScans = periodAttendance.filter((row) => row.session_match_status === 'ambiguous')
  const unlinkedScans = periodAttendance.filter((row) => row.session_match_status === 'unlinked')

  const periodIncidents = useMemo(
    () =>
      incidents.filter((row) => {
        const date = cairoDateFromTimestamp(row.reported_at)
        return inRange(date, startDate, today) && (groupFilter === 'all' || row.training_group_snapshot === groupFilter)
      }),
    [incidents, startDate, today, groupFilter],
  )
  const openIncidents = periodIncidents.filter((row) => row.status === 'open')
  const highOpenIncidents = openIncidents.filter((row) => row.severity === 'high')

  const periodPrograms = useMemo(
    () =>
      programs.filter(
        (row) =>
          row.end_date >= startDate &&
          row.start_date <= today &&
          (groupFilter === 'all' || row.target_group === groupFilter),
      ),
    [programs, startDate, today, groupFilter],
  )
  const publishedPrograms = periodPrograms.filter((row) => row.status === 'published')

  const teamRows = useMemo(() => {
    return profiles
      .filter((profile) => coachFilter === 'all' || profile.user_id === coachFilter)
      .map((profile) => {
        const rows = obligationRows.filter((row) => row.assignment.staff_user_id === profile.user_id && row.isDue)
        const linked = rows.filter((row) => !!row.linkedAttendance)
        const noQr = rows.filter((row) => !row.linkedAttendance)
        const needsReview = noQr.filter((row) => row.needsReview)
        const deltas = linked
          .map((row) => row.linkedAttendance?.arrival_delta_minutes)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        const completedLogSessions = new Set(
          rows.filter((row) => row.trainingLog?.status === 'completed').map((row) => row.session.id),
        )
        const noLogSessions = new Set(rows.filter((row) => !row.trainingLog).map((row) => row.session.id))
        const lastSession = rows.map((row) => row.session.session_date).sort().at(-1) ?? null

        return {
          id: profile.user_id,
          name: profileName(profile),
          memberId: profile.member_id,
          role: profile.role,
          assigned: rows.length,
          qr: linked.length,
          noQr: noQr.length,
          needsReview: needsReview.length,
          completedLogs: completedLogSessions.size,
          noLog: noLogSessions.size,
          medianDelta: median(deltas),
          lastSession,
        }
      })
      .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name))
  }, [profiles, coachFilter, obligationRows])

  const groupRows = useMemo(() => {
    const map = new Map<
      string,
      {
        group: string
        sessions: Set<string>
        assigned: number
        qr: number
        noQr: number
        completedLogs: Set<string>
        lastSession: string | null
      }
    >()

    for (const row of dueObligations) {
      const key = row.session.name_snapshot
      const current = map.get(key) ?? {
        group: key,
        sessions: new Set<string>(),
        assigned: 0,
        qr: 0,
        noQr: 0,
        completedLogs: new Set<string>(),
        lastSession: null,
      }
      current.sessions.add(row.session.id)
      current.assigned += 1
      if (row.linkedAttendance) current.qr += 1
      else current.noQr += 1
      if (row.trainingLog?.status === 'completed') current.completedLogs.add(row.session.id)
      if (!current.lastSession || row.session.session_date > current.lastSession) current.lastSession = row.session.session_date
      map.set(key, current)
    }

    return [...map.values()]
      .map((row) => ({
        group: row.group,
        sessions: row.sessions.size,
        assignments: row.assigned,
        qr: row.qr,
        noQr: row.noQr,
        completedLogs: row.completedLogs.size,
        lastSession: row.lastSession,
      }))
      .sort((a, b) => b.sessions - a.sessions || a.group.localeCompare(b.group))
  }, [dueObligations])

  const evidenceRows = obligationRows.filter((row) => {
    if (evidenceFilter === 'all') return true
    if (evidenceFilter === 'matched') return row.isDue && !!row.linkedAttendance
    if (evidenceFilter === 'no_qr') return row.isDue && !row.linkedAttendance
    return row.needsReview
  })

  const attentionIncidents = [...openIncidents]
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 }
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
      if (severityDiff) return severityDiff
      return b.reported_at.localeCompare(a.reported_at)
    })
    .slice(0, 10)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Period</span>
          <select
            value={periodDays}
            onChange={(event) => setPeriodDays(event.target.value)}
            className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Coach</span>
          <select
            value={coachFilter}
            onChange={(event) => setCoachFilter(event.target.value)}
            className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3"
          >
            <option value="all">All coaching staff</option>
            {profiles.map((profile) => (
              <option key={profile.user_id} value={profile.user_id}>
                {profileName(profile)} · {roleLabel(profile.role)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Group / Class</span>
          <select
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
            className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3"
          >
            <option value="all">All groups</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Assignment</span>
          <select
            value={assignmentRoleFilter}
            onChange={(event) => setAssignmentRoleFilter(event.target.value as AssignmentRoleFilter)}
            className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3"
          >
            <option value="all">Primary + Assistant</option>
            <option value="primary_coach">Primary Coach</option>
            <option value="assistant_coach">Assistant Coach</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Evidence</span>
          <select
            value={evidenceFilter}
            onChange={(event) => setEvidenceFilter(event.target.value as EvidenceFilter)}
            className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3"
          >
            <option value="all">All session evidence</option>
            <option value="matched">QR matched</option>
            <option value="no_qr">No linked QR</option>
            <option value="needs_review">Needs review</option>
          </select>
        </label>
      </div>

      <div className="text-xs text-[hsl(var(--muted))]">
        Window: {displayDate(startDate)} → {displayDate(today)}. Only sessions whose scheduled start has already been reached are counted as attendance obligations. Cancelled sessions are excluded. A same-day ambiguous QR can flag an obligation for review, but it is never auto-linked here.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Assigned obligations"
          value={dueObligations.length}
          icon={<CalendarDays size={17} />}
          note={`${cancelledAssignments.length} cancelled assignment${cancelledAssignments.length === 1 ? '' : 's'} excluded`}
        />
        <MetricCard label="Linked QR" value={matchedObligations.length} icon={<Link2 size={17} />} />
        <MetricCard label="No linked QR" value={noQrObligations.length} icon={<ScanLine size={17} />} />
        <MetricCard
          label="Needs review"
          value={needsReviewObligations.length}
          icon={<AlertTriangle size={17} />}
          note={`${ambiguousScans.length} ambiguous QR scan${ambiguousScans.length === 1 ? '' : 's'}`}
        />
        <MetricCard
          label="Median QR delta"
          value={formatDelta(median(matchedDeltas))}
          icon={<Clock3 size={17} />}
          note={`Average: ${formatDelta(average(matchedDeltas))}`}
        />
        <MetricCard
          label="Sessions with log"
          value={sessionsWithCompletedLog}
          icon={<CheckCircle2 size={17} />}
          note={`${uniqueDueSessionIds.size} scheduled session${uniqueDueSessionIds.size === 1 ? '' : 's'} represented`}
        />
      </div>

      <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
        <div className="border-b border-[hsl(var(--border))] px-4 py-4">
          <div className="flex items-center gap-2">
            <UsersRound size={19} />
            <h2 className="text-lg font-semibold tracking-tight">Coaching obligations by staff</h2>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Each row is based on real dated-session assignments. QR counts require an actual session link; timing is the raw stored arrival delta.
          </p>
        </div>

        {teamRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No assigned coaching obligations in this view.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1120px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">Coach</th>
                  <th className="px-3 py-3">Assigned</th>
                  <th className="px-3 py-3">QR</th>
                  <th className="px-3 py-3">No QR</th>
                  <th className="px-3 py-3">Review</th>
                  <th className="px-3 py-3">Logs</th>
                  <th className="px-3 py-3">No log</th>
                  <th className="px-3 py-3">Median delta</th>
                  <th className="px-4 py-3">Last session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {teamRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-xs text-[hsl(var(--muted))]">
                        {roleLabel(row.role)}
                        {row.memberId ? ` · ${row.memberId}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold">{row.assigned}</td>
                    <td className="px-3 py-3 font-semibold">{row.qr}</td>
                    <td className="px-3 py-3">{row.noQr}</td>
                    <td className="px-3 py-3">{row.needsReview}</td>
                    <td className="px-3 py-3">{row.completedLogs}</td>
                    <td className="px-3 py-3">{row.noLog}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDelta(row.medianDelta)}</td>
                    <td className="px-4 py-3">{displayDate(row.lastSession)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
        <div className="border-b border-[hsl(var(--border))] px-4 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Session evidence drill-down</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Exact scheduled obligation, QR evidence and linked Training Log. “Needs review” only means an ambiguous staff QR exists on the same Cairo date; no session is guessed.
          </p>
        </div>

        {evidenceRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No sessions match this evidence filter.</div>
        ) : (
          <div className="divide-y divide-[hsl(var(--border))]">
            {evidenceRows.slice(0, 80).map((row) => {
              const attendanceRow = row.linkedAttendance
              const isFutureToday = !row.isDue && !row.isCancelled && row.session.session_date === today
              return (
                <div key={row.assignment.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.assignment.staff_name_snapshot}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {assignmentRoleLabel(row.assignment.assignment_role)}
                      </span>
                      {!row.session.template_managed ? (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Exception</span>
                      ) : null}
                      {row.isCancelled ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">Cancelled · excluded</span>
                      ) : isFutureToday ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">Not due yet</span>
                      ) : null}
                    </div>
                    <div className="mt-2 font-semibold">{row.session.name_snapshot}</div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {displayDate(row.session.session_date)} · {displayTime(row.session.start_time)}
                      {row.session.end_time ? `–${displayTime(row.session.end_time)}` : ''}
                      {row.session.mat_snapshot ? ` · ${row.session.mat_snapshot}` : ''}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">QR evidence</div>
                    {row.isCancelled ? (
                      <div className="mt-2 text-sm">Excluded from attendance expectation.</div>
                    ) : attendanceRow ? (
                      <div className="mt-2 text-sm">
                        <div className="font-semibold">QR matched</div>
                        <div className="mt-1 text-[hsl(var(--muted))]">
                          Check-in {new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(attendanceRow.checked_in_at))}
                        </div>
                        <div className="mt-1 font-medium">{formatDelta(attendanceRow.arrival_delta_minutes)}</div>
                      </div>
                    ) : row.needsReview ? (
                      <div className="mt-2 text-sm">
                        <div className="font-semibold text-amber-800">Needs review</div>
                        <div className="mt-1 text-[hsl(var(--muted))]">
                          {row.ambiguousScans.length} ambiguous QR scan{row.ambiguousScans.length === 1 ? '' : 's'} recorded on the same day. No session link was inferred.
                        </div>
                      </div>
                    ) : row.isDue ? (
                      <div className="mt-2 text-sm font-semibold text-slate-700">No linked QR</div>
                    ) : (
                      <div className="mt-2 text-sm text-[hsl(var(--muted))]">No attendance expectation yet.</div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Training Log</div>
                    {row.trainingLog ? (
                      <div className="mt-2 text-sm">
                        <div className="font-semibold">{row.trainingLog.status === 'completed' ? 'Completed' : 'Draft'}</div>
                        <div className="mt-1 text-[hsl(var(--muted))]">Reported by {row.trainingLog.coach_name_snapshot}</div>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-[hsl(var(--muted))]">No linked Training Log</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
          <div className="border-b border-[hsl(var(--border))] px-4 py-4">
            <h2 className="text-lg font-semibold tracking-tight">Group continuity</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Real dated sessions and their linked coaching evidence in the selected period.</p>
          </div>

          {groupRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No due assigned sessions in this view.</div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {groupRows.slice(0, 12).map((row) => (
                <div key={row.group} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3">
                  <div>
                    <div className="font-semibold">{row.group}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {row.sessions} dated session{row.sessions === 1 ? '' : 's'} · {row.assignments} staff obligation{row.assignments === 1 ? '' : 's'} · last {displayDate(row.lastSession)}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-semibold">{row.qr} QR · {row.noQr} no QR</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{row.completedLogs} session log{row.completedLogs === 1 ? '' : 's'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
          <div className="border-b border-[hsl(var(--border))] px-4 py-4">
            <h2 className="text-lg font-semibold tracking-tight">Open incidents requiring attention</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">High severity first. Internal record only; no automatic disciplinary action.</p>
          </div>

          {attentionIncidents.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No open incidents in this view.</div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {attentionIncidents.map((incident) => (
                <div key={incident.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                        incident.severity === 'high'
                          ? 'bg-rose-100 text-rose-800'
                          : incident.severity === 'medium'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {incident.severity}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                      {categoryLabel(incident.category)}
                    </span>
                  </div>
                  <div className="mt-2 font-semibold">
                    {incident.member_name_snapshot}
                    {incident.member_code_snapshot ? ` · ${incident.member_code_snapshot}` : ''}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm text-slate-700">{incident.description}</div>
                  <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                    Reported by {incident.reporter_name_snapshot} · {displayDate(cairoDateFromTimestamp(incident.reported_at))}
                    {incident.training_group_snapshot ? ` · ${incident.training_group_snapshot}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Published programs" value={publishedPrograms.length} icon={<ClipboardList size={17} />} />
        <MetricCard label="Ambiguous QR scans" value={ambiguousScans.length} icon={<AlertTriangle size={17} />} />
        <MetricCard label="Unlinked QR scans" value={unlinkedScans.length} icon={<ScanLine size={17} />} />
        <MetricCard label="Open / high incidents" value={`${openIncidents.length} / ${highOpenIncidents.length}`} icon={<FileClock size={17} />} />
      </div>
    </div>
  )
}
