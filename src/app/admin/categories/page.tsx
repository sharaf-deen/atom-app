// src/app/admin/categories/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import ExpenseCategoriesClient from '@/components/ExpenseCategoriesClient'

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

export default async function AdminCategoriesPage() {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.role)) {
    redirect('/') // 🔒 admins only
  }

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Expense Categories — Admin</h1>
      <ExpenseCategoriesClient />
    </main>
  )
}
