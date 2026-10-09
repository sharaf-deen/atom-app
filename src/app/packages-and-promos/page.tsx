export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
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

function promoState(p: PromoRow, today: string) {
  const hasStarted = !p.start_date || p.start_date <= today
  const notEnded = !p.end_date || p.end_date >= today

  if (hasStarted && notEnded) return 'active' as const
  if (p.start_date && p.start_date > today) return 'scheduled' as const
  return 'expired' as const
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function audienceLabel(value: 'membership' | 'dropin' | 'private') {
  if (value === 'membership') return 'Membership'
  if (value === 'private') return 'Private coaching'
  return 'Drop-in'
}

function PromoCard({ promo, canEdit, today }: { promo: PromoRow; canEdit: boolean; today: string }) {
  const state = promoState(promo, today)
  const active = state === 'active'
  const discount =
    typeof promo.discount_value === 'number' && promo.discount_value > 0
      ? promo.discount_type === 'amount'
        ? `${promo.discount_value} EGP off`
        : `${promo.discount_value}% off`
      : null

  return (
    <article
      className={`rounded-2xl border p-4 shadow-soft ${
        active
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{promo.title}</h3>
            <Badge className={active ? 'border-emerald-700 bg-emerald-700 text-white' : ''}>
              {active ? 'Active now' : state === 'scheduled' ? 'Upcoming' : 'Expired'}
            </Badge>
            {discount ? <Badge>{discount}</Badge> : null}
          </div>

          {promo.description ? (
            <div className="mt-2 whitespace-pre-wrap text-sm">{promo.description}</div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {(promo.applies_to ?? []).map((value) => (
              <span
                key={value}
                className="rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted))]"
              >
                {audienceLabel(value)}
              </span>
            ))}
            {typeof promo.min_months === 'number' && promo.min_months > 0 ? (
              <span className="rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted))]">
                Minimum {promo.min_months} month{promo.min_months > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>

          <div className="mt-3 text-xs text-[hsl(var(--muted))]">
            {active ? (
              <>
                Valid {promo.start_date ? `from ${formatDate(promo.start_date)}` : 'now'}
                {promo.end_date ? ` until ${formatDate(promo.end_date)}` : ''}
              </>
            ) : state === 'scheduled' ? (
              <>Starts {formatDate(promo.start_date)}</>
            ) : (
              <>Ended {formatDate(promo.end_date)}</>
            )}
          </div>
        </div>

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/packages-and-promos/${promo.id}/edit`}>
              <Button variant="outline" size="sm">Edit</Button>
            </Link>
            <DeletePromoButton id={promo.id} title={promo.title} />
          </div>
        ) : null}
      </div>
    </article>
  )
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

  let packages: PackageItem[] = []
  let packagesError: string | null = null
  try {
    let query = admin
      .from('packages_pricing')
      .select('id,name,type,unit,qty,price_egp,is_active,benefits')
      .order('type', { ascending: true })
      .order('unit', { ascending: true })
      .order('qty', { ascending: true })

    if (!canEdit) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) packagesError = error.message
    packages = (data ?? []) as PackageItem[]
  } catch (e: any) {
    packagesError = e?.message ?? String(e)
  }

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
  }

  const today = new Date().toISOString().slice(0, 10)
  const activePromos = promos.filter((promo) => promoState(promo, today) === 'active')
  const otherPromos = promos.filter((promo) => promoState(promo, today) !== 'active')

  return (
    <main>
      <PageHeader
        title="Packages & Promos"
        subtitle={canEdit ? 'Review pricing and manage current offers.' : 'Current membership prices and active ATOM offers.'}
        right={
          canEdit ? (
            <Link href="/packages-and-promos/new">
              <Button>Add new promo</Button>
            </Link>
          ) : undefined
        }
      />

      <Section className="max-w-5xl space-y-6">
        {packagesError ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="font-medium">Prices are not available right now.</div>
            {canEdit ? <div className="mt-1">{packagesError}</div> : null}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Membership prices</CardTitle>
          </CardHeader>
          <CardContent>
            <PricesList items={packages} canEdit={canEdit} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current offers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {promosError ? (
              <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-medium">Promos are not available right now.</div>
                {canEdit ? <div className="mt-1">{promosError}</div> : null}
              </div>
            ) : activePromos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
                No active promotion right now.
              </div>
            ) : (
              activePromos.map((promo) => (
                <PromoCard key={promo.id} promo={promo} canEdit={canEdit} today={today} />
              ))
            )}
          </CardContent>
        </Card>

        {otherPromos.length > 0 ? (
          <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{canEdit ? 'Other promotions' : 'Past & upcoming offers'}</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {otherPromos.length} offer{otherPromos.length > 1 ? 's' : ''} outside the current active period.
                  </div>
                </div>
                <span className="text-sm font-medium text-[hsl(var(--muted))]">Show</span>
              </div>
            </summary>

            <div className="mt-4 space-y-3">
              {otherPromos.map((promo) => (
                <PromoCard key={promo.id} promo={promo} canEdit={canEdit} today={today} />
              ))}
            </div>
          </details>
        ) : null}
      </Section>
    </main>
  )
}
