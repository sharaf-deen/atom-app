// src/app/store/admin/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import AccessDeniedPage from '@/components/AccessDeniedPage'

import StoreProductForm from '@/components/StoreProductForm'
import StoreCatalog from '@/components/StoreCatalog'
import StoreOrdersList from '@/components/StoreOrdersList'

export default async function StoreAdminPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/store/admin')

  if (me.role !== 'super_admin') {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Super Admin can access the store admin page."
        allowed="super_admin"
        nextPath="/store/admin"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Store Admin" subtitle="Manage products and view all orders" />

      <Section className="space-y-6">
        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">Catalog management</h2>
            <StoreProductForm />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">Products</h2>
            <StoreCatalog showAdd={false} canManage />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">All orders</h2>
            <StoreOrdersList mode="admin" />
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
