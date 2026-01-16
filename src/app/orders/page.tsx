// src/app/orders/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import OrdersList from '@/components/OrdersList'
import AccessDeniedPage from '@/components/AccessDeniedPage'

const ALLOWED: Array<'member' | 'assistant_coach' | 'coach'> = ['member', 'assistant_coach', 'coach']

export default async function OrdersPage() {
  const me = await getSessionUser()

  if (!me) redirect('/login?next=/orders')

  if (!ALLOWED.includes(me.role as any)) {
    return (
      <AccessDeniedPage
        title="Orders"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for members only."
        allowed="member, assistant_coach, coach"
        nextPath="/orders"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">My orders</h1>
        <div className="text-xs text-gray-500">You see only your own orders.</div>
      </div>

      <OrdersList />
    </main>
  )
}
