// src/app/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { getSessionUser, type Role } from '@/lib/session'
import MembersSearch from '@/components/MembersSearch'
import AccessDeniedCard from '@/components/AccessDeniedCard'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']

export default async function MembersPage() {
  const me = await getSessionUser()
  if (!me) redirect(`/login?next=${encodeURIComponent('/members')}`)

  const isStaff = STAFF.includes(me.role)

  if (!isStaff) {
    return (
      <main>
        <PageHeader title="Members" subtitle="Access restricted" />
        <Section>
          <AccessDeniedCard
            title="Forbidden"
            message="Only Reception / Admin / Super Admin can access the members list."
            nextPath="/members"
            showBackHome
          />
        </Section>
      </main>
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
