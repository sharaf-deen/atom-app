import Link from 'next/link'

const ITEMS = [
  { href: '/admin/store/dashboard', label: 'Dashboard' },
  { href: '/admin/store', label: 'Catalog & stock' },
  { href: '/admin/store?tab=supplier-orders', label: 'Supplier orders' },
  { href: '/admin/store/preorders', label: 'Preorders' },
  { href: '/admin/store/sales', label: 'Sales' },
] as const

export default function StoreAdminNav({ current }: { current: string }) {
  return (
    <nav aria-label="Store admin navigation" className="flex flex-wrap gap-2">
      {ITEMS.map((item) => {
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
