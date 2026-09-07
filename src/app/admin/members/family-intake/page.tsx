export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import FamilyIntakeManager from '@/components/members/FamilyIntakeManager'
import { canAccessFamilyIntake } from '@/lib/rbac'
import { getSessionUserCached } from '@/lib/requestCache'

export default async function FamilyIntakePage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/members/family-intake')

  if (!canAccessFamilyIntake(me.role)) {
    return (
      <AccessDeniedPage
        title="Family Intake"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can start family onboarding."
        allowed="reception, admin, super_admin"
        nextPath="/admin/members/family-intake"
        actions={[{ href: '/reception', label: 'Go to Front desk' }]}
        showBackHome
      />
    )
  }

  return <FamilyIntakeManager actorRole={me.role} />
}
