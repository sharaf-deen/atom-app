// src/components/NavLoginLink.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavLoginLink() {
  const pathname = usePathname()
  if (pathname === '/login') return null

  return (
    <Link href="/login" className="px-3 py-1.5 rounded border hover:bg-gray-50">
      Login
    </Link>
  )
}
