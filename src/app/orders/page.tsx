// src/app/orders/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getSessionUser } from '@/lib/session'
import OrdersList from '@/components/OrdersList'

const ALLOWED: Array<'member' | 'assistant_coach' | 'coach'> = [
  'member',
  'assistant_coach',
  'coach',
]

export default async function OrdersPage() {
  const me = await getSessionUser()
  if (!me) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Orders</h1>
        <p className="text-sm text-gray-600 mt-2">Please sign in.</p>
      </main>
    )
  }

  if (!ALLOWED.includes(me.role as any)) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Orders</h1>
        <p className="text-sm text-gray-600 mt-2">Forbidden.</p>
      </main>
    )
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">My orders</h1>
        <div className="text-xs text-gray-500">You see only your own orders.</div>
      </div>

      {/* Mes commandes dans le composant */}
      <OrdersList />
    </main>
  )
}
