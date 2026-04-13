export const dynamic = 'force-dynamic'
export const revalidate = 0

import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getSessionUserCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import StoreAdminNav from '@/components/store/StoreAdminNav'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { canManageStoreCatalog } from '@/lib/rbac'

const StoreModelManager = dynamicImport(() => import('@/components/store/StoreModelManager'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading model manager…</div>,
})

export default async function AdminStoreModelsPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/models')

  if (!canManageStoreCatalog(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Models"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Model management is reserved to super admin."
        allowed="super_admin"
        nextPath="/admin/store/models"
        actions={[{ href: '/admin/store', label: 'Go to Store Admin' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Store Models" />
      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/models" role={me.role} />
      </Section>
      <Section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Store V3 model manager</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-[hsl(var(--muted))]">
              Create and manage parent catalog models above existing Store V2 products. Variants, stock, supplier orders, preorders, and sales stay on current Store V2 product rows for now.
            </div>
            <StoreModelManager />
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
