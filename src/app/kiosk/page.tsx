// src/app/kiosk/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import CreateMemberForm from '@/components/CreateMemberForm'
import AccessDeniedPage from '@/components/AccessDeniedPage'

export default async function KioskPage() {
  const me = await getSessionUser()

  if (!me) redirect('/login?next=/kiosk')

  const isStaff = ['reception', 'admin', 'super_admin'].includes(me.role)

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

  return (
    <main>
      <PageHeader title="Kiosk" subtitle="Create members quickly at the front desk." />
      <Section className="max-w-2xl space-y-6">
        <CreateMemberForm />
      </Section>
    </main>
  )
}
