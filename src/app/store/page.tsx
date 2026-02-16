// src/app/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import StoreCatalog from '@/components/StoreCatalog'

const StoreCart = dynamicImport(() => import('@/components/StoreCart'), {
  loading: () => <div className="text-sm text-gray-500">Loading cart…</div>,
})

const BUYER_ROLES = new Set(['member', 'assistant_coach', 'coach'])

export default async function StorePage() {
  const me = await getSessionUser()
  if (!me) {
    return (
      <main>
        <PageHeader title="Store" subtitle="Please sign in to access the shop" />
        <Section>
          <Card>
            <CardContent>
              <p className="text-[hsl(var(--muted))] text-sm">Authentication required.</p>
            </CardContent>
          </Card>
        </Section>
      </main>
    )
  }

  const role = me.role
  const isSuperAdmin = role === 'super_admin'
  const isBuyer = BUYER_ROLES.has(role)

  // /store is the "client shop" view.
  // Admin management lives in /admin/store.
  const showCart = isBuyer
  const showOrdersLink = isBuyer

  return (
    <main>
      <PageHeader title="Store" subtitle={isBuyer ? 'Browse products and manage your cart' : 'Browse the catalog'} />

      <Section className="space-y-6">
        {/* Super admin: shortcut to the admin store */}
        {isSuperAdmin && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="text-base font-semibold">Store Admin</h2>
                <p className="text-sm text-gray-600">Manage catalog and view all orders.</p>
              </div>
              <Link
                prefetch={false}
                href="/admin/store"
                className="ml-auto inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open admin store
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Catalog (Add to cart only for buyer roles) */}
        <Card>
          <CardContent>
            <StoreCatalog showAdd={showCart} canManage={false} />
          </CardContent>
        </Card>

        {/* Cart (buyer roles only) */}
        {showCart && (
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold mb-3">Cart</h2>
              <StoreCart />
            </CardContent>
          </Card>
        )}

        {/* Link to dedicated orders page (buyer roles only) */}
        {showOrdersLink && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="text-base font-semibold">My orders</h2>
                <p className="text-sm text-gray-600">Open your orders history and statuses.</p>
              </div>
              <Link
                prefetch={false}
                href="/orders"
                className="ml-auto inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                View my orders
              </Link>
            </CardContent>
          </Card>
        )}
      </Section>
    </main>
  )
}
