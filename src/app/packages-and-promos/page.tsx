// src/app/packages-and-promos/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import React from 'react'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import DeletePromoButton from '@/components/promos/DeletePromoButton'

type Role =
  | 'member'
  | 'assistant_coach'
  | 'coach'
  | 'reception'
  | 'admin'
  | 'super_admin'

function fmtEGP(n: number | string | null | undefined) {
  const val = typeof n === 'string' ? Number(n) : n
  if (typeof val !== 'number' || !isFinite(val)) return '—'
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(val)
}

/** ---------- PRICING (statique) ---------- */
type MembershipItem = { label: string; price: number }
type DropInItem =
  | { label: string; price: number; note?: never }
  | { label: string; note: string; price?: never }
type PrivateItem = { label: string; price: number }

type Pricing = {
  memberships: MembershipItem[]
  dropIn: DropInItem[]
  privateTraining: PrivateItem[]
}

const PRICING: Pricing = {
  memberships: [
    { label: '1 month', price: 2800 },
    { label: '3 months', price: 6200 },
    { label: '6 months', price: 10000 },
    { label: '12 months', price: 18000 },
  ],
  dropIn: [
    { label: '1 session', price: 300 },
    { label: '2 sessions or more', note: '180 per session' },
  ],
  privateTraining: [
    { label: '1 session', price: 1500 },
    { label: '5 sessions', price: 6000 },
    { label: '10 sessions', price: 10000 },
  ],
}

/** ---------- Promotions DB type ---------- */
type Promo = {
  id: string
  title: string
  description: string | null
  discount_type: 'percent' | 'amount' | null
  discount_value: number | string | null
  applies_to: ('membership' | 'dropin' | 'private')[] | null
  min_months: number | null
  start_date: string | null // ISO YYYY-MM-DD
  end_date: string | null   // ISO YYYY-MM-DD
  created_at: string
  updated_at: string
}

/** Badges & helpers d’affichage */
function discountBadge(p: Promo) {
  const val = Number(p.discount_value)
  if (!p.discount_type || !isFinite(val)) return '—'
  return p.discount_type === 'percent' ? `${val}%` : `${fmtEGP(val)} off`
}

function appliesToText(p: Promo) {
  const arr = (p.applies_to ?? []) as string[]
  return arr.length ? arr.join(', ') : '—'
}

