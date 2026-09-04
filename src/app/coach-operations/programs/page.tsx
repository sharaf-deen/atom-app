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
  status: 'draft' | 'published' | 'archived'
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

  const supabase = createSupabaseRSC()
  const [programsResult, itemsResult, typesResult, blocksResult, techniquesResult, situationsResult] = await Promise.all([
    supabase
      .from('coach_training_programs')
      .select('id,title,target_group,start_date,end_date,notes,status,published_at,updated_at')
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('coach_training_program_items')
      .select('id,program_id,selected_level,type_id,block_id,technique_id,situation_id,sort_order')
      .order('sort_order', { ascending: true }),
    supabase.from('coach_curriculum_types').select('id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('coach_curriculum_blocks').select('id,type_id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('coach_curriculum_techniques').select('id,block_id,name,sort_order,is_active').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase
      .from('coach_curriculum_situations')
      .select('id,technique_id,name,opponent_reaction,coaching_response,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  const loadError =
    programsResult.error?.message ||
    itemsResult.error?.message ||
    typesResult.error?.message ||
    blocksResult.error?.message ||
    techniquesResult.error?.message ||
    situationsResult.error?.message ||
    null

  return (
    <main>
      <PageHeader title="Training Programs" subtitle="Shared weekly or period-based program for the ATOM coaching team." />
      <Section className="max-w-6xl space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Head Coach and Super Admin prepare the program from the Training Curriculum. Coach and Assistant Coach can read published programs. This lot does not change the academy Schedule.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load training programs: {loadError}
          </div>
        ) : (
          <TrainingProgramsManager
            canManage={canManageCoachTrainingPrograms(me.role)}
            programs={(programsResult.data ?? []) as Program[]}
            items={(itemsResult.data ?? []) as ProgramItem[]}
            types={(typesResult.data ?? []) as CurriculumType[]}
            blocks={(blocksResult.data ?? []) as CurriculumBlock[]}
            techniques={(techniquesResult.data ?? []) as CurriculumTechnique[]}
            situations={(situationsResult.data ?? []) as CurriculumSituation[]}
          />
        )}
      </Section>
    </main>
  )
}
