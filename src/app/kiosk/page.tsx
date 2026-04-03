// src/app/kiosk/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { canAccessKiosk } from '@/lib/rbac'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import CreateMemberForm from '@/components/CreateMemberForm'
import AccessDeniedPage from '@/components/AccessDeniedPage'

export default async function KioskPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUser()

  if (!me) redirect('/login?next=/kiosk')

  const isStaff = canAccessKiosk(me.role)

  if (!isStaff) {
    return (
      <AccessDeniedPage
        title="Kiosk"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access the kiosk."
        allowed="reception, admin, super_admin"
        nextPath="/kiosk"
        actions={[{ href: '/members', label: 'Go to Members' }]}
        showBackHome
      />
    )
  }

  const visitorTrialId = typeof searchParams?.visitor_trial_id === 'string' ? searchParams.visitor_trial_id.trim() : ''
  const initialValues = {
    first_name: typeof searchParams?.first_name === 'string' ? searchParams.first_name.trim() : '',
    last_name: typeof searchParams?.last_name === 'string' ? searchParams.last_name.trim() : '',
    email: typeof searchParams?.email === 'string' ? searchParams.email.trim() : '',
    phone: typeof searchParams?.phone === 'string' ? searchParams.phone.trim() : '',
    visitor_trial_id: visitorTrialId || undefined,
  }

  return (
    <main>
      <PageHeader title="Kiosk" subtitle="Create members fast" />
      <Section className="max-w-2xl space-y-6">
        <CreateMemberForm initialValues={initialValues} />
      </Section>
    </main>
  )
}
