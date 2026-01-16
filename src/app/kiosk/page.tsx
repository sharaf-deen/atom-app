// src/app/kiosk/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import CreateMemberForm from '@/components/CreateMemberForm'

export default async function KioskPage() {
  const me = await getSessionUser()
  if (!me) redirect(`/login?next=${encodeURIComponent('/kiosk')}`)

  const isStaff = ['reception', 'admin', 'super_admin'].includes(me.role)

  if (!isStaff) {
    return (
      <main>
        <PageHeader title="Kiosk" subtitle="Access restricted" />
        <Section className="max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Reception / Admin / Super Admin can access the Kiosk."
            nextPath="/kiosk"
            showBackHome
          />
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader title="Kiosk" subtitle="Create members quickly (reception)" />
      <Section className="max-w-2xl space-y-6">
        <CreateMemberForm />
      </Section>
    </main>
  )
}
