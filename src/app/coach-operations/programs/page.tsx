export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import TrainingProgramsManager from '@/components/coach-operations/TrainingProgramsManager'
import { canAccessCoachTrainingPrograms, canManageCoachTrainingPrograms } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type Program = {
  id: string
  title: string
  target_group: string
  start_date: string
  end_date: string
  notes: string | null
  technical_level: 'beginner' | 'intermediate' | 'advanced'
  status: 'draft' | 'published' | 'archived'
  responsible_coach_user_id: string | null
  responsible_coach_name_snapshot: string | null
  responsible_coach_role_snapshot: string | null
  assistant_coach_1_user_id: string | null
  assistant_coach_1_name_snapshot: string | null
  assistant_coach_1_role_snapshot: string | null
  assistant_coach_2_user_id: string | null
  assistant_coach_2_name_snapshot: string | null
  assistant_coach_2_role_snapshot: string | null
  published_at: string | null
  updated_at: string
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
type CurriculumTechnique = { id: string; block_id: string; name: string; technical_level: 'beginner' | 'intermediate' | 'advanced'; sort_order: number; is_active: boolean }
type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string
  coaching_response: string | null
  sort_order: number
  is_active: boolean
}


type ScheduleClassTemplate = {
  id: string
  series_key: string
  name: string
  day_of_week: number
  start_time: string
  mat: string | null
  uniform: string
  is_active: boolean
  effective_from: string
  effective_until: string | null
}

type ProgramClassTemplate = {
  id: string
  program_id: string
  class_template_id: string
  class_name_snapshot: string
  series_key_snapshot: string
  day_of_week_snapshot: number
  start_time_snapshot: string
  mat_snapshot: string | null
  is_active: boolean
}

export default async function CoachTrainingProgramsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/coach-operations/programs')

  if (!canAccessCoachTrainingPrograms(me.role)) {
    return (
      <AccessDeniedPage
        title="Training Programs"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Assistant Coach, Coach, Head Coach and Super Admin can access shared training programs."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/coach-operations/programs"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const canManage = canManageCoachTrainingPrograms(me.role)
  const supabase = createSupabaseRSC()

  let programsQuery = supabase
    .from('coach_training_programs')
    .select('id,title,target_group,start_date,end_date,notes,technical_level,status,responsible_coach_user_id,responsible_coach_name_snapshot,responsible_coach_role_snapshot,assistant_coach_1_user_id,assistant_coach_1_name_snapshot,assistant_coach_1_role_snapshot,assistant_coach_2_user_id,assistant_coach_2_name_snapshot,assistant_coach_2_role_snapshot,published_at,updated_at')
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (!canManage) {
    programsQuery = programsQuery
      .eq('status', 'published')
      .or(`responsible_coach_user_id.eq.${me.id},assistant_coach_1_user_id.eq.${me.id},assistant_coach_2_user_id.eq.${me.id}`)
  }

  const [programsResult, itemsResult, typesResult, blocksResult, techniquesResult, situationsResult, classTemplatesResult, programClassTemplatesResult] = await Promise.all([
    programsQuery,
    supabase
      .from('coach_training_program_items')
      .select('id,program_id,selected_level,type_id,block_id,technique_id,situation_id,sort_order')
      .order('sort_order', { ascending: true }),
    supabase.from('coach_curriculum_types').select('id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('coach_curriculum_blocks').select('id,type_id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('coach_curriculum_techniques').select('id,block_id,name,technical_level,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase
      .from('coach_curriculum_situations')
      .select('id,technique_id,name,opponent_reaction,coaching_response,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('schedule_class_templates')
      .select('id,series_key,name,day_of_week,start_time,mat,uniform,is_active,effective_from,effective_until')
      .order('name', { ascending: true })
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true }),
    supabase
      .from('coach_training_program_class_templates')
      .select('id,program_id,class_template_id,class_name_snapshot,series_key_snapshot,day_of_week_snapshot,start_time_snapshot,mat_snapshot,is_active')
      .eq('is_active', true),
  ])

  const loadError =
    programsResult.error?.message ||
    itemsResult.error?.message ||
    typesResult.error?.message ||
    blocksResult.error?.message ||
    techniquesResult.error?.message ||
    situationsResult.error?.message ||
    classTemplatesResult.error?.message ||
    programClassTemplatesResult.error?.message ||
    null

  return (
    <main>
      <PageHeader
        title={canManage ? 'Training Programs' : 'My Programs'}
        subtitle={
          canManage
            ? 'Build the program, target recurring Schedule classes and assign the coaching team.'
            : 'Programs where you are assigned as Responsible Coach or Assistant Coach.'
        }
      />
      <Section className="max-w-6xl space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          {canManage
            ? 'Head Coach and Super Admin select recurring Schedule classes once. Published programs then flow automatically to existing and future dated sessions, with the Responsible Coach and default assistants inherited.'
            : 'This view shows only your published programs. Open My Assigned Sessions for the dated classes you are expected to coach.'}
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load training programs: {loadError}
          </div>
        ) : (
          <TrainingProgramsManager
            canManage={canManage}
            canDeletePermanent={me.role === 'super_admin'}
            viewerUserId={me.id}
            programs={(programsResult.data ?? []) as Program[]}
            items={(itemsResult.data ?? []) as ProgramItem[]}
            types={(typesResult.data ?? []) as CurriculumType[]}
            blocks={(blocksResult.data ?? []) as CurriculumBlock[]}
            techniques={(techniquesResult.data ?? []) as CurriculumTechnique[]}
            situations={(situationsResult.data ?? []) as CurriculumSituation[]}
            classTemplates={(classTemplatesResult.data ?? []) as ScheduleClassTemplate[]}
            programClassTemplates={(programClassTemplatesResult.data ?? []) as ProgramClassTemplate[]}
          />
        )}
      </Section>
    </main>
  )
}
