export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { CalendarDays, CheckCircle2, Clock3, ScanLine, UserRound } from 'lucide-react'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
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
}

type TrainingLogRow = {
  coach_user_id: string | null
  training_date: string
}

const CAIRO_TZ = 'Africa/Cairo'

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

export default async function CoachStaffAttendancePage() {
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

  let attendanceQuery = supabase
    .from('coach_staff_attendance')
    .select('id,staff_user_id,staff_name_snapshot,staff_member_id_snapshot,staff_role_snapshot,attendance_date,checked_in_at,device_tag,source,created_at')
    .order('attendance_date', { ascending: false })
    .order('checked_in_at', { ascending: false })
    .limit(150)

  if (!canManage) attendanceQuery = attendanceQuery.eq('staff_user_id', me.id)

  const [attendanceResult, logsResult] = await Promise.all([
    attendanceQuery,
    supabase
      .from('coach_training_session_logs')
      .select('coach_user_id,training_date')
      .eq('status', 'completed')
      .order('training_date', { ascending: false })
      .limit(300),
  ])

  const attendance = (attendanceResult.data ?? []) as StaffAttendanceRow[]
  const logs = (logsResult.data ?? []) as TrainingLogRow[]
  const loadError = attendanceResult.error?.message || logsResult.error?.message || null

  const completedLogsByStaffDay = new Map<string, number>()
  for (const log of logs) {
    if (!log.coach_user_id) continue
    const key = `${log.coach_user_id}:${log.training_date}`
    completedLogsByStaffDay.set(key, (completedLogsByStaffDay.get(key) ?? 0) + 1)
  }

  const today = cairoToday()
  const todayRows = attendance.filter((row) => row.attendance_date === today)
  const uniqueTodayStaff = new Set(todayRows.map((row) => row.staff_user_id)).size

  return (
    <main>
      <PageHeader
        title={canManage ? 'Staff Attendance' : 'My Staff Attendance'}
        subtitle="QR check-ins for the coaching team, kept separate from member attendance."
      />

      <Section className="max-w-6xl space-y-5">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Coaching staff must scan their existing ATOM QR at the academy scanner. A repeated scan within two hours reuses the recent check-in instead of creating another attendance row.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load staff attendance: {loadError}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <ScanLine size={17} />
                  Today check-ins
                </div>
                <div className="mt-3 text-3xl font-black">{todayRows.length}</div>
              </div>

              <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <UserRound size={17} />
                  {canManage ? 'Staff present today' : 'Today'}
                </div>
                <div className="mt-3 text-3xl font-black">{canManage ? uniqueTodayStaff : todayRows.length ? 'Checked in' : 'Not yet'}</div>
              </div>

              <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <CalendarDays size={17} />
                  History loaded
                </div>
                <div className="mt-3 text-3xl font-black">{attendance.length}</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
              <div className="border-b border-[hsl(var(--border))] px-4 py-4">
                <h2 className="text-lg font-semibold tracking-tight">{canManage ? 'Coaching team check-ins' : 'My QR check-ins'}</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  Completed Training Logs on the same date are shown for factual continuity only; this lot does not calculate a performance score.
                </p>
              </div>

              {attendance.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No staff QR check-in recorded yet.</div>
              ) : (
                <div className="divide-y divide-[hsl(var(--border))]">
                  {attendance.map((row) => {
                    const logCount = completedLogsByStaffDay.get(`${row.staff_user_id}:${row.attendance_date}`) ?? 0
                    return (
                      <div key={row.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_0.8fr_0.8fr_0.8fr] md:items-center">
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
