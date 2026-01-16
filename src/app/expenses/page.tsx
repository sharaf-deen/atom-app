// src/app/expenses/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import ExpensesPageClient from '@/components/ExpensesPageClient'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedCard from '@/components/AccessDeniedCard'

function canAccess(role?: string | null) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

export default async function ExpensesPage() {
  const me = await getSessionUser()

  if (!me) redirect('/login?next=/expenses')

  if (!canAccess(me.role)) {
    return (
      <main>
        <PageHeader title="Expenses" subtitle="Forbidden." />
        <Section className="max-w-2xl">
          <AccessDeniedCard
            signedInAs={me.email}
            title="Forbidden"
            message="Only Reception / Admin / Super Admin can access expenses."
            allowed="reception, admin, super_admin"
            nextPath="/expenses"
            showBackHome
          />
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader title="Expenses" subtitle="Track & review expenses" />
      <Section className="max-w-3xl space-y-6">
        <ExpensesPageClient userRole={me.role} />
      </Section>
    </main>
  )
}
