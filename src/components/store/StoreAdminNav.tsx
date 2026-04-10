import Link from 'next/link'

import type { Role } from '@/lib/rbac'
import {
  canAccessStoreCatalog,
  canAccessStoreDashboard,
  canManageStorePreorders,
  canManageStoreSales,
  canManageStoreSupplierOrders,
} from '@/lib/rbac'

const ITEMS = [
  { href: '/admin/store/dashboard', label: 'Dashboard', show: canAccessStoreDashboard },
  { href: '/admin/store', label: 'Catalog & stock', show: canAccessStoreCatalog },
  { href: '/admin/store?tab=supplier-orders', label: 'Supplier orders', show: canManageStoreSupplierOrders },
  { href: '/admin/store/preorders', label: 'Preorders', show: canManageStorePreorders },
  { href: '/admin/store/sales', label: 'Sales', show: canManageStoreSales },
] as const

export default function StoreAdminNav({ current, role }: { current: string; role: Role | null | undefined }) {
  const items = ITEMS.filter((item) => item.show(role))

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
