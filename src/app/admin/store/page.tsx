// src/app/admin/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import StoreCatalog from '@/components/StoreCatalog'

const StoreProductForm = dynamicImport(() => import('@/components/StoreProductForm'), {
  loading: () => <div className="text-sm text-gray-500">Loading catalog management…</div>,
})

const StoreOrdersList = dynamicImport(() => import('@/components/StoreOrdersList'), {
  loading: () => <div className="text-sm text-gray-500">Loading orders…</div>,
})

export default async function AdminStorePage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/store')

  if (me.role !== 'super_admin') {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Store Admin" subtitle="Manage catalog and view all orders" />
      <Section className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-base font-semibold">Client Store</h2>
              <p className="text-sm text-gray-600">Open the client-facing shop view.</p>
            </div>
            <Link
              prefetch={false}
              href="/store"
              className="ml-auto inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open /store
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">Catalog management</h2>
            <StoreProductForm />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">Catalog</h2>
            <StoreCatalog showAdd={false} canManage={true} />
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
