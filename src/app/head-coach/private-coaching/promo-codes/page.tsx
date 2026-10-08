export const dynamic = 'force-dynamic'
export const revalidate = 0
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminSubnav from '@/components/private-coaching/PrivateCoachingAdminSubnav'
import PrivateCoachingPromoCodesClient from '@/components/private-coaching/PrivateCoachingPromoCodesClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
type PromoRow = { id: string; code: string; title: string | null; discount_percent: number; is_active: boolean; created_at: string; updated_at: string | null }
export default async function Page() {
  const me = await getSessionUserCached(); if (!me) redirect('/login?next=/head-coach/private-coaching/promo-codes')
  if (me.role !== 'head_coach' && me.role !== 'super_admin') return <AccessDeniedPage title="Private coaching promo codes" subtitle="Access restricted." signedInAs={me.email} message="Only Head Coach and Super Admin can manage private coaching." allowed="head_coach, super_admin" nextPath="/head-coach/private-coaching/promo-codes" actions={[{ href: '/', label: 'Go Home' }]} showBackHome />
  const admin = getSupabaseAdminClientCached(); const { data } = await admin.from('private_coaching_promo_codes').select('id, code, title, discount_percent, is_active, created_at, updated_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(150)
  const rows = ((data ?? []) as PromoRow[]).map((row) => ({ id: row.id, code: row.code, title: row.title, discountPercent: Number(row.discount_percent ?? 0), isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at }))
  return <main><PageHeader title="Private coaching promo codes" subtitle="Manage private coaching discounts in a dedicated workspace." /><Section className="space-y-5"><PrivateCoachingAdminSubnav /><Card><CardHeader><CardTitle>Promo codes</CardTitle></CardHeader><CardContent><PrivateCoachingPromoCodesClient rows={rows} /></CardContent></Card></Section></main>
}
