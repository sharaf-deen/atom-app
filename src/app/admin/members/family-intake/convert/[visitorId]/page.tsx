export const dynamic = 'force-dynamic'
export const revalidate = 0

import { notFound, redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Button from '@/components/ui/Button'
import VisitorFamilyConversion from '@/components/members/VisitorFamilyConversion'
import { canAccessFamilyIntake } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

export default async function VisitorFamilyConversionPage({
  params,
}: {
  params: { visitorId: string }
}) {
  const nextPath = `/admin/members/family-intake/convert/${params.visitorId}`
  const me = await getSessionUserCached()
  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  if (!canAccessFamilyIntake(me.role)) {
    return (
      <AccessDeniedPage
        title="Convert Visitor"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can convert Family Intake visitors."
        allowed="reception, admin, super_admin"
        nextPath={nextPath}
        actions={[{ href: '/admin/visitors', label: 'Back to Visitors' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()
  const { data: visitor, error: visitorError } = await admin
    .from('visitor_trials')
    .select('id,first_name,last_name,phone,email,date_of_birth,trial_date,trial_attended_at,free_trial_used,linked_member_id,family_intake_id')
    .eq('id', params.visitorId)
    .maybeSingle()

  if (visitorError) throw new Error(`VISITOR_LOAD_FAILED: ${visitorError.message}`)
  if (!visitor) notFound()

  let intake: any = null
  let family: any = null
  let linkedMember: any = null

  if (visitor.family_intake_id) {
    const { data, error } = await admin
      .from('family_intakes')
      .select('id,guardian_first_name,guardian_last_name,guardian_phone,guardian_email,guardian_relationship,guardian_auth_user_id,family_id,status')
      .eq('id', visitor.family_intake_id)
      .maybeSingle()
    if (error) throw new Error(`FAMILY_INTAKE_LOAD_FAILED: ${error.message}`)
    intake = data

    if (intake?.family_id) {
      const { data: familyRow, error: familyError } = await admin
        .from('families')
        .select('id,name')
        .eq('id', intake.family_id)
        .maybeSingle()
      if (familyError) throw new Error(`FAMILY_LOAD_FAILED: ${familyError.message}`)
      family = familyRow
    }
  }

  if (visitor.linked_member_id) {
    const { data, error } = await admin
      .from('profiles')
      .select('user_id,member_id,first_name,last_name')
      .eq('user_id', visitor.linked_member_id)
      .maybeSingle()
    if (error) throw new Error(`MEMBER_LOAD_FAILED: ${error.message}`)
    linkedMember = data
  }

  return (
    <main>
      <PageHeader
        title="Convert Visitor to Family Member"
        subtitle="Create the child Member without duplicate Auth, Family or Visitor records."
        right={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" href="/admin/members/family-operations">Family Operations</Button>
            <Button asChild variant="outline" href="/admin/visitors">Visitors</Button>
            <Button asChild variant="outline" href="/admin/members/family-intake">Family Intake</Button>
          </div>
        }
      />
      <Section>
        <div className="mx-auto max-w-3xl">
          <VisitorFamilyConversion
            visitor={visitor}
            intake={intake}
            family={family}
            linkedMember={linkedMember}
          />
        </div>
      </Section>
    </main>
  )
}
