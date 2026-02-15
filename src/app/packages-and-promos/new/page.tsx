export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/PageHeader'
import Button from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createPromo } from '../actions'
import PromoForm from '../_components/PromoForm'

export default async function NewPromotionPage() {
  const supabase = createSupabaseServerActionClient()
  const { data: meData } = await supabase.auth.getUser()
  const user = meData.user
  if (!user) redirect('/login')

  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle<{ role: string | null }>()

  if ((prof?.role ?? 'member') !== 'super_admin') redirect('/packages-and-promos')

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="New Promotion" subtitle="Only Super Admin can create promotions" />
        <Link href="/packages-and-promos">
          <Button variant="outline">Back</Button>
        </Link>
      </div>

      <Card hover>
        <CardContent className="p-6">
          <PromoForm onSubmit={createPromo} />
        </CardContent>
      </Card>

      <div className="text-xs text-[hsl(var(--muted))]">After creation, you can edit the promotion from the list.</div>
    </div>
  )
}
