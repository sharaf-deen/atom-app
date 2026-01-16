// src/app/expenses/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import ExpensesPageClient from '@/components/ExpensesPageClient'
import AccessDeniedPage from '@/components/AccessDeniedPage'

function canAccess(role?: string | null) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

export default async function ExpensesPage() {
  const user = await getSessionUser()

  if (!user) redirect('/login?next=/expenses')

  if (!canAccess(user.role)) {
    return (
      <AccessDeniedPage
        title="Expenses"
        subtitle="Access restricted."
        signedInAs={user.email}
        message="Only Reception / Admin / Super Admin can access expenses."
        allowed="reception, admin, super_admin"
        nextPath="/expenses"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-center">Atom Expenses</h1>
      <ExpensesPageClient userRole={user.role} />
    </main>
  )
}
