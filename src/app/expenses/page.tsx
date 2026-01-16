// src/app/expenses/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ExpensesPageClient from '@/components/ExpensesPageClient'
import AccessDeniedCard from '@/components/AccessDeniedCard'

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

export default async function ExpensesPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/expenses')

  if (!isAdmin(me.role)) {
    return (
      <main>
        <PageHeader title="Expenses" subtitle="Access restricted" />
        <Section className="max-w-2xl">
          <AccessDeniedCard
            signedInAs={me.email}
            nextPath="/expenses"
            title="Forbidden"
            message="You don’t have permission to access the expenses page."
            allowed="Admin, Super Admin"
          />
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader title="Atom Expenses" subtitle="Track and manage expenses" />
      <Section className="max-w-3xl mx-auto space-y-6">
        <ExpensesPageClient userRole={me.role} />
      </Section>
    </main>
  )
}
