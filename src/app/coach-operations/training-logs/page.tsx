export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import TrainingSessionLogsManager from '@/components/coach-operations/TrainingSessionLogsManager'
import { canAccessCoachTrainingLogs, canCreateCoachTrainingLogs, canManageCoachTrainingLogs } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type Program = {
  id: string
  title: string
  target_group: string
  start_date: string
  end_date: string
  notes: string | null
  status: 'published'
}

type ProgramItem = {
  id: string
  program_id: string
  selected_level: 'block' | 'technique' | 'situation'
  type_id: string
  block_id: string
  technique_id: string | null
  situation_id: string | null
  sort_order: number
}

type CurriculumType = { id: string; name: string; sort_order: number; is_active: boolean }
type CurriculumBlock = { id: string; type_id: string; name: string; sort_order: number; is_active: boolean }
type CurriculumTechnique = { id: string; block_id: string; name: string; sort_order: number; is_active: boolean }
type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string
  coaching_response: string | null
  sort_order: number
  is_active: boolean
}

type SessionLog = {
  id: string
  program_id: string
  program_title_snapshot: string
  target_group_snapshot: string
  training_date: string
  session_time: string
  coach_user_id: string | null
  coach_name_snapshot: string
  coach_role_snapshot: string
  notes: string | null
  status: 'draft' | 'completed'
  completed_at: string | null
  reopened_at: string | null
  created_at: string
  updated_at: string
}

type SessionLogItem = {
  id: string
  session_log_id: string
  selected_level: 'block' | 'technique' | 'situation'
  type_id: string
  block_id: string
  technique_id: string | null
  situation_id: string | null
  type_name_snapshot: string
  block_name_snapshot: string
  technique_name_snapshot: string | null
  situation_name_snapshot: string | null
  opponent_reaction_snapshot: string | null
  coaching_response_snapshot: string | null
  sort_order: number
}

export default async function CoachTrainingLogsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/coach-operations/training-logs')

  if (!canAccessCoachTrainingLogs(me.role)) {
    return (
      <AccessDeniedPage
        title="Training Logs"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Assistant Coach, Coach, Head Coach and Super Admin can access coaching training logs."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/coach-operations/training-logs"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const supabase = createSupabaseRSC()
  const programsResult = await supabase
    .from('coach_training_programs')
    .select('id,title,target_group,start_date,end_date,notes,status')
    .eq('status', 'published')
    .order('start_date', { ascending: false })

  const programIds = (programsResult.data ?? []).map((row: any) => String(row.id))
  const [programItemsResult, typesResult, blocksResult, techniquesResult, situationsResult, logsResult] = await Promise.all([
    programIds.length
      ? supabase
          .from('coach_training_program_items')
          .select('id,program_id,selected_level,type_id,block_id,technique_id,situation_id,sort_order')
          .in('program_id', programIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null } as any),
    supabase.from('coach_curriculum_types').select('id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('coach_curriculum_blocks').select('id,type_id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('coach_curriculum_techniques').select('id,block_id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase
      .from('coach_curriculum_situations')
      .select('id,technique_id,name,opponent_reaction,coaching_response,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('coach_training_session_logs')
      .select('id,program_id,program_title_snapshot,target_group_snapshot,training_date,session_time,coach_user_id,coach_name_snapshot,coach_role_snapshot,notes,status,completed_at,reopened_at,created_at,updated_at')
      .order('training_date', { ascending: false })
      .order('session_time', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  const logIds = (logsResult.data ?? []).map((row: any) => String(row.id))
  const logItemsResult = logIds.length
    ? await supabase
        .from('coach_training_session_log_items')
        .select('id,session_log_id,selected_level,type_id,block_id,technique_id,situation_id,type_name_snapshot,block_name_snapshot,technique_name_snapshot,situation_name_snapshot,opponent_reaction_snapshot,coaching_response_snapshot,sort_order')
        .in('session_log_id', logIds)
        .order('sort_order', { ascending: true })
    : ({ data: [], error: null } as any)

  const loadError =
    programsResult.error?.message ||
    programItemsResult.error?.message ||
    typesResult.error?.message ||
    blocksResult.error?.message ||
    techniquesResult.error?.message ||
    situationsResult.error?.message ||
    logsResult.error?.message ||
    logItemsResult.error?.message ||
    null

  return (
    <main>
      <PageHeader title="Training Logs" subtitle="Record what was actually taught and review previous sessions across the coaching team." />
      <Section className="max-w-6xl space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Training Logs use published Training Programs. This records coaching work only; staff QR attendance and member attendance are not changed in this lot.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load training logs: {loadError}
          </div>
        ) : (
          <TrainingSessionLogsManager
            currentUserId={me.id}
            canCreate={canCreateCoachTrainingLogs(me.role)}
            canManage={canManageCoachTrainingLogs(me.role)}
            programs={(programsResult.data ?? []) as Program[]}
            programItems={(programItemsResult.data ?? []) as ProgramItem[]}
            types={(typesResult.data ?? []) as CurriculumType[]}
            blocks={(blocksResult.data ?? []) as CurriculumBlock[]}
            techniques={(techniquesResult.data ?? []) as CurriculumTechnique[]}
            situations={(situationsResult.data ?? []) as CurriculumSituation[]}
            logs={(logsResult.data ?? []) as SessionLog[]}
            logItems={(logItemsResult.data ?? []) as SessionLogItem[]}
          />
        )}
      </Section>
    </main>
  )
}
