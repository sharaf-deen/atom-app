export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import TrainingSessionsManager from '@/components/schedule/TrainingSessionsManager'
import { canAccessScheduleTrainingSessions, canManageScheduleTrainingSessions } from '@/lib/rbac'
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
        message="Only Head Coach and Super Admin can generate and review structured dated training sessions."
        allowed="head_coach, super_admin"
        nextPath="/schedule/sessions"
        actions={[{ href: '/schedule', label: 'Open Schedule' }]}
        showBackHome
      />
    )
  }

  const today = cairoDateIso()
  const previewUntil = addDays(today, 13)
  const defaultSyncUntil = addDays(today, 89)

  const supabase = createSupabaseRSC()
  const { data, error } = await supabase
    .from('schedule_training_sessions')
    .select(
      'id,class_template_id,session_date,start_time,end_time,series_key_snapshot,name_snapshot,audience_snapshot,age_min_snapshot,age_max_snapshot,level_snapshot,activity_type_snapshot,uniform_snapshot,mat_snapshot,notes_snapshot,status,template_managed,generated_at,synced_at',
    )
    .gte('session_date', today)
    .lte('session_date', previewUntil)
    .order('session_date', { ascending: true })
    .order('start_time', { ascending: true })
    .order('name_snapshot', { ascending: true })

  return (
    <main>
      <PageHeader
        title="Scheduled Sessions"
        subtitle="Dated class occurrences generated from the structured recurring Class Templates."
      />
      <Section className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href="/schedule/templates"
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 font-medium hover:bg-[hsl(var(--muted)/0.08)]"
          >
            Class Templates
          </Link>
          <Link
            href="/schedule"
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 font-medium hover:bg-[hsl(var(--muted)/0.08)]"
          >
            Current member Schedule
          </Link>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Lot 2B materializes recurring Class Templates into real calendar-dated sessions. The current member-facing Schedule still uses the legacy timetable and is not changed by this lot.
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Synchronization only works from today forward. Future sessions that are still <strong>scheduled</strong> and <strong>template-managed</strong> may be refreshed or removed when the underlying recurring template changes. Past, completed, cancelled or future exception-locked sessions are never rewritten by this sync.
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load scheduled sessions: {error.message}
          </div>
        ) : (
          <TrainingSessionsManager
            canManage={canManageScheduleTrainingSessions(me.role)}
            sessions={(data ?? []) as ScheduleTrainingSession[]}
            today={today}
            previewUntil={previewUntil}
            defaultSyncUntil={defaultSyncUntil}
          />
        )}
      </Section>
    </main>
  )
}
