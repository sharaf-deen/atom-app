'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileClock,
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

type Props = {
  profiles: CoachingProfile[]
  programs: ProgramRow[]
  logs: TrainingLogRow[]
  attendance: StaffAttendanceRow[]
  incidents: IncidentRow[]
}

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

function roleLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function categoryLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function profileName(profile: CoachingProfile) {
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return name || profile.member_id || profile.user_id
}

function lastDate(values: string[]) {
  return values.filter(Boolean).sort().at(-1) ?? null
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

export default function CoachOversightDashboard({ profiles, programs, logs, attendance, incidents }: Props) {
  const [periodDays, setPeriodDays] = useState('30')
  const [coachFilter, setCoachFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')

  const today = cairoToday()
  const startDate = shiftDate(today, -(Number(periodDays) - 1))

  const groups = useMemo(() => {
    const values = new Set<string>()
    for (const program of programs) if (program.target_group) values.add(program.target_group)
    for (const log of logs) if (log.target_group_snapshot) values.add(log.target_group_snapshot)
    for (const incident of incidents) if (incident.training_group_snapshot) values.add(incident.training_group_snapshot)
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [programs, logs, incidents])

  const periodAttendance = useMemo(
    () => attendance.filter((row) => inRange(row.attendance_date, startDate, today)),
    [attendance, startDate, today],
  )

  const periodLogs = useMemo(
    () =>
      logs.filter(
        (row) =>
          inRange(row.training_date, startDate, today) &&
          (groupFilter === 'all' || row.target_group_snapshot === groupFilter),
      ),
    [logs, startDate, today, groupFilter],
  )

  const periodIncidents = useMemo(
    () =>
      incidents.filter((row) => {
        const date = cairoDateFromTimestamp(row.reported_at)
        return (
          inRange(date, startDate, today) &&
          (groupFilter === 'all' || row.training_group_snapshot === groupFilter)
        )
      }),
    [incidents, startDate, today, groupFilter],
  )

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

  const selectedAttendance =
    coachFilter === 'all' ? periodAttendance : periodAttendance.filter((row) => row.staff_user_id === coachFilter)
  const selectedLogs =
    coachFilter === 'all' ? periodLogs : periodLogs.filter((row) => row.coach_user_id === coachFilter)

  const completedLogs = selectedLogs.filter((row) => row.status === 'completed')
  const draftLogs = selectedLogs.filter((row) => row.status === 'draft')
  const publishedPrograms = periodPrograms.filter((row) => row.status === 'published')
  const openIncidents = periodIncidents.filter((row) => row.status === 'open')
  const highOpenIncidents = openIncidents.filter((row) => row.severity === 'high')

  const teamRows = useMemo(() => {
    return profiles
      .filter((profile) => coachFilter === 'all' || profile.user_id === coachFilter)
      .map((profile) => {
        const staffAttendance = periodAttendance.filter((row) => row.staff_user_id === profile.user_id)
        const staffLogs = periodLogs.filter((row) => row.coach_user_id === profile.user_id)
        const staffCompleted = staffLogs.filter((row) => row.status === 'completed')
        const staffDraft = staffLogs.filter((row) => row.status === 'draft')

        const checkinDays = new Set(staffAttendance.map((row) => row.attendance_date))
        const completedLogDays = new Set(staffCompleted.map((row) => row.training_date))
        const matchedDays = [...checkinDays].filter((day) => completedLogDays.has(day)).length
        const checkinWithoutLogDays = [...checkinDays].filter((day) => !completedLogDays.has(day)).length
        const logWithoutCheckinDays = [...completedLogDays].filter((day) => !checkinDays.has(day)).length

        const activityDates = [
          ...staffAttendance.map((row) => row.attendance_date),
          ...staffLogs.map((row) => row.training_date),
        ]

        return {
          id: profile.user_id,
          name: profileName(profile),
          memberId: profile.member_id,
          role: profile.role,
          checkins: staffAttendance.length,
          completed: staffCompleted.length,
          drafts: staffDraft.length,
          matchedDays,
          checkinWithoutLogDays,
          logWithoutCheckinDays,
          lastActivity: lastDate(activityDates),
        }
      })
      .sort((a, b) => {
        const aActivity = a.lastActivity ?? ''
        const bActivity = b.lastActivity ?? ''
        if (aActivity !== bActivity) return bActivity.localeCompare(aActivity)
        return a.name.localeCompare(b.name)
      })
  }, [profiles, coachFilter, periodAttendance, periodLogs])

  const groupRows = useMemo(() => {
    const map = new Map<
      string,
      { group: string; completed: number; drafts: number; coachIds: Set<string>; lastSession: string | null }
    >()

    for (const log of selectedLogs) {
      const key = log.target_group_snapshot
      const row = map.get(key) ?? {
        group: key,
        completed: 0,
        drafts: 0,
        coachIds: new Set<string>(),
        lastSession: null,
      }

      if (log.status === 'completed') row.completed += 1
      else row.drafts += 1
      if (log.coach_user_id) row.coachIds.add(log.coach_user_id)
      if (!row.lastSession || log.training_date > row.lastSession) row.lastSession = log.training_date
      map.set(key, row)
    }

    return [...map.values()]
      .map((row) => ({ ...row, coaches: row.coachIds.size }))
      .sort((a, b) => b.completed - a.completed || a.group.localeCompare(b.group))
  }, [selectedLogs])

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
      <div className="grid gap-3 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft md:grid-cols-3">
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
      </div>

      <div className="text-xs text-[hsl(var(--muted))]">
        Window: {displayDate(startDate)} → {displayDate(today)}. QR attendance is factual staff presence; group filtering applies to Training Logs, Programs and linked Incidents because attendance is not yet tied to a structured scheduled class.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="QR check-ins" value={selectedAttendance.length} icon={<ScanLine size={17} />} />
        <MetricCard label="Completed logs" value={completedLogs.length} icon={<CheckCircle2 size={17} />} />
        <MetricCard label="Draft logs" value={draftLogs.length} icon={<FileClock size={17} />} />
        <MetricCard label="Published programs" value={publishedPrograms.length} icon={<CalendarDays size={17} />} />
        <MetricCard label="Open incidents" value={openIncidents.length} icon={<ClipboardList size={17} />} />
        <MetricCard
          label="High severity"
          value={highOpenIncidents.length}
          icon={<AlertTriangle size={17} />}
          note="Open only"
        />
      </div>

      <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
        <div className="border-b border-[hsl(var(--border))] px-4 py-4">
          <div className="flex items-center gap-2">
            <UsersRound size={19} />
            <h2 className="text-lg font-semibold tracking-tight">Coaching team activity</h2>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Same-day matches compare QR check-in dates with completed Training Log dates. They do not prove a specific scheduled class or punctuality.
          </p>
        </div>

        {teamRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">
            No coaching profiles match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">Coach</th>
                  <th className="px-3 py-3">QR</th>
                  <th className="px-3 py-3">Completed</th>
                  <th className="px-3 py-3">Draft</th>
                  <th className="px-3 py-3">Matched days</th>
                  <th className="px-3 py-3">QR / no log</th>
                  <th className="px-3 py-3">Log / no QR</th>
                  <th className="px-4 py-3">Last activity</th>
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
                    <td className="px-3 py-3 font-semibold">{row.checkins}</td>
                    <td className="px-3 py-3 font-semibold">{row.completed}</td>
                    <td className="px-3 py-3">{row.drafts}</td>
                    <td className="px-3 py-3">{row.matchedDays}</td>
                    <td className="px-3 py-3">{row.checkinWithoutLogDays}</td>
                    <td className="px-3 py-3">{row.logWithoutCheckinDays}</td>
                    <td className="px-4 py-3">{displayDate(row.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
          <div className="border-b border-[hsl(var(--border))] px-4 py-4">
            <h2 className="text-lg font-semibold tracking-tight">Group continuity</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Training Logs actually recorded for each group in the selected period.
            </p>
          </div>

          {groupRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No Training Logs in this view.</div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {groupRows.slice(0, 12).map((row) => (
                <div key={row.group} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3">
                  <div>
                    <div className="font-semibold">{row.group}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {row.coaches} coach{row.coaches === 1 ? '' : 'es'} · last session {displayDate(row.lastSession)}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-semibold">{row.completed} completed</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{row.drafts} draft</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
          <div className="border-b border-[hsl(var(--border))] px-4 py-4">
            <h2 className="text-lg font-semibold tracking-tight">Open incidents requiring attention</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              High severity first. This is an internal coaching record, not an automatic disciplinary action.
            </p>
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
    </div>
  )
}
