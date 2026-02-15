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
  body: string | null
  code: string | null
  percent_off: number | null
  amount_off_egp: number | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
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
      .select('id,name,type,unit,qty,price_egp,is_active')
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
      .from('promos')
      .select('id,title,body,code,percent_off,amount_off_egp,starts_at,ends_at,is_active,created_at')
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
                  const badgeText = p.is_active ? 'Active' : 'Inactive'
                  const discount =
                    typeof p.percent_off === 'number' && p.percent_off > 0
                      ? `${p.percent_off}%`
                      : typeof p.amount_off_egp === 'number' && p.amount_off_egp > 0
                        ? `${p.amount_off_egp} EGP`
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
                            <Badge className={p.is_active ? 'bg-black text-white border-black' : ''}>{badgeText}</Badge>
                            {p.code ? <Badge>{p.code}</Badge> : null}
                            {discount ? <Badge>{discount}</Badge> : null}
                          </div>

                          {p.body ? <div className="mt-1 whitespace-pre-wrap text-sm">{p.body}</div> : null}

                          <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                            {p.starts_at ? `Starts: ${new Date(p.starts_at).toLocaleDateString()}` : 'Starts: —'}
                            {' · '}
                            {p.ends_at ? `Ends: ${new Date(p.ends_at).toLocaleDateString()}` : 'Ends: —'}
                          </div>
                        </div>

                        {canEdit ? (
                          <div className="flex items-center gap-2">
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
