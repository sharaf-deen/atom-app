// src/app/admin/categories/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ExpenseCategoriesClient from '@/components/ExpenseCategoriesClient'
import AccessDeniedCard from '@/components/AccessDeniedCard'

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

export default async function AdminCategoriesPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/categories')

  if (!isAdmin(me.role)) {
    return (
      <main>
        <PageHeader title="Expense Categories" subtitle="Access restricted" />
        <Section className="max-w-2xl">
          <AccessDeniedCard
            signedInAs={me.email}
            nextPath="/admin/categories"
            title="Forbidden"
            message="You don’t have permission to manage expense categories."
            allowed="Admin, Super Admin"
            actions={[{ href: '/admin', label: 'Back to Admin' }]}
          />
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader title="Expense Categories — Admin" subtitle="Manage categories" />
      <Section className="max-w-5xl space-y-6">
        <ExpenseCategoriesClient />
      </Section>
    </main>
  )
}
