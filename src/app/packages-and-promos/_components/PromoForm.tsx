// src/app/packages-and-promos/_components/PromoForm.tsx
'use client'

import { useTransition } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Card, CardContent } from '@/components/ui/Card'

export type PromoFormValues = {
  id?: string
  title?: string
  description?: string | null
  discount_type?: 'percent' | 'amount'
  discount_value?: number
  applies_to?: ('membership' | 'dropin' | 'private')[]
  min_months?: number | null
  start_date?: string | null
  end_date?: string | null
  is_active?: boolean
}

export default function PromoForm({
  defaultValues,
  onSubmit,
}: {
  defaultValues?: PromoFormValues
  onSubmit: (formData: FormData) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const d = defaultValues || {}

  // ✅ L'action reçoit un FormData (signature correcte pour <form action={...}> en client component)
  async function submitAction(formData: FormData) {
    startTransition(async () => {
      await onSubmit(formData)
      window.location.href = '/packages-and-promos'
    })
  }

  return (
    <Card>
      <CardContent>
        <form action={submitAction} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium">Title</label>
              <Input id="title" name="title" defaultValue={d.title || ''} required />
            </div>

            <div className="space-y-2">
              <label htmlFor="discount_value" className="text-sm font-medium">Discount value</label>
              <Input
                id="discount_value"
                name="discount_value"
                type="number"
                step="0.01"
                min="0"
                defaultValue={d.discount_value ?? ''}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="discount_type" className="text-sm font-medium">Discount type</label>
              <select
                id="discount_type"
                name="discount_type"
                defaultValue={d.discount_type || 'percent'}
                className="w-full rounded-md border bg-white px-3 py-2 text-sm"
              >
                <option value="percent">Percent %</option>
                <option value="amount">Amount (EGP)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="min_months" className="text-sm font-medium">Min. months (optional)</label>
              <Input id="min_months" name="min_months" type="number" min="0" defaultValue={d.min_months ?? ''} />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium">Description</label>
            <Textarea id="description" name="description" defaultValue={d.description || ''} rows={4} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="start_date" className="text-sm font-medium">Start date</label>
              <Input id="start_date" name="start_date" type="date" defaultValue={d.start_date || ''} />
            </div>
            <div className="space-y-2">
              <label htmlFor="end_date" className="text-sm font-medium">End date</label>
              <Input id="end_date" name="end_date" type="date" defaultValue={d.end_date || ''} />
            </div>
          </div>

          <fieldset className="space-y-3">
            <span className="text-sm font-medium">Applies to</span>
            <div className="flex flex-wrap gap-4">
              {(['membership','dropin','private'] as const).map((opt) => {
                const checked = d.applies_to?.includes(opt) ?? (opt === 'membership')
                return (
                  <label key={opt} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="applies_to"
                      value={opt}
                      defaultChecked={checked}
                      className="h-4 w-4 rounded border"
                    />
                    <span className="capitalize">{opt}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          {/* Switch = simple checkbox stylée pour is_active */}
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <div className="font-medium text-sm">Active</div>
              <div className="text-xs text-[hsl(var(--muted))]">Décoche pour archiver.</div>
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={d.is_active ?? true}
                className="peer sr-only"
              />
              {/* Visuel du switch */}
              <span
                className="
                  relative inline-block h-6 w-11 cursor-pointer rounded-full bg-gray-300
                  after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition
                  peer-checked:bg-emerald-500 peer-checked:after:translate-x-5
                "
                aria-hidden="true"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save promo'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => history.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
