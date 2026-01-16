// src/app/packages-and-promos/new/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import React from 'react'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { createPromo } from '@/app/packages-and-promos/actions'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

export default async function NewPromoPage() {
  const user = await getSessionUser()
  const nextPath = '/packages-and-promos/new'

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  if ((user.role as Role) !== 'super_admin') {
    return (
      <AccessDeniedPage
        title="New Promotion"
        subtitle="Access restricted."
        signedInAs={user.email}
        message="Only Super Admin can create promotions."
        allowed="super_admin"
        nextPath={nextPath}
        actions={[{ href: '/packages-and-promos', label: 'Back to Packages & Promos' }]}
        showBackHome
        showProfile
      />
    )
  }

  return (
    <main>
      <PageHeader
        title="New Promotion"
        right={<Button asChild href="/packages-and-promos">Cancel</Button>}
      />

      <Section>
        <Card>
          <CardContent>
            <form action={createPromo} className="grid gap-4 max-w-2xl">
              <div className="grid gap-1.5">
                <label htmlFor="title" className="text-sm font-medium">
                  Title <span className="text-red-600">*</span>
                </label>
                <input id="title" name="title" required className="w-full rounded-lg border px-3 py-2" placeholder="e.g. Student" />
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="description" className="text-sm font-medium">Description</label>
                <textarea id="description" name="description" rows={3} className="w-full rounded-lg border px-3 py-2" placeholder="Optional details…" />
              </div>

              <div className="grid gap-1.5 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor="discount_type" className="text-sm font-medium">Discount type</label>
                  <select id="discount_type" name="discount_type" className="w-full rounded-lg border px-3 py-2" defaultValue="percent">
                    <option value="percent">Percent (%)</option>
                    <option value="amount">Amount (EGP)</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="discount_value" className="text-sm font-medium">
                    Discount value <span className="text-red-600">*</span>
                  </label>
                  <input id="discount_value" name="discount_value" type="number" min={1} step="1" required className="w-full rounded-lg border px-3 py-2" placeholder="e.g. 10" />
                </div>
              </div>

              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Applies to <span className="text-red-600">*</span></legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="applies_to" value="membership" className="h-4 w-4" />
                    <span>Membership</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="applies_to" value="dropin" className="h-4 w-4" />
                    <span>Drop-in</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="applies_to" value="private" className="h-4 w-4" />
                    <span>Private</span>
                  </label>
                </div>
              </fieldset>

              <div className="grid gap-1.5 md:grid-cols-3">
                <div className="grid gap-1.5">
                  <label htmlFor="min_months" className="text-sm font-medium">Min. months</label>
                  <input id="min_months" name="min_months" type="number" min={0} step="1" className="w-full rounded-lg border px-3 py-2" placeholder="e.g. 3" />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="start_date" className="text-sm font-medium">Start date</label>
                  <input id="start_date" name="start_date" type="date" className="w-full rounded-lg border px-3 py-2" />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="end_date" className="text-sm font-medium">End date</label>
                  <input id="end_date" name="end_date" type="date" className="w-full rounded-lg border px-3 py-2" />
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button type="submit">Create promo</Button>
                <Button asChild variant="outline" href="/packages-and-promos">Cancel</Button>
              </div>

              <p className="text-xs text-[hsl(var(--muted))] mt-2">Only super admin can create promotions.</p>
            </form>
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
