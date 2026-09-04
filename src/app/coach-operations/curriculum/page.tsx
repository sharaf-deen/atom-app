export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import CurriculumManager from '@/components/coach-operations/CurriculumManager'
import { canAccessCoachCurriculum, canManageCoachCurriculum } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type CurriculumType = {
  id: string
  name: string
  slug: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CurriculumBlock = {
  id: string
  type_id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CurriculumTechnique = {
  id: string
  block_id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string
  coaching_response: string | null
  sort_order: number
  is_active: boolean
}

export default async function CoachCurriculumPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/coach-operations/curriculum')

  if (!canAccessCoachCurriculum(me.role)) {
    return (
      <AccessDeniedPage
        title="Training Curriculum"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Assistant Coach, Coach, Head Coach and Super Admin can access the training curriculum."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/coach-operations/curriculum"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const supabase = createSupabaseRSC()
  const [typesResult, blocksResult, techniquesResult, situationsResult] = await Promise.all([
    supabase
      .from('coach_curriculum_types')
      .select('id,name,slug,description,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('coach_curriculum_blocks')
      .select('id,type_id,name,description,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('coach_curriculum_techniques')
      .select('id,block_id,name,description,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('coach_curriculum_situations')
      .select('id,technique_id,name,opponent_reaction,coaching_response,sort_order,is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  const loadError =
    typesResult.error?.message ||
    blocksResult.error?.message ||
    techniquesResult.error?.message ||
    situationsResult.error?.message ||
    null

  return (
    <main>
      <PageHeader
        title="Training Curriculum"
        subtitle="Shared technical library for the ATOM coaching team."
      />

      <Section className="max-w-6xl space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Structure: Technical type → Block → Technique → Situation / opponent reaction. Coaches and Assistant Coaches can read the shared curriculum. Head Coach and Super Admin can manage it.
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load the training curriculum: {loadError}
          </div>
        ) : (
          <CurriculumManager
            canManage={canManageCoachCurriculum(me.role)}
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
