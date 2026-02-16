// src/app/store/admin/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'

export default async function LegacyStoreAdminPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (typeof v === 'string') qs.set(k, v)
    else if (Array.isArray(v) && typeof v[0] === 'string') qs.set(k, v[0])
  }
  const s = qs.toString()
  redirect(s ? `/admin/store?${s}` : '/admin/store')
}
