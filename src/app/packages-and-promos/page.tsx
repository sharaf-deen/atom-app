export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import PricesList, { type PackageItem } from '@/components/packages/PricesList'
import DeletePromoButton from '@/components/packages/DeletePromoButton'

type PromoRow = {
  id: string
  title: string
  description: string | null
  discount_type: 'percent' | 'amount' | null
  discount_value: number | null
  applies_to: Array<'membership' | 'dropin' | 'private'> | null
  min_months: number | null
  start_date: string | null
  end_date: string | null
  created_at: string
}

export default async function PackagesAndPromosPage() {
  const supa = createSupabaseServerActionClient()
  const { data: auth } = await supa.auth.getUser()
  const user = auth.user

  let role: string | null = null
  if (user) {
    const { data: me } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    role = me?.role ?? null
  }

  const canEdit = role === 'super_admin'

  const admin = createSupabaseAdminClient()

  // Packages pricing
  let packages: PackageItem[] = []
  let packagesError: string | null = null
  try {
    const { data, error } = await admin
      .from('packages_pricing')
      .select('id,name,type,unit,qty,price_egp,is_active,benefits')
      .order('type', { ascending: true })
      .order('unit', { ascending: true })
      .order('qty', { ascending: true })

    if (error) packagesError = error.message
    packages = (data ?? []) as PackageItem[]
  } catch (e: any) {
    packagesError = e?.message ?? String(e)
    packages = []
  }

  // Promos
  let promos: PromoRow[] = []
  let promosError: string | null = null
  try {
    const { data, error } = await admin
      .from('promotions')
      .select('id,title,description,discount_type,discount_value,applies_to,min_months,start_date,end_date,created_at')
      .order('created_at', { ascending: false })

    if (error) promosError = error.message
    promos = (data ?? []) as PromoRow[]
  } catch (e: any) {
    promosError = e?.message ?? String(e)
    promos = []
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Packages &amp; Promos</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            {canEdit
              ? 'You can edit the price list and manage promos.'
              : 'View the current price list and promos.'}
          </p>
        </div>

        {canEdit ? (
          <Link href="/packages-and-promos/new">
            <Button className="rounded-full px-6 py-3">Add new promo</Button>
          </Link>
        ) : null}
      </div>

      {packagesError ? (
        <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Prices list is not available.</div>
          {canEdit ? <div className="mt-1">{packagesError}</div> : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        <Card hover>
          <CardHeader>
            <CardTitle>Prices List</CardTitle>
          </CardHeader>
          <CardContent>
            <PricesList items={packages} canEdit={canEdit} />
          </CardContent>
        </Card>

        <Card hover>
          <CardHeader>
            <CardTitle>Promos</CardTitle>
          </CardHeader>
          <CardContent>
            {promosError ? (
              <div className="mb-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-medium">Promos are not available.</div>
                {canEdit ? <div className="mt-1">{promosError}</div> : null}
              </div>
            ) : null}

            {promos.length === 0 ? (
              <div className="text-sm text-[hsl(var(--muted))]">No promos.</div>
            ) : (
              <div className="space-y-3">
                {promos.map((p) => {
                  const today = new Date().toISOString().slice(0, 10)
                  const hasStarted = !p.start_date || p.start_date <= today
                  const notEnded = !p.end_date || p.end_date >= today
                  const isActive = hasStarted && notEnded

                  const badgeText = isActive
                    ? 'Active'
                    : p.start_date && p.start_date > today
                      ? 'Scheduled'
                      : 'Expired'

                  const discount =
                    typeof p.discount_value === 'number' && p.discount_value > 0
                      ? p.discount_type === 'amount'
                        ? `${p.discount_value} EGP`
                        : `${p.discount_value}%`
                      : null

                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-base font-semibold">{p.title}</div>
                            <Badge className={isActive ? 'bg-black text-white border-black' : ''}>{badgeText}</Badge>
                            {discount ? <Badge>{discount}</Badge> : null}
                            {(p.applies_to ?? []).slice(0, 3).map((k) => (
                              <Badge key={k}>{k}</Badge>
                            ))}
                            {typeof p.min_months === 'number' && p.min_months > 0 ? (
                              <Badge>{`Min ${p.min_months} mo`}</Badge>
                            ) : null}
                          </div>

                          {p.description ? <div className="mt-1 whitespace-pre-wrap text-sm">{p.description}</div> : null}

                          <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                            {p.start_date ? `Starts: ${new Date(p.start_date).toLocaleDateString()}` : 'Starts: —'}
                            {' · '}
                            {p.end_date ? `Ends: ${new Date(p.end_date).toLocaleDateString()}` : 'Ends: —'}
                          </div>
                        </div>

                        {canEdit ? (
                          <div className="flex items-center gap-2">
                            <Link href={`/packages-and-promos/${p.id}/edit`}>
                              <Button variant="outline" size="sm" title="Edit promo">
                                Edit
                              </Button>
                            </Link>
                            <DeletePromoButton id={p.id} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
