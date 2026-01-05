// src/app/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { getSessionUser, type Role } from '@/lib/session'
import MembersSearch from '@/components/MembersSearch'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']

export default async function MembersPage() {
  const me = await getSessionUser()
  const isStaff = !!me && STAFF.includes(me.role)

  if (!isStaff) {
    return (
      <main>
        <PageHeader title="Members" subtitle="Access restricted" />
        <Section>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="text-base font-semibold">Forbidden</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              You don’t have permission to view this page.
            </p>
          </div>
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader
        title="Members"
        subtitle="Search and manage your member base"
      />
      <Section>
        <MembersSearch isStaff />
      </Section>
    </main>
  )
}
