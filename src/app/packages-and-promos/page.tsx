import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/PageHeader'
import DeletePromoButton from '@/components/packages/DeletePromoButton'
import PricesList from '@/components/packages/PricesList'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default async function PackagesAndPromosPage() {
  const supa = createSupabaseServerActionClient()

  const { data: auth } = await supa.auth.getUser()
  const user = auth.user
  if (!user) redirect('/auth')

  // Who am I?
  const { data: me } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle<{ role: string | null }>()

  const role = me?.role || 'member'
  const isSuper = role === 'super_admin'

  // Read data with service-role to avoid RLS surprises
  const admin = createSupabaseAdminClient()

  const [{ data: pricing }, { data: promos }] = await Promise.all([
    admin
      .from('packages_pricing')
      .select('id, title, price_egp, sort_order, is_active')
      .order('sort_order', { ascending: true }),
    admin
      .from('promos')
      .select('id, title, body, code, discount_percent, start_at, end_at, created_at')
      .order('created_at', { ascending: false }),
  ])

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Packages & Promos"
        subtitle={
          isSuper
            ? 'You can edit the price list and manage promos.'
            : 'View current packages and promos. (Only Super Admin can edit.)'
        }
        right={
          isSuper ? (
            <Link href="/packages-and-promos/new">
              <Button>Add new promo</Button>
            </Link>
          ) : null
        }
      />

      {/* Packages */}
      <Card hover>
        <CardHeader className="items-start">
          <CardTitle>Prices List</CardTitle>
        </CardHeader>
        <CardContent>
          <PricesList items={(pricing as any[]) ?? []} canEdit={isSuper} />
        </CardContent>
      </Card>

      {/* Promos */}
      <Card hover>
        <CardHeader className="items-start">
          <CardTitle>Promos</CardTitle>
        </CardHeader>
        <CardContent>
          {(promos as any[])?.length ? (
            <div className="space-y-3">
              {(promos as any[]).map((p: any) => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold truncate">{p.title || '—'}</div>
                        {p.code ? <Badge>{p.code}</Badge> : null}
                        {typeof p.discount_percent === 'number' ? <Badge>{p.discount_percent}%</Badge> : null}
                      </div>
                      {p.body ? <div className="mt-1 whitespace-pre-wrap text-sm">{p.body}</div> : null}
                      <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                        Created: {fmtDate(p.created_at)}
                        {p.start_at ? ` · Start: ${fmtDate(p.start_at)}` : ''}
                        {p.end_at ? ` · End: ${fmtDate(p.end_at)}` : ''}
                      </div>
                    </div>

                    {isSuper ? (
                      <div className="flex items-center gap-2">
                        <Link href={`/packages-and-promos/${p.id}/edit`}>
                          <Button variant="outline" size="sm">
                            Edit
                          </Button>
                        </Link>
                        <DeletePromoButton id={p.id} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[hsl(var(--muted))]">No promos.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
