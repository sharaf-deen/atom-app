export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import CibPreviewUploader from '@/components/admin/banking/CibPreviewUploader'
import { getSessionUserCached } from '@/lib/requestCache'

export default async function CibMerchantPreviewPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/banking/cib-preview')
  if (me.role !== 'super_admin') return <main className="p-6">
    <AccessDeniedCard title="Forbidden" message="Only Super Admin can preview CIB merchant reports." nextPath="/admin/banking/cib-preview" showBackHome signedInAs={me.email} />
  </main>

  return <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
    <div>
      <a href="/admin/banking" className="text-sm text-slate-600 underline">Banking</a>
      <h1 className="mt-2 text-2xl font-bold">CIB merchant reports — reconciliation preview</h1>
      <p className="mt-2 text-sm text-slate-600">Compare CIB merchant settlement statements against individual terminal transactions. Super Admin only. No production data changes.</p>
    </div>
    <CibPreviewUploader />
  </main>
}
