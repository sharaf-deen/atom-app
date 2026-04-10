import Link from 'next/link'
import {
  type Role,
  canAccessStoreCatalogAdmin,
  canAccessStoreDashboard,
  canManageStorePreorders,
  canManageStoreSales,
  canManageStoreSupplierOrders,
} from '@/lib/rbac'

const ITEMS = [
  {
    href: '/admin/store/dashboard',
    label: 'Dashboard',
    show: (role: Role) => canAccessStoreDashboard(role),
  },
  {
    href: '/admin/store',
    label: 'Catalog & stock',
    show: (role: Role) => canAccessStoreCatalogAdmin(role),
  },
  {
    href: '/admin/store?tab=supplier-orders',
    label: 'Supplier orders',
    show: (role: Role) => canManageStoreSupplierOrders(role),
  },
  {
    href: '/admin/store/preorders',
    label: 'Preorders',
    show: (role: Role) => canManageStorePreorders(role),
  },
  {
    href: '/admin/store/sales',
    label: 'Sales',
    show: (role: Role) => canManageStoreSales(role),
  },
] as const

export default function StoreAdminNav({ current, role }: { current: string; role: Role }) {
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
