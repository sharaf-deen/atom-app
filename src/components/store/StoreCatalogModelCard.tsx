'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { formatCurrency } from '@/lib/money'
import StorePreorderAction from '@/components/store/StorePreorderAction'

type Variant = {
  id: string
  category: string
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  is_active: boolean
  allow_preorder: boolean
}

type ModelCardProps = {
  model: {
    key: string
    categoryLabel: string
    name: string
    color: string | null
    imageUrl: string
    priceMinCents: number
    priceMaxCents: number
    currency: string
    variants: Variant[]
  }
}

const SIZE_RANK: Record<string, number> = {
  '3XS': 0,
  'XXXS': 0,
  '2XS': 1,
  'XXS': 1,
  XS: 2,
  S: 3,
  M: 4,
  L: 5,
  XL: 6,
  '2XL': 7,
  XXL: 7,
  '3XL': 8,
  XXXL: 8,
  '4XL': 9,
}

function normalizeSizeLabel(size: string | null | undefined) {
  const clean = String(size ?? '').trim()
  return clean || 'Standard'
}

function sortVariantsBySize(a: Variant, b: Variant) {
  const aLabel = normalizeSizeLabel(a.size)
  const bLabel = normalizeSizeLabel(b.size)
  const aRank = SIZE_RANK[aLabel.toUpperCase()]
  const bRank = SIZE_RANK[bLabel.toUpperCase()]

  if (typeof aRank === 'number' && typeof bRank === 'number' && aRank !== bRank) return aRank - bRank
  if (typeof aRank === 'number' && typeof bRank !== 'number') return -1
  if (typeof aRank !== 'number' && typeof bRank === 'number') return 1
  return aLabel.localeCompare(bLabel, 'en', { numeric: true, sensitivity: 'base' })
}

function PriceLabel({ min, max, currency }: { min: number; max: number; currency: string }) {
  if (min === max) return <>{formatCurrency(min, 'en-EG', currency)}</>
  return (
    <>
      From {formatCurrency(min, 'en-EG', currency)}
    </>
  )
}

export default function StoreCatalogModelCard({ model }: ModelCardProps) {
  const [expanded, setExpanded] = useState(false)
  const variants = useMemo(() => [...model.variants].sort(sortVariantsBySize), [model.variants])
  const singleVariant = variants.length === 1 ? variants[0] : null
  const [selectedId, setSelectedId] = useState<string>(singleVariant?.id ?? '')

  const selectedVariant = variants.find((variant) => variant.id === selectedId) ?? singleVariant ?? null
  const selectedSizeLabel = selectedVariant ? normalizeSizeLabel(selectedVariant.size) : ''

  return (
    <Card hover>
      <CardContent className="space-y-4 py-4">
        {model.imageUrl ? (
          <div className="overflow-hidden rounded-2xl border bg-slate-50">
            <img src={model.imageUrl} alt={model.name} className="h-48 w-full object-cover" loading="lazy" />
          </div>
        ) : null}

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                {model.categoryLabel}
              </span>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                {variants.length} size{variants.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="mt-3 text-base font-semibold leading-snug">{model.name}</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">
              {model.color?.trim() ? model.color : 'Choose your size after opening the model.'}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Price</div>
            <div className="mt-1 text-base font-semibold">
              <PriceLabel min={model.priceMinCents} max={model.priceMaxCents} currency={model.currency} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3 text-sm text-[hsl(var(--muted))]">
          Open the model, choose the size you want, then send the pre-order request.
        </div>

        {expanded ? (
          <div className="space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-white/80 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">Choose size</div>
              {selectedSizeLabel ? (
                <span className="rounded-full border border-black bg-black px-2.5 py-1 text-[11px] font-medium text-white">
                  Selected: {selectedSizeLabel}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {variants.map((variant) => {
                const sizeLabel = normalizeSizeLabel(variant.size)
                const active = selectedId === variant.id
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setSelectedId(variant.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-[hsl(var(--border))] bg-white text-black hover:bg-gray-50'
                    }`}
                  >
                    {sizeLabel}
                  </button>
                )
              })}
            </div>

            {selectedVariant ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3 text-sm">
                <div className="font-medium">{model.name}</div>
                <div className="mt-1 text-[hsl(var(--muted))]">
                  {model.color?.trim() ? `${model.color} · ` : ''}
                  {selectedSizeLabel}
                </div>
                <div className="mt-2 font-semibold">
                  {formatCurrency(selectedVariant.price_cents ?? 0, 'en-EG', selectedVariant.currency ?? model.currency)}
                </div>
              </div>
            ) : null}

            {selectedVariant ? <StorePreorderAction product={selectedVariant} /> : null}

            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" onClick={() => setExpanded(true)} className="w-full sm:w-auto">
            Open model
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