export default async function PackagesAndPromosPage() {
  // Visible à tout utilisateur connecté (quel que soit le rôle)
  const user = await getSessionUser()
  if (!user) {
    redirect('/')
  }
  const role = user.role as Role
  const canCreate = role === 'admin' || role === 'super_admin'   // New promo
  const canManageEditDelete = role === 'super_admin'             // Edit/Delete
  const canSeePast = role === 'admin' || role === 'super_admin'  // Past visibility

  // Lecture DB (RSC)
  const supabase = createSupabaseRSC()
  const { data: promos, error } = await supabase
    .from('promotions')
    .select('*')
    .order('start_date', { ascending: false })
    .returns<Promo[]>()

  const list: Promo[] = promos ?? []
  const today = new Date().toISOString().slice(0, 10)

  /** ---------- Segmentation temporelle (sans “upcoming”) ---------- */
  // Current: (start null ou ≤ today) ET (end null ou ≥ today)
  const current = list.filter(
    (p) =>
      (!p.start_date || p.start_date <= today) &&
      (!p.end_date || p.end_date >= today)
  )

  // Past: end_date < today (visible seulement admin/super_admin)
  const past = list.filter((p) => !!p.end_date && p.end_date < today)

  return (
    <main>
      <PageHeader
        title="Packages & Promos"
        right={
          canCreate ? (
            <Button asChild href="/packages-and-promos/new">New promo</Button>
          ) : null
        }
      />

      {error && (
        <Section>
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            Erreur Supabase : <code>{String(error.message || error.toString())}</code>
          </div>
        </Section>
      )}

      {/* Tarifs */}
      <Section className="space-y-6">
        <CardContent>
          <h2 className="text-xl font-semibold">Prices List</h2>
        </CardContent>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Memberships */}
          <Card hover>
            <CardContent>
              <h3 className="text-lg font-semibold mb-3">Adults &amp; Kids</h3>
              <ul className="space-y-2">
                {PRICING.memberships.map((m) => (
                  <li key={m.label} className="flex items-center justify-between">
                    <span>{m.label}</span>
                    <span className="font-semibold">{fmtEGP(m.price)} L.E</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Drop In */}
          <Card hover>
            <CardContent>
              <h3 className="text-lg font-semibold mb-3">Drop In</h3>
              <ul className="space-y-2">
                {PRICING.dropIn.map((d) => {
                  const hasPrice = 'price' in d
                  return (
                    <li key={d.label} className="flex items-center justify-between">
                      <span>{d.label}</span>
                      <span className="font-semibold">
                        {hasPrice
                          ? `${fmtEGP((d as { price: number }).price)} L.E`
                          : (d as { note: string }).note}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Private Training */}
          <Card hover>
            <CardContent>
              <h3 className="text-lg font-semibold mb-3">Private Training</h3>
              <ul className="space-y-2">
                {PRICING.privateTraining.map((p) => (
                  <li key={p.label} className="flex items-center justify-between">
                    <span>{p.label}</span>
                    <span className="font-semibold">{fmtEGP(p.price)} L.E</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Current */}
      <Section className="space-y-4">
        <h2 className="text-xl font-semibold">Current Promotions</h2>
        {current.length === 0 ? (
          <div className="text-sm text-[hsl(var(--muted))]">No current promotions.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {current.map((p) => (
              <Card key={p.id} hover>
                <CardContent>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">{p.title}</h3>
                    <Badge>{discountBadge(p)}</Badge>
                  </div>

                  {p.description && (
                    <p className="mt-2 text-sm text-[hsl(var(--muted))]">{p.description}</p>
                  )}

                  <dl className="mt-3 text-sm">
                    <div className="flex items-center gap-2">
                      <dt className="text-[hsl(var(--muted))]">Applies to:</dt>
                      <dd className="font-medium">{appliesToText(p)}</dd>
                    </div>
                    {typeof p.min_months === 'number' && p.min_months > 0 && (
                      <div className="flex items-center gap-2">
                        <dt className="text-[hsl(var(--muted))]">Min. months:</dt>
                        <dd className="font-medium">{p.min_months}</dd>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <dt className="text-[hsl(var(--muted))]">Dates:</dt>
                      <dd className="font-medium">
                        {(p.start_date ?? '—')} → {(p.end_date ?? '—')}
                      </dd>
                    </div>
                  </dl>

                  {canManageEditDelete && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" href={`/packages-and-promos/${p.id}/edit`}>
                        Edit
                      </Button>
                      <DeletePromoButton id={p.id} label="Delete" />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Past — visible seulement pour admin & super_admin */}
      {canSeePast && (
        <Section className="space-y-4">
          <h2 className="text-xl font-semibold">Past Promotions</h2>
          {past.length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">No past promotions.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {past.map((p) => (
                <Card key={p.id} hover>
                  <CardContent>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">{p.title}</h3>
                      <Badge>{discountBadge(p)}</Badge>
                    </div>

                    {p.description && (
                      <p className="mt-2 text-sm text-[hsl(var(--muted))]">{p.description}</p>
                    )}

                    <dl className="mt-3 text-sm">
                      <div className="flex items-center gap-2">
                        <dt className="text-[hsl(var(--muted))]">Applies to:</dt>
                        <dd className="font-medium">{appliesToText(p)}</dd>
                      </div>
                      {typeof p.min_months === 'number' && p.min_months > 0 && (
                        <div className="flex items-center gap-2">
                          <dt className="text-[hsl(var(--muted))]">Min. months:</dt>
                          <dd className="font-medium">{p.min_months}</dd>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <dt className="text-[hsl(var(--muted))]">Dates:</dt>
                        <dd className="font-medium">
                          {(p.start_date ?? '—')} → {(p.end_date ?? '—')}
                        </dd>
                      </div>
                    </dl>

                    {canManageEditDelete && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline" href={`/packages-and-promos/${p.id}/edit`}>
                          Edit
                        </Button>
                        <DeletePromoButton id={p.id} label="Delete" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Section>
      )}
    </main>
  )
}
