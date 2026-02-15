export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/PageHeader'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createPromo } from '../actions'

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
          <form action={createPromo} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium">Title</div>
                <Input name="title" required placeholder="Ramadan Promo" />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Discount %</div>
                <Input name="discount_percent" required placeholder="10" />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Applies to</div>
                <Input name="applies_to" required placeholder="Memberships" />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Start date (YYYY-MM-DD)</div>
                <Input name="starts_at" required placeholder="2026-03-01" />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">End date (optional)</div>
                <Input name="ends_at" placeholder="2026-03-31" />
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Description (optional)</div>
              <textarea
                name="description"
                className="min-h-[120px] w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3 text-sm"
                placeholder="Explain the promo…"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" className="px-4 py-2">
                Create promotion
              </Button>
              <Link href="/packages-and-promos">
                <Button type="button" variant="outline" className="px-4 py-2">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="text-xs text-[hsl(var(--muted))]">After creation, you can edit the promotion from the list.</div>
    </div>
  )
}
