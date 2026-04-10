export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'

import { canAccessStoreCatalog, canAccessStoreDashboard } from '@/lib/rbac'
import { getSessionUserCached } from '@/lib/requestCache'

export default async function LegacyStoreAdminPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/store/admin')

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (typeof v === 'string') qs.set(k, v)
    else if (Array.isArray(v) && typeof v[0] === 'string') qs.set(k, v[0])
  }
  const s = qs.toString()

  if (canAccessStoreDashboard(me.role)) {
    redirect(s ? `/admin/store/dashboard?${s}` : '/admin/store/dashboard')
  }
  if (canAccessStoreCatalog(me.role)) {
    redirect(s ? `/admin/store?${s}` : '/admin/store')
  }

  redirect('/store')
}
