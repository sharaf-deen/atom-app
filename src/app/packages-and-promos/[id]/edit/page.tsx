// src/app/packages-and-promos/[id]/edit/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import React from 'react'
import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { updatePromo } from '@/app/packages-and-promos/actions'
import DeletePromoButton from '@/components/promos/DeletePromoButton'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

type Promo = {
  id: string
  title: string
  description: string | null
  discount_type: 'percent' | 'amount' | null
  discount_value: number | string | null
  applies_to: ('membership' | 'dropin' | 'private')[] | null
  min_months: number | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

function parseDate(d: string | null) {
  if (!d) return ''
  return d.length >= 10 ? d.slice(0, 10) : d
}

export default async function EditPromoPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user || (user.role as Role) !== 'super_admin') {
    redirect('/packages-and-promos')
  }

  const supabase = createSupabaseRSC()
  const { data: promo, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Promo>()

  if (error) console.error('promotions select error', error)
  if (!promo) notFound()

  async function onSubmit(formData: FormData) {
    'use server'
    await updatePromo(params.id, formData)
  }

  return (
    <main>
      <PageHeader
        title="Edit Promotion"
        right={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" href="/packages-and-promos">Back</Button>
            <DeletePromoButton id={params.id} label="Delete" />
          </div>
        }
      />

      <Section>
        <Card>
          <CardContent>
            <form action={onSubmit} className="grid gap-4 max-w-2xl">
              <div className="grid gap-1.5">
                <label htmlFor="title" className="text-sm font-medium">
                  Title <span className="text-red-600">*</span>
                </label>
                <input id="title" name="title" required defaultValue={promo.title} className="w-full rounded-lg border px-3 py-2" />
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="description" className="text-sm font-medium">Description</label>
                <textarea id="description" name="description" rows={3} defaultValue={promo.description ?? ''} className="w-full rounded-lg border px-3 py-2" />
              </div>

              <div className="grid gap-1.5 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor="discount_type" className="text-sm font-medium">Discount type</label>
                  <select id="discount_type" name="discount_type" className="w-full rounded-lg border px-3 py-2" defaultValue={promo.discount_type ?? 'percent'}>
                    <option value="percent">Percent (%)</option>
                    <option value="amount">Amount (EGP)</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="discount_value" className="text-sm font-medium">Discount value <span className="text-red-600">*</span></label>
                  <input id="discount_value" name="discount_value" type="number" min={1} step="1" required defaultValue={Number(promo.discount_value ?? 0)} className="w-full rounded-lg border px-3 py-2" />
                </div>
              </div>

              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Applies to <span className="text-red-600">*</span></legend>
                <div className="flex flex-wrap gap-4">
                  {(['membership', 'dropin', 'private'] as const).map((k) => {
                    const checked = (promo.applies_to ?? []).includes(k)
                    return (
                      <label key={k} className="flex items-center gap-2">
                        <input type="checkbox" name="applies_to" value={k} className="h-4 w-4" defaultChecked={checked} />
                        <span className="capitalize">{k}</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              <div className="grid gap-1.5 md:grid-cols-3">
                <div className="grid gap-1.5">
                  <label htmlFor="min_months" className="text-sm font-medium">Min. months</label>
                  <input id="min_months" name="min_months" type="number" min={0} step="1" defaultValue={promo.min_months ?? ''} className="w-full rounded-lg border px-3 py-2" />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="start_date" className="text-sm font-medium">Start date</label>
                  <input id="start_date" name="start_date" type="date" defaultValue={parseDate(promo.start_date)} className="w-full rounded-lg border px-3 py-2" />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="end_date" className="text-sm font-medium">End date</label>
                  <input id="end_date" name="end_date" type="date" defaultValue={parseDate(promo.end_date)} className="w-full rounded-lg border px-3 py-2" />
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button type="submit">Save changes</Button>
                <Button asChild variant="outline" href="/packages-and-promos">Cancel</Button>
              </div>

              <p className="text-xs text-[hsl(var(--muted))] mt-2">Only super admin can edit or delete promotions.</p>
            </form>
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
