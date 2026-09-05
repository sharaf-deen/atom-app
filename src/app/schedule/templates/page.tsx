export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ClassTemplatesManager from '@/components/schedule/ClassTemplatesManager'
import { canAccessScheduleClassTemplates, canManageScheduleClassTemplates } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

export type ScheduleClassTemplate = {
  id: string
  series_key: string
  name: string
  audience: 'kids_teens' | 'adults' | 'all'
  age_min: number | null
  age_max: number | null
  level: string
  activity_type: 'jiu_jitsu' | 'competition' | 'open_drills' | 'open_mat' | 'physical_preparation' | 'wrestling' | 'other'
  uniform: 'gi' | 'nogi' | 'gi_nogi' | 'none'
  day_of_week: number
  start_time: string
  end_time: string | null
  mat: string | null
  notes: string | null
  is_active: boolean
  sort_order: number
  effective_from: string
  effective_until: string | null
  updated_at: string
}

export default async function ScheduleClassTemplatesPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/schedule/templates')

  if (!canAccessScheduleClassTemplates(me.role)) {
    return (
      <AccessDeniedPage
        title="Class Templates"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Head Coach and Super Admin can manage the structured recurring academy schedule."
        allowed="head_coach, super_admin"
        nextPath="/schedule/templates"
        actions={[{ href: '/schedule', label: 'Open Schedule' }]}
        showBackHome
      />
    )
  }

  const supabase = createSupabaseRSC()
  const { data, error } = await supabase
    .from('schedule_class_templates')
    .select(
      'id,series_key,name,audience,age_min,age_max,level,activity_type,uniform,day_of_week,start_time,end_time,mat,notes,is_active,sort_order,effective_from,effective_until,updated_at',
    )
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  return (
    <main>
      <PageHeader title="Class Templates" subtitle="Structured recurring timetable foundation for future dated training sessions." />
      <Section className="max-w-6xl space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Lot 2A creates the structured recurring timetable only. The current member-facing Schedule still reads the existing legacy text and is not changed by this lot. No dated sessions, coach assignment, QR-to-session link or punctuality logic is active yet.
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          The initial templates were seeded from the public ATOM website&apos;s <strong>Weekly Schedule by Day</strong> reviewed on 5 Sep 2026. Rows with a conflict against the public group summary include an internal verification note.
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load class templates: {error.message}
          </div>
        ) : (
          <ClassTemplatesManager
            canManage={canManageScheduleClassTemplates(me.role)}
            templates={(data ?? []) as ScheduleClassTemplate[]}
          />
        )}
      </Section>
    </main>
  )
}
