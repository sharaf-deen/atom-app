'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import StorePreorderAction from '@/components/store/StorePreorderAction'
import { formatCurrency } from '@/lib/money'

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
  image_url: string | null
  image_urls: string[]
}

type ColorGroup = {
  key: string
  label: string
  image_url: string | null
  image_urls: string[]
  variants: Variant[]
}

type Model = {
  key: string
  category: string
  categoryLabel: string
  name: string
  description: string | null
  priceFromCents: number
  priceToCents: number
  currency: string
  colorGroups: ColorGroup[]
  previewImageUrl: string | null
  sortOrder?: number
}

function sortByLabel<T extends { label: string }>(items: T[]) {
  return [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }))
}

function uniqueImages(images: Array<string | null | undefined>) {
  return Array.from(new Set(images.map((image) => String(image ?? '').trim()).filter(Boolean))).slice(0, 3)
}

export default function StoreCatalogModelCard({
  model,
  canPreorder,
}: {
  model: Model
  canPreorder: boolean
}) {
  const [open, setOpen] = useState(false)
  const [selectedColorKey, setSelectedColorKey] = useState<string>(() => {
    return model.colorGroups.length === 1 ? model.colorGroups[0]?.key ?? '' : ''
  })
  const [selectedSizeKey, setSelectedSizeKey] = useState('')
  const [modalImage, setModalImage] = useState<string | null>(null)

  const selectedColor = useMemo(() => {
    return model.colorGroups.find((group) => group.key === selectedColorKey) ?? null
  }, [model.colorGroups, selectedColorKey])

  const availableSizes = useMemo(() => {
    if (!selectedColor) return []

    const bySize = new Map<string, Variant>()
    for (const variant of selectedColor.variants) {
      const key = String(variant.size ?? '').trim() || '__onesize'
      if (!bySize.has(key)) bySize.set(key, variant)
    }

    return sortByLabel(
      Array.from(bySize.values()).map((variant) => ({
        key: String(variant.size ?? '').trim() || '__onesize',
        label: String(variant.size ?? '').trim() || 'One size',
        variant,
      }))
    )
  }, [selectedColor])

  useEffect(() => {
    if (!selectedColor) {
      setSelectedSizeKey('')
      return
    }

    if (availableSizes.length === 1) {
      setSelectedSizeKey(availableSizes[0]?.key ?? '')
      return
    }

    const stillExists = availableSizes.some((item) => item.key === selectedSizeKey)
    if (!stillExists) setSelectedSizeKey('')
  }, [availableSizes, selectedColor, selectedSizeKey])

  const selectedSize = useMemo(() => {
    return availableSizes.find((item) => item.key === selectedSizeKey) ?? null
  }, [availableSizes, selectedSizeKey])

  const selectedVariant = selectedSize?.variant ?? null
  const galleryImages = useMemo(() => {
    return uniqueImages([
      ...(selectedVariant?.image_urls ?? []),
      ...(selectedColor?.image_urls ?? []),
      model.previewImageUrl,
    ])
  }, [model.previewImageUrl, selectedColor, selectedVariant])
  const selectedImage = galleryImages[0] ?? null
  const hasMultipleColors = model.colorGroups.length > 1
  const hasMultipleSizes = availableSizes.length > 1
  const priceLabel =
    model.priceFromCents === model.priceToCents
      ? formatCurrency(model.priceFromCents, 'en-EG', model.currency)
      : `From ${formatCurrency(model.priceFromCents, 'en-EG', model.currency)}`

  return (
    <>
      <Card hover>
        <CardContent className="space-y-4 py-4">
          {galleryImages.length > 0 ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setModalImage(selectedImage)}
                className="block w-full overflow-hidden rounded-2xl border bg-slate-50 text-left"
              >
                <img src={selectedImage ?? ''} alt={model.name} className="h-48 w-full object-cover" loading="lazy" />
              </button>

              {galleryImages.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {galleryImages.slice(1).map((image, index) => (
                    <button
                      key={`${image}-${index + 1}`}
                      type="button"
                      onClick={() => setModalImage(image)}
                      className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border bg-slate-50 ring-offset-2 transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-black"
                      aria-label={`Open ${model.name} photo ${index + 2}`}
                    >
                      <img src={image} alt={`${model.name} ${index + 2}`} className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                  {model.categoryLabel}
                </span>
                {canPreorder ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                    Pre-order open
                  </span>
                ) : null}
                <span className="rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted))]">
                  {model.colorGroups.length} color{model.colorGroups.length > 1 ? 's' : ''}
                </span>
                <span className="rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted))]">
                  {model.colorGroups.reduce((sum, group) => sum + group.variants.length, 0)} size option{model.colorGroups.reduce((sum, group) => sum + group.variants.length, 0) > 1 ? 's' : ''}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="mt-3 block text-left"
              >
                <div className="text-base font-semibold leading-snug">{model.name}</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                  {String(model.description || '').trim() || (hasMultipleColors ? 'Choose color, then size.' : 'Choose your size.')}
                </div>
              </button>
            </div>

            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Price</div>
              <div className="mt-1 text-base font-semibold">{priceLabel}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-3 py-3 text-sm text-[hsl(var(--muted))]">
            Open the model, choose your {hasMultipleColors ? 'color and size' : 'size'}, then send the preorder request.
          </div>

          {open ? (
            <div className="space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-white/90 p-4">
              {hasMultipleColors ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">1. Choose color</div>
                  <div className="flex flex-wrap gap-2">
                    {sortByLabel(model.colorGroups).map((group) => {
                      const active = group.key === selectedColorKey
                      return (
                        <button
                          key={group.key}
                          type="button"
                          onClick={() => setSelectedColorKey(group.key)}
                          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                            active
                              ? 'border-black bg-black text-white'
                              : 'border-[hsl(var(--border))] bg-white text-black hover:bg-gray-50'
                          }`}
                        >
                          {group.label}
                        </button>
                      )
                    })}
                  </div>
                  {selectedColor ? (
                    <div className="text-xs text-[hsl(var(--muted))]">
                      Gallery updated for {selectedColor.label}.
                    </div>
                  ) : null}
                </div>
              ) : selectedColor ? (
                <div className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Color</div>
                  <div className="text-sm font-medium">{selectedColor.label}</div>
                </div>
              ) : null}

              {selectedColor ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                    {hasMultipleColors ? '2. Choose size' : '1. Choose size'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableSizes.map((item) => {
                      const active = item.key === selectedSizeKey
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setSelectedSizeKey(item.key)}
                          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                            active
                              ? 'border-black bg-black text-white'
                              : 'border-[hsl(var(--border))] bg-white text-black hover:bg-gray-50'
                          }`}
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                  {hasMultipleSizes ? (
                    <div className="text-xs text-[hsl(var(--muted))]">Tap the exact size you want before sending the request.</div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3 text-sm text-[hsl(var(--muted))]">
                  Choose a color first to unlock the available sizes and photos.
                </div>
              )}

              {selectedVariant ? (
                <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Selected option</div>
                      <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                        {[selectedVariant.color, selectedVariant.size].filter(Boolean).join(' · ') || 'Store item'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Unit price</div>
                      <div className="mt-1 text-sm font-semibold">
                        {formatCurrency(selectedVariant.price_cents ?? 0, 'en-EG', selectedVariant.currency ?? model.currency)}
                      </div>
                    </div>
                  </div>

                  {canPreorder ? (
                    <StorePreorderAction
                      key={selectedVariant.id}
                      product={{
                        id: selectedVariant.id,
                        category: selectedVariant.category,
                        name: selectedVariant.name,
                        color: selectedVariant.color,
                        size: selectedVariant.size,
                        price_cents: selectedVariant.price_cents,
                        currency: selectedVariant.currency,
                        is_active: selectedVariant.is_active,
                        allow_preorder: selectedVariant.allow_preorder,
                      }}
                    />
                  ) : null}
                </div>
              ) : selectedColor ? (
                <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3 text-sm text-[hsl(var(--muted))]">
                  Choose the exact size to continue.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                {hasMultipleColors ? 'Choose color & size' : 'Choose size'}
              </button>
              <div className="text-xs text-[hsl(var(--muted))]">Model first. Variant after.</div>
            </div>
          )}
        </CardContent>
      </Card>

      {modalImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${model.name} photo preview`}
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setModalImage(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium shadow hover:bg-white"
            >
              Close
            </button>
            <img src={modalImage} alt={model.name} className="max-h-[90vh] w-full object-contain bg-black" />
          </div>
        </div>
      ) : null}
    </>
  )
}
