export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import MemberIncidentsManager from '@/components/coach-operations/MemberIncidentsManager'
import {
  canAccessCoachMemberIncidents,
  canCreateCoachMemberIncidents,
  canManageCoachMemberIncidents,
} from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type Incident = {
  id: string
  member_id: string
  member_name_snapshot: string
  member_code_snapshot: string | null
  training_log_id: string | null
  training_group_snapshot: string | null
  training_date_snapshot: string | null
  category: 'behaviour' | 'safety' | 'injury' | 'repeated_lateness' | 'disrespect' | 'other'
  severity: 'low' | 'medium' | 'high'
  description: string
  status: 'open' | 'resolved'
  reporter_name_snapshot: string
  reporter_role_snapshot: string
  reported_at: string
  resolved_at: string | null
  resolution_note: string | null
  reopened_at: string | null
}

type TrainingLog = {
  id: string
  target_group_snapshot: string
  training_date: string
  session_time: string
  coach_name_snapshot: string
}

export default async function CoachMemberIncidentsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/coach-operations/incidents')

  if (!canAccessCoachMemberIncidents(me.role)) {
    return (
      <AccessDeniedPage
        title="Member Incidents"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Assistant Coach, Coach, Head Coach and Super Admin can access coaching incidents."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/coach-operations/incidents"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const supabase = createSupabaseRSC()

  const [incidentsResult, logsResult] = await Promise.all([
    supabase
      .from('coach_member_incidents')
      .select('id,member_id,member_name_snapshot,member_code_snapshot,training_log_id,training_group_snapshot,training_date_snapshot,category,severity,description,status,reporter_name_snapshot,reporter_role_snapshot,reported_at,resolved_at,resolution_note,reopened_at')
      .order('reported_at', { ascending: false })
      .limit(500),
    supabase
      .from('coach_training_session_logs')
      .select('id,target_group_snapshot,training_date,session_time,coach_name_snapshot')
      .eq('status', 'completed')
      .order('training_date', { ascending: false })
      .order('session_time', { ascending: false })
      .limit(200),
  ])

  const loadError = incidentsResult.error?.message || logsResult.error?.message || null

  return (
    <main>
      <PageHeader
        title="Member Incidents"
        subtitle="Internal coaching records for behaviour, safety and training incidents."
      />
      <Section className="max-w-6xl space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Internal coaching record. Members and family guardians cannot see these incidents. Do not use this page for emergency response or medical diagnosis.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load incidents: {loadError}
          </div>
        ) : (
          <MemberIncidentsManager
            canCreate={canCreateCoachMemberIncidents(me.role)}
            canManage={canManageCoachMemberIncidents(me.role)}
            incidents={(incidentsResult.data ?? []) as Incident[]}
            trainingLogs={(logsResult.data ?? []) as TrainingLog[]}
          />
        )}
      </Section>
    </main>
  )
}
