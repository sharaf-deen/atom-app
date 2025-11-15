// src/app/expenses/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import ExpensesPageClient from '@/components/ExpensesPageClient'

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

export default async function ExpensesPage() {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.role)) {
    redirect('/') // ❌ non-admins n'accèdent pas à la page
  }

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-center">Atom Expenses</h1>
      <ExpensesPageClient userRole={user.role} />
    </main>
  )
}
