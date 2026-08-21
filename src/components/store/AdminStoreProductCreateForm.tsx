'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'

type CategoryOption = {
  key: string
  label: string
  is_active?: boolean | null
}

type ModelOption = {
  id: string
  category_key: string | null
  category_label?: string | null
  name: string
  slug?: string | null
  is_active?: boolean | null
}

type InitialVariant = {
  sourceProductId: string
  category: string
  modelId: string
  modelName: string | null
  priceCents: number | null
}

type FormState = {
  category: string
  modelId: string
  name: string
  color: string
  size: string
  priceEgp: string
  inventoryQty: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  category: '',
  modelId: '',
  name: '',
  color: '',
  size: '',
  priceEgp: '',
  inventoryQty: '0',
  isActive: true,
}

function formatCentsForInput(cents: number | null | undefined) {
  const n = Number(cents ?? 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  const amount = n / 100
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

function buildInitialForm(initialVariant?: InitialVariant | null): FormState {
  if (!initialVariant) return EMPTY_FORM
  return {
    ...EMPTY_FORM,
    category: clean(initialVariant.category),
    modelId: clean(initialVariant.modelId),
    priceEgp: formatCentsForInput(initialVariant.priceCents),
    inventoryQty: '0',
  }
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function parsePositiveMoneyToCents(value: string) {
  const normalized = clean(value).replace(/\s+/g, '').replace(/,/g, '.')
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount * 100)
}

function parseNonNegativeInt(value: string) {
  const amount = Number(clean(value))
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.floor(amount)
}

function formatEGP(cents: number | null | undefined) {
  const amount = Number(cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} EGP`
  }
}

function fileLabel(file: File | null | undefined) {
  if (!file || file.size <= 0) return ''
  return file.name || 'Selected photo'
}

function buildModelLabel(model: ModelOption) {
  const category = clean(model.category_label || model.category_key)
  return category ? `${model.name} · ${category}` : model.name
}

export default function AdminStoreProductCreateForm({
  initialVariant = null,
}: {
  initialVariant?: InitialVariant | null
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const baseForm = useMemo(() => buildInitialForm(initialVariant), [initialVariant])
  const isVariantMode = Boolean(initialVariant?.sourceProductId && initialVariant?.modelId)
  const [form, setForm] = useState<FormState>(baseForm)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [photoNames, setPhotoNames] = useState<[string, string, string]>(['', '', ''])

  useEffect(() => {
    setForm(baseForm)
    setPhotoNames(['', '', ''])
    setAdvancedOpen(isVariantMode)
    formRef.current?.reset()
  }, [baseForm, isVariantMode])

  useEffect(() => {
    let cancelled = false

    async function loadOptions() {
      setLoadingOptions(true)
      try {
        const [categoriesRes, modelsRes] = await Promise.all([
          fetch('/api/store/categories/list', { cache: 'no-store' }),
          fetch('/api/store/models/list', { cache: 'no-store' }),
        ])

        const categoriesJson = await categoriesRes.json().catch(() => null)
        const modelsJson = await modelsRes.json().catch(() => null)

        if (!categoriesRes.ok || categoriesJson?.ok === false) {
          throw new Error(categoriesJson?.details || categoriesJson?.error || 'Could not load Store categories.')
        }
        if (!modelsRes.ok || modelsJson?.ok === false) {
          throw new Error(modelsJson?.details || modelsJson?.error || 'Could not load Store models.')
        }

        const nextCategories = Array.isArray(categoriesJson?.items) ? categoriesJson.items : []
        const nextModels = Array.isArray(modelsJson?.items) ? modelsJson.items : []

        if (cancelled) return
        setCategories(nextCategories)
        setModels(nextModels)

        setForm((current) => {
          if (current.category) return current
          const firstCategory = nextCategories.find((item: CategoryOption) => clean(item.key))?.key || ''
          return { ...current, category: firstCategory }
        })
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message || 'Could not load product form options.')
      } finally {
        if (!cancelled) setLoadingOptions(false)
      }
    }

    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const categoryOptions = useMemo(() => {
    return categories.filter((item) => clean(item.key) && item.is_active !== false)
  }, [categories])

  const modelsForCategory = useMemo(() => {
    return models
      .filter((item) => item.is_active !== false)
      .filter((item) => !form.category || item.category_key === form.category)
      .sort((a, b) => buildModelLabel(a).localeCompare(buildModelLabel(b), undefined, { numeric: true, sensitivity: 'base' }))
  }, [form.category, models])

  const selectedModel = useMemo(() => {
    return models.find((item) => item.id === form.modelId) ?? null
  }, [form.modelId, models])

  const selectedCategoryLabel = useMemo(() => {
    return categoryOptions.find((item) => item.key === form.category)?.label || form.category || '—'
  }, [categoryOptions, form.category])

  const resolvedProductName = useMemo(() => {
    const explicit = clean(form.name)
    if (explicit) return explicit

    const base = clean(selectedModel?.name)
    const details = [clean(form.color), clean(form.size)].filter(Boolean)
    if (!base) return details.join(' · ')
    return details.length ? `${base} · ${details.join(' · ')}` : base
  }, [form.color, form.name, form.size, selectedModel?.name])

  const priceCents = useMemo(() => parsePositiveMoneyToCents(form.priceEgp), [form.priceEgp])
  const inventoryQty = useMemo(() => parseNonNegativeInt(form.inventoryQty), [form.inventoryQty])

  const summaryItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    const photos = photoNames.filter(Boolean)
    return [
      { label: 'Category', value: selectedCategoryLabel },
      { label: 'Model', value: selectedModel ? selectedModel.name : '—' },
      { label: 'Product / variant', value: resolvedProductName || '—' },
      { label: 'Color', value: clean(form.color) || '—' },
      { label: 'Size', value: clean(form.size) || '—' },
      { label: 'Selling price', value: priceCents == null ? '—' : formatEGP(priceCents) },
      { label: 'Initial stock', value: inventoryQty == null ? '—' : String(inventoryQty) },
      { label: 'Status', value: form.isActive ? 'Active' : 'Inactive' },
      { label: 'Photos', value: photos.length ? photos.join(', ') : 'No photo' },
      { label: 'Source', value: isVariantMode ? `Variant from ${initialVariant?.modelName || 'existing model'}` : 'New product entry' },
      { label: 'Impact', value: isVariantMode ? 'A new variant will be created from the selected model. Existing products will not be modified.' : 'A new Store product variant will be created.' },
    ]
  }, [form.color, form.isActive, form.size, initialVariant?.modelName, inventoryQty, isVariantMode, photoNames, priceCents, resolvedProductName, selectedCategoryLabel, selectedModel])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function validateForm() {
    if (!form.category) {
      toast.error('Select a category.')
      return false
    }
    if (!form.modelId) {
      toast.error('Select a model before creating the product.')
      return false
    }
    if (!resolvedProductName) {
      toast.error('Add a product name, color, or size.')
      return false
    }
    if (priceCents == null || priceCents <= 0) {
      toast.error('Enter a valid selling price.')
      return false
    }
    if (inventoryQty == null) {
      toast.error('Enter a valid initial stock quantity.')
      return false
    }
    return true
  }

  function openConfirmation(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (saving) return
    if (!validateForm()) return
    setConfirmOpen(true)
  }

  async function createProduct() {
    if (saving) return
    if (!validateForm()) return

    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('category', form.category)
      fd.set('model_id', form.modelId)
      fd.set('name', resolvedProductName)
      fd.set('color', clean(form.color))
      fd.set('size', clean(form.size))
      fd.set('price_cents', String(priceCents ?? 0))
      fd.set('inventory_qty', String(inventoryQty ?? 0))
      fd.set('is_active', form.isActive ? '1' : '0')
      fd.set('currency', 'EGP')

      const formElement = formRef.current
      const imageKeys = ['image_1', 'image_2', 'image_3'] as const
      for (const key of imageKeys) {
        const field = formElement?.elements.namedItem(key)
        const input = field instanceof HTMLInputElement ? field : null
        const file = input?.files?.[0]
        if (file) fd.set(key, file)
      }

      const res = await fetch('/api/store/products/create', {
        method: 'POST',
        body: fd,
      })
      const json = await res.json().catch(() => null)

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.details || json?.error || 'Could not create the product.')
      }

      toast.success('Product created')
      setConfirmOpen(false)
      setForm((current) => {
        if (isVariantMode) {
          return { ...baseForm, category: current.category || baseForm.category, modelId: current.modelId || baseForm.modelId, priceEgp: current.priceEgp || baseForm.priceEgp }
        }
        return { ...EMPTY_FORM, category: current.category }
      })
      setPhotoNames(['', '', ''])
      formRef.current?.reset()
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (error: any) {
      toast.error(error?.message || 'Could not create the product.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <form ref={formRef} onSubmit={openConfirmation} className="space-y-4">
        <div className={`rounded-2xl border px-3 py-2 text-xs ${isVariantMode ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          {isVariantMode ? (
            <>Variant mode: category, model, and price are prefilled from {initialVariant?.modelName || 'the selected model'}. Add the new color/size/stock, then confirm.</>
          ) : (
            <>Quick mode: choose the category and model, then add price and stock. Photos and details can stay optional.</>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Required</div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-black">Category</span>
            <select
              value={form.category}
              onChange={(event) => {
                const nextCategory = event.target.value
                setForm((current) => ({
                  ...current,
                  category: nextCategory,
                  modelId: models.some((item) => item.id === current.modelId && item.category_key === nextCategory) ? current.modelId : '',
                }))
              }}
              disabled={loadingOptions || saving}
              className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
            >
              <option value="">Select category</option>
              {categoryOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-black">Product model</span>
            <select
              value={form.modelId}
              onChange={(event) => update('modelId', event.target.value)}
              disabled={loadingOptions || saving || !form.category}
              className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
            >
              <option value="">Select existing model</option>
              {modelsForCategory.map((model) => (
                <option key={model.id} value={model.id}>{buildModelLabel(model)}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
              Models keep Store V3 organized. Create a new model from the Models page if it does not exist yet.
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-black">Variant name</span>
            <input
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              disabled={saving}
              placeholder={selectedModel ? `${selectedModel.name} · Black · A1` : 'Example: Kimono ATOM · Black · A1'}
              className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
            />
            <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
              You can leave this empty if color/size are enough. The app will build the name from the model.
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-black">Selling price</span>
              <input
                inputMode="decimal"
                value={form.priceEgp}
                onChange={(event) => update('priceEgp', event.target.value)}
                disabled={saving}
                placeholder="1200"
                className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
              />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">EGP only.</span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-black">Initial stock</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.inventoryQty}
                onChange={(event) => update('inventoryQty', event.target.value)}
                disabled={saving}
                className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border bg-white">
          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            className="flex min-h-[44px] w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-semibold"
          >
            <span>Optional details</span>
            <span className="text-xs text-[hsl(var(--muted))]">{advancedOpen ? 'Hide' : 'Show'}</span>
          </button>

          {advancedOpen ? (
            <div className="space-y-3 border-t p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-black">Color</span>
                  <input
                    value={form.color}
                    onChange={(event) => update('color', event.target.value)}
                    disabled={saving}
                    placeholder="Black"
                    className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-black">Size</span>
                  <input
                    value={form.size}
                    onChange={(event) => update('size', event.target.value)}
                    disabled={saving}
                    placeholder="A1 / M / One size"
                    className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => update('isActive', event.target.checked)}
                  disabled={saving}
                />
                <span>Active in catalog after creation</span>
              </label>

              <div className="grid gap-2">
                <div className="text-sm font-semibold text-black">Photos</div>
                {[0, 1, 2].map((index) => (
                  <label key={index} className="block">
                    <span className="mb-1 block text-xs font-medium text-[hsl(var(--muted))]">Photo {index + 1}</span>
                    <input
                      name={`image_${index + 1}`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={saving}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null
                        setPhotoNames((current) => {
                          const next: [string, string, string] = [...current] as [string, string, string]
                          next[index] = fileLabel(file)
                          return next
                        })
                      }}
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                    />
                  </label>
                ))}
                <div className="text-xs text-[hsl(var(--muted))]">JPG, PNG or WEBP. Max 1 MB per photo.</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving || loadingOptions}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:opacity-95 disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create product'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setForm((current) => (isVariantMode ? { ...baseForm, category: current.category || baseForm.category, modelId: current.modelId || baseForm.modelId } : { ...EMPTY_FORM, category: current.category }))
              setPhotoNames(['', '', ''])
              formRef.current?.reset()
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-soft hover:bg-[hsl(var(--surface-2))] disabled:pointer-events-none disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </form>

      <ConfirmActionModal
        open={confirmOpen}
        title={isVariantMode ? 'Confirm variant creation' : 'Confirm product creation'}
        description={isVariantMode ? 'Review the new variant before adding it to this existing product model.' : 'Review the product details before creating this Store item.'}
        confirmLabel={isVariantMode ? 'Confirm & add variant' : 'Confirm & create'}
        pendingLabel="Creating…"
        pending={saving}
        summaryItems={summaryItems}
        warning={isVariantMode ? 'This creates a new variant only. The original product/model and existing stock history will not be modified.' : 'This will create a new Store product variant. Existing products and stock history will not be modified.'}
        onCancel={() => (saving ? null : setConfirmOpen(false))}
        onConfirm={createProduct}
      />
    </>
  )
}
