// src/app/orders/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import OrdersList from '@/components/OrdersList'
import AccessDeniedCard from '@/components/AccessDeniedCard'

const ALLOWED: Array<'member' | 'assistant_coach' | 'coach'> = ['member', 'assistant_coach', 'coach']

export default async function OrdersPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/orders')

  if (!ALLOWED.includes(me.role as any)) {
    return (
      <main>
        <PageHeader title="Orders" subtitle="Access restricted" />
        <Section className="max-w-2xl">
          <AccessDeniedCard
            signedInAs={me.email}
            nextPath="/orders"
            title="Forbidden"
            message="This page shows only personal orders (buyers only)."
            allowed="Member, Coach, Assistant Coach"
            actions={[{ href: '/store', label: 'Go to Store' }]}
          />
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader title="My orders" subtitle="You see only your own orders." />
      <Section className="space-y-4">
        <OrdersList />
      </Section>
    </main>
  )
}
