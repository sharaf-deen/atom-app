import Link from 'next/link'
import type { Role } from '@/lib/rbac'
import {
  canAccessStoreCatalog,
  canAccessStoreDashboard,
  canAccessStoreExpenses,
  canAccessStoreFunding,
  canManageStoreCatalog,
  canManageStorePreorders,
  canManageStoreSales,
  canManageStoreSupplierOrders,
} from '@/lib/rbac'

function getItems(role: Role | null | undefined) {
  const items: Array<{ href: string; label: string }> = []

  if (canAccessStoreDashboard(role)) {
    items.push({ href: '/admin/store/dashboard', label: 'Dashboard' })
  }
  if (canAccessStoreCatalog(role)) {
    items.push({ href: '/admin/store', label: 'Catalog & stock' })
  }
  if (canManageStoreCatalog(role)) {
    items.push({ href: '/admin/store/models', label: 'Models' })
  }
  if (canManageStoreSupplierOrders(role)) {
    items.push({ href: '/admin/store?tab=supplier-orders', label: 'Supplier orders' })
  }
  if (canManageStorePreorders(role)) {
    items.push({ href: '/admin/store/preorders', label: 'Preorders' })
  }
  if (canManageStoreSales(role)) {
    items.push({ href: '/admin/store/sales', label: 'Sales' })
  }
  if (canAccessStoreExpenses(role)) {
    items.push({ href: '/admin/store/expenses', label: 'Expenses' })
  }
  if (canAccessStoreFunding(role)) {
    items.push({ href: '/admin/store/funding', label: 'Funding' })
  }

  return items
}

export default function StoreAdminNav({ current, role }: { current: string; role: Role | null | undefined }) {
  const items = getItems(role)

  if (items.length === 0) return null

  return (
    <nav aria-label="Store admin navigation" className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.href === current
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
              active ? 'border-black bg-black text-white' : 'hover:bg-gray-50'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
