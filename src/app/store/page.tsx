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
import StoreCart from '@/components/StoreCart'

const StoreProductForm = dynamicImport(() => import('@/components/StoreProductForm'), {
  loading: () => <div className="text-sm text-gray-500">Loading catalog management…</div>,
})
const StoreOrdersList = dynamicImport(() => import('@/components/StoreOrdersList'), {
  loading: () => <div className="text-sm text-gray-500">Loading orders…</div>,
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

  // Règles :
  // - member/assistant_coach/coach : Cart + lien vers /orders
  // - reception : catalogue uniquement
  // - admin : catalogue uniquement (pas de gestion, pas de commandes)
  // - super_admin : gestion du catalogue + "All orders" (pas de Cart)

  const showCart = isBuyer
  const canManageCatalog = isSuperAdmin
  const showOrdersLink = isBuyer
  const showAllOrders = isSuperAdmin

  return (
    <main>
      <PageHeader
        title="Store"
        subtitle={
          canManageCatalog
            ? 'Manage catalog and view all orders'
            : isBuyer
            ? 'Browse products and manage your cart'
            : 'Browse the catalog'
        }
      />

      <Section className="space-y-6">
        {/* Super admin : ajout/édition produits */}
        {canManageCatalog && (
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold mb-3">Catalog management</h2>
              {/* ⚠️ Ne pas passer de callback ici (Server → Client) */}
              <StoreProductForm />
            </CardContent>
          </Card>
        )}

        {/* Catalogue (Add to cart visible seulement pour les rôles acheteurs) */}
        <Card>
          <CardContent>
            <StoreCatalog showAdd={showCart} canManage={canManageCatalog} />
          </CardContent>
        </Card>

        {/* Panier (uniquement member/assistant_coach/coach) */}
        {showCart && (
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold mb-3">Cart</h2>
              <StoreCart />
            </CardContent>
          </Card>
        )}

        {/* Lien vers la page dédiée aux commandes (évite de charger la liste dans /store) */}
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

        {/* Toutes les commandes (uniquement super_admin) */}
        {showAllOrders && (
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold mb-3">Orders List</h2>
              <StoreOrdersList mode="admin" />
            </CardContent>
          </Card>
        )}
      </Section>
    </main>
  )
}
