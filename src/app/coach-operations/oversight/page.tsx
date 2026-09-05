export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import CoachOversightDashboard from '@/components/coach-operations/CoachOversightDashboard'
import { canAccessCoachOversight } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

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

function dateCutoff(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export default async function CoachOversightPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/coach-operations/oversight')

  if (!canAccessCoachOversight(me.role)) {
    return (
      <AccessDeniedPage
        title="Coach Oversight"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Head Coach and Super Admin can access the coaching team oversight dashboard."
        allowed="head_coach, super_admin"
        nextPath="/coach-operations/oversight"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const supabase = createSupabaseRSC()
  const cutoffDate = dateCutoff(100)
  const cutoffIso = `${cutoffDate}T00:00:00.000Z`

  const [profilesResult, programsResult, logsResult, attendanceResult, incidentsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id,member_id,first_name,last_name,role')
      .in('role', ['assistant_coach', 'coach', 'head_coach', 'super_admin'])
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true }),
    supabase
      .from('coach_training_programs')
      .select('id,title,target_group,start_date,end_date,status,published_at,updated_at')
      .order('start_date', { ascending: false })
      .limit(250),
    supabase
      .from('coach_training_session_logs')
      .select('id,program_id,target_group_snapshot,training_date,session_time,coach_user_id,coach_name_snapshot,coach_role_snapshot,status,completed_at,updated_at')
      .gte('training_date', cutoffDate)
      .order('training_date', { ascending: false })
      .order('session_time', { ascending: false })
      .limit(1000),
    supabase
      .from('coach_staff_attendance')
      .select('id,staff_user_id,staff_name_snapshot,staff_member_id_snapshot,staff_role_snapshot,attendance_date,checked_in_at')
      .gte('attendance_date', cutoffDate)
      .order('attendance_date', { ascending: false })
      .order('checked_in_at', { ascending: false })
      .limit(1000),
    supabase
      .from('coach_member_incidents')
      .select('id,member_id,member_name_snapshot,member_code_snapshot,training_group_snapshot,training_date_snapshot,category,severity,description,status,reported_by,reporter_name_snapshot,reporter_role_snapshot,reported_at,resolved_at')
      .gte('reported_at', cutoffIso)
      .order('reported_at', { ascending: false })
      .limit(500),
  ])

  const loadError =
    profilesResult.error?.message ||
    programsResult.error?.message ||
    logsResult.error?.message ||
    attendanceResult.error?.message ||
    incidentsResult.error?.message ||
    null

  return (
    <main>
      <PageHeader
        title="Coach Oversight"
        subtitle="Factual coaching activity from Training Programs, Training Logs, staff QR attendance and Member Incidents."
      />

      <Section className="max-w-7xl space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          This dashboard shows recorded facts only. It does not calculate a coach performance score and does not infer lateness or absence from the academy Schedule.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load Coach Operations oversight: {loadError}
          </div>
        ) : (
          <CoachOversightDashboard
            profiles={(profilesResult.data ?? []) as CoachingProfile[]}
            programs={(programsResult.data ?? []) as ProgramRow[]}
            logs={(logsResult.data ?? []) as TrainingLogRow[]}
            attendance={(attendanceResult.data ?? []) as StaffAttendanceRow[]}
            incidents={(incidentsResult.data ?? []) as IncidentRow[]}
          />
        )}
      </Section>
    </main>
  )
}
