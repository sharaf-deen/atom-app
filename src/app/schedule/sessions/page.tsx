export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import TrainingSessionsManager from '@/components/schedule/TrainingSessionsManager'
import {
  canAccessScheduleTrainingSessions,
  canManageScheduleSessionCoachAssignments,
  canManageScheduleTrainingSessions,
} from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

export type ScheduleTrainingSession = {
  id: string
  class_template_id: string
  session_date: string
  start_time: string
  end_time: string | null
  series_key_snapshot: string
  name_snapshot: string
  audience_snapshot: 'kids_teens' | 'adults' | 'all'
  age_min_snapshot: number | null
  age_max_snapshot: number | null
  level_snapshot: string
  activity_type_snapshot:
    | 'jiu_jitsu'
    | 'competition'
    | 'open_drills'
    | 'open_mat'
    | 'physical_preparation'
    | 'wrestling'
    | 'other'
  uniform_snapshot: 'gi' | 'nogi' | 'gi_nogi' | 'none'
  mat_snapshot: string | null
  notes_snapshot: string | null
  status: 'scheduled' | 'completed' | 'cancelled'
  template_managed: boolean
  generated_at: string
  synced_at: string
}

export type ScheduleSessionCoachAssignment = {
  id: string
  training_session_id: string
  staff_user_id: string
  assignment_role: 'primary_coach' | 'assistant_coach'
  staff_name_snapshot: string
  staff_profile_role_snapshot: 'assistant_coach' | 'coach' | 'head_coach' | 'super_admin'
  assigned_at: string
}

function cairoDateIso() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export default async function ScheduleTrainingSessionsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/schedule/sessions')

  if (!canAccessScheduleTrainingSessions(me.role)) {
    return (
      <AccessDeniedPage
        title="Scheduled Sessions"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This structured coaching schedule is available to the ATOM coaching team only."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/schedule/sessions"
        actions={[{ href: '/schedule', label: 'Open Schedule' }]}
        showBackHome
      />
    )
  }

  const canManageSessions = canManageScheduleTrainingSessions(me.role)
  const canManageAssignments = canManageScheduleSessionCoachAssignments(me.role)
  const personalView = !canManageSessions
  const today = cairoDateIso()
  const previewUntil = addDays(today, 13)
  const defaultSyncUntil = addDays(today, 89)

  const supabase = createSupabaseRSC()
  const { data: sessionData, error: sessionError } = await supabase
    .from('schedule_training_sessions')
    .select(
      'id,class_template_id,session_date,start_time,end_time,series_key_snapshot,name_snapshot,audience_snapshot,age_min_snapshot,age_max_snapshot,level_snapshot,activity_type_snapshot,uniform_snapshot,mat_snapshot,notes_snapshot,status,template_managed,generated_at,synced_at',
    )
    .gte('session_date', today)
    .lte('session_date', previewUntil)
    .order('session_date', { ascending: true })
    .order('start_time', { ascending: true })
    .order('name_snapshot', { ascending: true })

  let sessions = (sessionData ?? []) as ScheduleTrainingSession[]
  let assignments: ScheduleSessionCoachAssignment[] = []
  let assignmentError: string | null = null

  if (!sessionError && sessions.length > 0) {
    const allSessionIds = sessions.map((row) => row.id)

    if (personalView) {
      const { data: ownData, error: ownError } = await supabase
        .from('schedule_session_coach_assignments')
        .select('training_session_id')
        .eq('is_active', true)
        .eq('staff_user_id', me.id)
        .in('training_session_id', allSessionIds)

      if (ownError) {
        assignmentError = ownError.message
        sessions = []
      } else {
        const ownSessionIds = new Set((ownData ?? []).map((row: any) => String(row.training_session_id)))
        sessions = sessions.filter((row) => ownSessionIds.has(row.id))
      }
    }

    const visibleSessionIds = sessions.map((row) => row.id)
    if (visibleSessionIds.length > 0) {
      const { data: assignmentData, error: activeAssignmentError } = await supabase
        .from('schedule_session_coach_assignments')
        .select(
          'id,training_session_id,staff_user_id,assignment_role,staff_name_snapshot,staff_profile_role_snapshot,assigned_at',
        )
        .eq('is_active', true)
        .in('training_session_id', visibleSessionIds)
        .order('assignment_role', { ascending: false })
        .order('staff_name_snapshot', { ascending: true })

      if (activeAssignmentError) {
        assignmentError = activeAssignmentError.message
      } else {
        assignments = (assignmentData ?? []) as ScheduleSessionCoachAssignment[]
      }
    }
  }

  const loadError = sessionError?.message ?? assignmentError

  return (
    <main>
      <PageHeader
        title={personalView ? 'My Assigned Sessions' : 'Scheduled Sessions'}
        subtitle={
          personalView
            ? 'Your upcoming structured ATOM coaching assignments.'
            : 'Dated academy sessions with responsible coach and assistant-coach assignments.'
        }
      />
      <Section className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canManageSessions ? (
            <Link
              href="/schedule/templates"
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 font-medium hover:bg-[hsl(var(--muted)/0.08)]"
            >
              Class Templates
            </Link>
          ) : null}
          <Link
            href="/schedule"
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 font-medium hover:bg-[hsl(var(--muted)/0.08)]"
          >
            Member Schedule
          </Link>
        </div>

        {personalView ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            This view shows only sessions where you are currently assigned as Primary Coach or Assistant Coach. Assignment management remains restricted to Head Coach and Super Admin.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              Lot 2D adds internal staffing to the real dated Schedule. Primary Coach and Assistant Coach assignments are not exposed on the member-facing Schedule.
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              A future session with active staff assignments is protected from automatic template synchronization. Clear its staff assignments before intentionally moving or removing that dated session through a recurring-template change.
            </div>
          </>
        )}

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load scheduled sessions: {loadError}
          </div>
        ) : (
          <TrainingSessionsManager
            canManageSessions={canManageSessions}
            canManageAssignments={canManageAssignments}
            personalView={personalView}
            viewerUserId={me.id}
            sessions={sessions}
            assignments={assignments}
            today={today}
            previewUntil={previewUntil}
            defaultSyncUntil={defaultSyncUntil}
          />
        )}
      </Section>
    </main>
  )
}
