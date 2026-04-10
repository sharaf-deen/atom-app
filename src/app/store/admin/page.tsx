export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUserCached } from '@/lib/requestCache'
import { canAccessStoreCatalogAdmin, canAccessStoreDashboard } from '@/lib/rbac'

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

  const me = await getSessionUserCached()
  if (!me) {
    redirect(s ? `/login?next=${encodeURIComponent(`/store/admin?${s}`)}` : '/login?next=/store/admin')
  }

  if (canAccessStoreDashboard(me.role)) {
    redirect(s ? `/admin/store/dashboard?${s}` : '/admin/store/dashboard')
  }

  if (canAccessStoreCatalogAdmin(me.role)) {
    redirect('/admin/store')
  }

  redirect('/store')
}
