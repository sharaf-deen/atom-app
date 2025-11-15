// src/app/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import StoreCatalog from '@/components/StoreCatalog'
import StoreCart from '@/components/StoreCart'
import StoreOrdersList from '@/components/StoreOrdersList'
import StoreProductForm from '@/components/StoreProductForm'

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
  const isAdmin = role === 'admin'
  const isBuyer = BUYER_ROLES.has(role)

  // Règles :
  // - member/assistant_coach/coach : Cart + "My orders"
  // - reception : catalogue uniquement
  // - admin : catalogue uniquement (pas de gestion, pas de commandes)
  // - super_admin : gestion du catalogue + "All orders" (pas de Cart)

  const showCart = isBuyer
  const canManageCatalog = isSuperAdmin
  const showMyOrders = isBuyer
  const showAllOrders = isSuperAdmin

  return (
    <main>
      <PageHeader
        title="Store"
        subtitle={
          canManageCatalog
            ? 'Manage catalog and view all orders'
            : isBuyer
            ? 'Browse products, manage your cart and orders'
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

        {/* Mes commandes (uniquement member/assistant_coach/coach) */}
        {showMyOrders && (
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold mb-3">My orders</h2>
              <StoreOrdersList mode="mine" />
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
