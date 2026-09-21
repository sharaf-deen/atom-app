export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { CalendarDays, CheckCircle2, Clock3, ScanLine, UserRound } from 'lucide-react'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { canAccessCoachStaffAttendance, canManageCoachStaffAttendance } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type StaffAttendanceRow = {
  id: string
  staff_user_id: string
  staff_name_snapshot: string
  staff_member_id_snapshot: string | null
  staff_role_snapshot: string
  attendance_date: string
  checked_in_at: string
  device_tag: string | null
  source: string
  created_at: string
  training_session_id: string | null
  session_match_status: 'matched' | 'unlinked' | 'ambiguous'
  session_match_candidate_count: number
  assignment_role_snapshot: 'primary_coach' | 'assistant_coach' | null
  session_name_snapshot: string | null
  session_start_time_snapshot: string | null
  session_end_time_snapshot: string | null
  session_mat_snapshot: string | null
  arrival_delta_minutes: number | null
}

type TrainingLogRow = {
  coach_user_id: string | null
  training_date: string
}

type CoachingProfile = {
  user_id: string
  first_name: string | null
  last_name: string | null
  role: string
}

type PageSearchParams = {
  coach?: string | string[]
  from?: string | string[]
  to?: string | string[]
}

const CAIRO_TZ = 'Africa/Cairo'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function cairoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function shiftDate(value: string, offsetDays: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function inclusiveDayCount(from: string, to: string) {
  const fromMs = new Date(`${from}T12:00:00Z`).getTime()
  const toMs = new Date(`${to}T12:00:00Z`).getTime()
  return Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1)
}

