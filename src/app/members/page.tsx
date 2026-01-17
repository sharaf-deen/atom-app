// src/app/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import MembersSearch from '@/components/MembersSearch'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUser, type Role } from '@/lib/session'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']

export default async function MembersPage() {
  const me = await getSessionUser()

  if (!me) redirect('/login?next=/members')

  const allowed = STAFF.includes(me.role)

  if (!allowed) {
    return (
      <AccessDeniedPage
        title="Members"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access the members list."
        allowed="reception, admin, super_admin"
        nextPath="/members"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Members" subtitle="Search and manage your member base" />
      <Section>
        <MembersSearch isStaff />
      </Section>
    </main>
  )
}
