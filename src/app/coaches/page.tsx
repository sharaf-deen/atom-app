// src/app/coaches/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import CoachesManager from '@/components/CoachesManager'

export default async function CoachesPage() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) redirect('/login?next=/coaches')

  const allowed = sessionUser.role === 'admin' || sessionUser.role === 'super_admin'
  if (!allowed) {
    return (
      <AccessDeniedPage
        title="Coaches"
        subtitle="Access restricted."
        signedInAs={sessionUser.email}
        message="Only Admin / Super Admin can access the coaches page."
        allowed="admin, super_admin"
        nextPath="/coaches"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Coaches" subtitle="Manage coaches" />
      <Section className="max-w-5xl">
        <CoachesManager viewerRole={sessionUser.role} />
      </Section>
    </main>
  )
}