function profileName(profile: CoachingProfile) {
  return [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || 'Unnamed staff member'
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatCairoTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function roleLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatScheduleTime(value: string | null) {
  if (!value) return '—'
  const match = String(value).match(/^(\d{2}):(\d{2})/)
  if (!match) return value
  const hour = Number(match[1])
  const minute = Number(match[2])
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

function timingDeltaLabel(value: number | null) {
  if (value === null) return '—'
  if (value === 0) return '0 min from start'
  if (value < 0) return `${Math.abs(value)} min before start`
  return `${value} min after start`
}

export default async function CoachStaffAttendancePage({ searchParams }: { searchParams?: PageSearchParams }) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/coach-operations/staff-attendance')

  if (!canAccessCoachStaffAttendance(me.role)) {
    return (
      <AccessDeniedPage
        title="Staff Attendance"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Assistant Coach, Coach, Head Coach and Super Admin can access coaching staff attendance."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/coach-operations/staff-attendance"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const canManage = canManageCoachStaffAttendance(me.role)
  const supabase = createSupabaseRSC()
  const today = cairoToday()
  const defaultFrom = shiftDate(today, -29)
  const requestedFrom = firstParam(searchParams?.from).trim()
  const requestedTo = firstParam(searchParams?.to).trim()
  const requestedCoach = firstParam(searchParams?.coach).trim()
  const rawFrom = DATE_RE.test(requestedFrom) ? requestedFrom : defaultFrom
  const rawTo = DATE_RE.test(requestedTo) ? requestedTo : today
  const [from, to] = rawFrom <= rawTo ? [rawFrom, rawTo] : [rawTo, rawFrom]
  const coachFilter = canManage ? requestedCoach : me.id

  let attendanceQuery = supabase
    .from('coach_staff_attendance')
    .select('id,staff_user_id,staff_name_snapshot,staff_member_id_snapshot,staff_role_snapshot,attendance_date,checked_in_at,device_tag,source,created_at,training_session_id,session_match_status,session_match_candidate_count,assignment_role_snapshot,session_name_snapshot,session_start_time_snapshot,session_end_time_snapshot,session_mat_snapshot,arrival_delta_minutes')
    .gte('attendance_date', from)
    .lte('attendance_date', to)
    .order('attendance_date', { ascending: false })
    .order('checked_in_at', { ascending: false })
    .limit(2000)

  if (coachFilter) attendanceQuery = attendanceQuery.eq('staff_user_id', coachFilter)

  let logsQuery = supabase
    .from('coach_training_session_logs')
    .select('coach_user_id,training_date')
    .eq('status', 'completed')
    .gte('training_date', from)
    .lte('training_date', to)
    .order('training_date', { ascending: false })
    .limit(4000)

  if (coachFilter) logsQuery = logsQuery.eq('coach_user_id', coachFilter)

  const [attendanceResult, logsResult, profilesResult] = await Promise.all([
    attendanceQuery,
    logsQuery,
    canManage
      ? supabase
          .from('profiles')
          .select('user_id,first_name,last_name,role')
          .in('role', ['assistant_coach', 'coach', 'head_coach', 'super_admin'])
          .order('first_name', { ascending: true })
          .order('last_name', { ascending: true })
      : Promise.resolve({ data: [] as CoachingProfile[], error: null }),
  ])

  const attendance = (attendanceResult.data ?? []) as StaffAttendanceRow[]
  const logs = (logsResult.data ?? []) as TrainingLogRow[]
  const coachingProfiles = (profilesResult.data ?? []) as CoachingProfile[]
  const loadError = attendanceResult.error?.message || logsResult.error?.message || profilesResult.error?.message || null

  const completedLogsByStaffDay = new Map<string, number>()
  for (const log of logs) {
    if (!log.coach_user_id) continue
    const key = `${log.coach_user_id}:${log.training_date}`
    completedLogsByStaffDay.set(key, (completedLogsByStaffDay.get(key) ?? 0) + 1)
  }

  const uniqueStaff = new Set(attendance.map((row) => row.staff_user_id)).size
  const uniqueAttendanceDays = new Set(attendance.map((row) => row.attendance_date)).size
  const periodDays = inclusiveDayCount(from, to)
  const selectedCoachName = coachingProfiles.find((profile) => profile.user_id === coachFilter)
  const selectedCoachLabel = selectedCoachName ? profileName(selectedCoachName) : null

  function periodHref(days: number) {
    const params = new URLSearchParams()
    if (canManage && coachFilter) params.set('coach', coachFilter)
    params.set('from', shiftDate(today, -(days - 1)))
    params.set('to', today)
    return `/coach-operations/staff-attendance?${params.toString()}`
  }

  return (
    <main>
      <PageHeader
        title={canManage ? 'Staff Attendance' : 'My Staff Attendance'}
        subtitle="QR check-ins for the coaching team, kept separate from member attendance."
      />

      <Section className="max-w-6xl space-y-5">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Coaching staff scan their existing ATOM QR at the academy scanner. When one assigned dated session is safely identifiable near the scan time, ATOM links the check-in to that session. The two-hour duplicate rule now applies only to check-ins that remain unlinked.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load staff attendance: {loadError}
          </div>
        ) : (
          <>
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <form action="/coach-operations/staff-attendance" method="get" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto] lg:items-end">
                {canManage ? (
                  <Select name="coach" label="Coach" defaultValue={coachFilter}>
                    <option value="">All coaching staff</option>
                    {coachingProfiles.map((profile) => (
                      <option key={profile.user_id} value={profile.user_id}>
                        {profileName(profile)} · {roleLabel(profile.role)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input type="hidden" name="coach" value={me.id} />
                )}

                <Input name="from" label="From" type="date" defaultValue={from} max={to} />
                <Input name="to" label="To" type="date" defaultValue={to} min={from} max={today} />

                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Apply filters</Button>
                  <Button asChild href="/coach-operations/staff-attendance" variant="outline">
                    Reset
                  </Button>
                </div>
              </form>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] pt-4">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Quick period</span>
                <Button asChild href={periodHref(1)} variant="outline" size="sm">Today</Button>
                <Button asChild href={periodHref(7)} variant="outline" size="sm">Last 7 days</Button>
                <Button asChild href={periodHref(30)} variant="outline" size="sm">Last 30 days</Button>
                <span className="w-full text-xs text-[hsl(var(--muted))] sm:ml-auto sm:w-auto">
                  {attendance.length} {attendance.length === 1 ? 'result' : 'results'} · {formatDate(from)} → {formatDate(to)}
                  {selectedCoachLabel ? ` · ${selectedCoachLabel}` : ''}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <ScanLine size={17} />
                  Check-ins in period
                </div>
                <div className="mt-3 text-3xl font-black">{attendance.length}</div>
              </div>

              <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <UserRound size={17} />
                  {canManage ? 'Staff in period' : 'Days checked in'}
                </div>
                <div className="mt-3 text-3xl font-black">{canManage ? uniqueStaff : uniqueAttendanceDays}</div>
              </div>

              <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <CalendarDays size={17} />
                  Selected period
                </div>
                <div className="mt-3 text-3xl font-black">{periodDays}</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">{periodDays === 1 ? 'day' : 'days'}</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
              <div className="border-b border-[hsl(var(--border))] px-4 py-4">
                <h2 className="text-lg font-semibold tracking-tight">{canManage ? 'Coaching team check-ins' : 'My QR check-ins'}</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  Assigned-session links and timing deltas are factual only. Completed Training Logs on the same date remain shown for continuity; no on-time/late label or performance score is calculated.
                </p>
              </div>

              {attendance.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No staff QR check-in matches these filters.</div>
              ) : (
                <div className="divide-y divide-[hsl(var(--border))]">
                  {attendance.map((row) => {
                    const logCount = completedLogsByStaffDay.get(`${row.staff_user_id}:${row.attendance_date}`) ?? 0
                    return (
                      <div key={row.id} className="px-4 py-4">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_0.75fr_0.75fr_0.75fr] md:items-center">
                          <div className="min-w-0">
                            <div className="font-semibold tracking-tight">{row.staff_name_snapshot}</div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[hsl(var(--muted))]">
                              <span>{roleLabel(row.staff_role_snapshot)}</span>
                              {row.staff_member_id_snapshot ? <span>• {row.staff_member_id_snapshot}</span> : null}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Date</div>
                            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                              <CalendarDays size={15} />
                              {formatDate(row.attendance_date)}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">QR check-in</div>
                            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                              <Clock3 size={15} />
                              {formatCairoTime(row.checked_in_at)}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Training logs</div>
                            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                              <CheckCircle2 size={15} />
                              {logCount} completed
                            </div>
                            {canManage && row.device_tag ? (
                              <div className="mt-1 truncate text-[11px] text-[hsl(var(--muted))]">Device: {row.device_tag}</div>
                            ) : null}
                          </div>
                        </div>

                        {row.session_match_status === 'matched' ? (
                          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
                            <div className="font-semibold">{row.session_name_snapshot || 'Assigned scheduled session'}</div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                              <span>{formatScheduleTime(row.session_start_time_snapshot)}</span>
                              {row.session_mat_snapshot ? <span>• {row.session_mat_snapshot}</span> : null}
                              {row.assignment_role_snapshot ? <span>• {roleLabel(row.assignment_role_snapshot)}</span> : null}
                              <span>• Timing delta: {timingDeltaLabel(row.arrival_delta_minutes)}</span>
                            </div>
                          </div>
                        ) : row.session_match_status === 'ambiguous' ? (
                          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950">
                            Session link needs review — {row.session_match_candidate_count} assigned sessions were close to this QR time, so ATOM did not guess.
                          </div>
                        ) : (
                          <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3 text-xs text-[hsl(var(--muted))]">
                            No assigned scheduled session matched this QR check-in.
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </Section>
    </main>
  )
}
