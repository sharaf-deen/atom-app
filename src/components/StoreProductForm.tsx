'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { parsePriceToCents, toPriceString } from '@/lib/money'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import {
  ensureCategoryInList,
  FALLBACK_STORE_PRODUCT_CATEGORIES,
  type StoreProductCategoryRow,
} from '@/lib/storeCategories'
import {
  buildStoreModelOptionLabel,
  sortStoreModels,
  type StoreProductModelRow,
} from '@/lib/storeModels'

type Product = {
  id?: string
  category?: string
  model_id?: string | null
  model_name?: string | null
  name: string
  color?: string | null
  size?: string | null
  price_cents: number
  currency?: string | null
  inventory_qty?: number
  is_active?: boolean
  image_path?: string | null
  image_path_2?: string | null
  image_path_3?: string | null
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const STORE_PRODUCT_BUCKET = 'store-product-images'
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

function storeProductImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!SUPABASE_URL || !clean) return ''
  const encodedPath = clean.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${SUPABASE_URL}/storage/v1/object/public/${STORE_PRODUCT_BUCKET}/${encodedPath}`
}

function resolveStoreProductImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!clean) return ''
  if (/^https?:\/\//i.test(clean)) return clean
  return storeProductImageUrl(clean)
}

function getExistingImagePaths(product?: Product) {
  return [
    product?.image_path ?? null,
    product?.image_path_2 ?? null,
    product?.image_path_3 ?? null,
  ] as const
}

export default function StoreProductForm({
  product,
  onSaved,
  onCancel,
}: {
  product?: Product
  onSaved?: () => void
  onCancel?: () => void
}) {
  const [categories, setCategories] = useState<StoreProductCategoryRow[]>(
    ensureCategoryInList(FALLBACK_STORE_PRODUCT_CATEGORIES, product?.category, product?.category)
  )
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [models, setModels] = useState<StoreProductModelRow[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  const [category, setCategory] = useState<string>(product?.category ?? FALLBACK_STORE_PRODUCT_CATEGORIES[0]?.key ?? 'kimono')
  const [modelId, setModelId] = useState<string>(product?.model_id ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [color, setColor] = useState(product?.color ?? '')
  const [size, setSize] = useState(product?.size ?? '')
  const [price, setPrice] = useState<string>(toPriceString(product?.price_cents ?? 0))
  const [currency, setCurrency] = useState(product?.currency ?? 'EGP')
  const [inventory, setInventory] = useState<number>(Number(product?.inventory_qty ?? 0))
  const [active, setActive] = useState<boolean>(product?.is_active ?? true)
  const [imageFiles, setImageFiles] = useState<[File | null, File | null, File | null]>([null, null, null])

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  const existingImagePaths = useMemo(() => getExistingImagePaths(product), [product])
  const existingImageUrls = useMemo(
    () => existingImagePaths.map((item) => resolveStoreProductImageUrl(item)),
    [existingImagePaths]
  )

  const imagePreviewUrls = useMemo(
    () => imageFiles.map((file) => (file ? URL.createObjectURL(file) : '')) as [string, string, string],
    [imageFiles]
  )

  const modelOptions = useMemo(
    () => sortStoreModels(models.filter((item) => item.category_key === category)),
    [models, category]
  )

  const selectedModel = useMemo(
    () => modelOptions.find((item) => item.id === modelId) ?? null,
    [modelOptions, modelId]
  )

  const modelRequirementMessage = useMemo(() => {
    if (selectedModel) return ''
    return 'Every Store variant must be linked to a Store model before it can be saved.'
  }, [selectedModel])

  useEffect(() => {
    return () => {
      imagePreviewUrls.forEach((url) => {
        if (url) URL.revokeObjectURL(url)
      })
    }
  }, [imagePreviewUrls])

  useEffect(() => {
    if (!product) return
    setCategory(product.category ?? FALLBACK_STORE_PRODUCT_CATEGORIES[0]?.key ?? 'kimono')
    setModelId(product.model_id ?? '')
    setName(product.name ?? '')
    setColor(product.color ?? '')
    setSize(product.size ?? '')
    setPrice(toPriceString(product.price_cents ?? 0))
    setCurrency(product.currency ?? 'EGP')
    setInventory(Number(product.inventory_qty ?? 0))
    setActive(product.is_active === undefined ? true : !!product.is_active)
    setImageFiles([null, null, null])
  }, [product])

  useEffect(() => {
    let cancelled = false
    async function loadCategories() {
      setCategoriesLoading(true)
      try {
        const res = await fetch('/api/store/categories/list?include_inactive=1', {
          cache: 'no-store',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        const rows = Array.isArray(json?.items) ? (json.items as StoreProductCategoryRow[]) : []
        const next = ensureCategoryInList(rows.length > 0 ? rows : FALLBACK_STORE_PRODUCT_CATEGORIES, product?.category, product?.category)
        if (!cancelled) {
          setCategories(next)
          if (!product?.category && next[0]?.key) setCategory((current) => current || next[0].key)
        }
      } catch {
        if (!cancelled) {
          const next = ensureCategoryInList(FALLBACK_STORE_PRODUCT_CATEGORIES, product?.category, product?.category)
          setCategories(next)
        }
      } finally {
        if (!cancelled) setCategoriesLoading(false)
      }
    }
    void loadCategories()
    return () => {
      cancelled = true
    }
  }, [product?.category])

  useEffect(() => {
    let cancelled = false
    async function loadModels() {
      setModelsLoading(true)
      try {
        const res = await fetch('/api/store/models/list', {
          cache: 'no-store',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        const rows = Array.isArray(json?.items) ? (json.items as StoreProductModelRow[]) : []
        if (!cancelled) setModels(sortStoreModels(rows))
      } catch {
        if (!cancelled) setModels([])
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }
    void loadModels()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!modelId || modelsLoading) return
    if (!modelOptions.some((item) => item.id === modelId)) {
      setModelId('')
    }
  }, [category, modelId, modelOptions, modelsLoading])

  function validateImage(file: File | null) {
    if (!file) return null

    const mime = (file.type || '').toLowerCase()
    if (!ACCEPTED_IMAGE_TYPES.includes(mime)) {
      return 'Photo must be JPG, PNG or WEBP.'
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return 'Photo is too large (max 5 MB).'
    }
    return null
  }

  function updateImageFile(index: 0 | 1 | 2, file: File | null) {
    setImageFiles((current) => {
      const next = [...current] as [File | null, File | null, File | null]
      next[index] = file
      return next
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', msg: '' })

    try {
      const price_cents = parsePriceToCents(price)

      for (const file of imageFiles) {
        const imageError = validateImage(file)
        if (imageError) {
          setStatus({ kind: 'error', msg: imageError })
          toast.error(imageError)
          return
        }
      }

      if (!category.trim()) {
        setStatus({ kind: 'error', msg: 'Category is required.' })
        toast.error('Category is required')
        return
      }
      if (!modelId.trim()) {
        setStatus({ kind: 'error', msg: 'Linked model is required.' })
        toast.error('Linked model is required')
        return
      }

      const fd = new FormData()
      if (product?.id) fd.set('id', product.id)
      fd.set('category', category.trim())
      fd.set('model_id', modelId || '')
      fd.set('name', name.trim())
      fd.set('color', color.trim())
      fd.set('size', size.trim())
      fd.set('price_cents', String(price_cents))
      fd.set('currency', currency || 'EGP')
      fd.set('inventory_qty', String(Number(inventory ?? 0)))
      fd.set('is_active', String(!!active))

      imageFiles.forEach((file, index) => {
        if (file) fd.set(`image_${index + 1}`, file)
      })

      const method: 'POST' | 'PATCH' = product?.id ? 'PATCH' : 'POST'
      const url = product?.id ? '/api/store/products/update' : '/api/store/products/create'

      const r = await fetch(url, {
        method,
        body: fd,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Save failed' })
        toast.error(j?.details || j?.error || 'Save failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Saved' })
      toast.success('Saved')
      setImageFiles([null, null, null])
      onSaved?.()
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Save failed')
    } finally {
      setBusy(false)
    }
  }

  const categoryOptions = categories.length > 0 ? categories : FALLBACK_STORE_PRODUCT_CATEGORIES

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Category *"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={busy || categoriesLoading}
          aria-label="Category"
        >
          {categoryOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>

        <Input
          label="Variant name *"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label="Name"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Linked model *"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={busy || modelsLoading}
          aria-label="Linked model"
        >
          <option value="">Select a linked model</option>
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {buildStoreModelOptionLabel(option)}
            </option>
          ))}
        </Select>

        <div className="rounded-2xl border bg-[hsl(var(--card))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
          {selectedModel ? (
            <div className="space-y-1">
              <div className="font-medium text-[hsl(var(--foreground))]">Linked to: {selectedModel.name}</div>
              <div>The selected model will group this variant in the Store catalog.</div>
            </div>
          ) : (
            <div className="space-y-1">
              <div>No parent model linked yet.</div>
              <div>
                Create or select the parent model in{' '}
                <Link href="/admin/store/models" className="font-medium underline underline-offset-2">
                  Store Models
                </Link>
                .
              </div>
            </div>
          )}
        </div>
      </div>

      {!selectedModel ? (
        <InlineAlert variant="error" compact>
          {modelRequirementMessage}
        </InlineAlert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Color" value={color} onChange={(e) => setColor(e.target.value)} disabled={busy} />
        <Input label="Size" value={size} onChange={(e) => setSize(e.target.value)} disabled={busy} />
        <Input
          label="Price *"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Currency"
          value={currency ?? 'EGP'}
          onChange={(e) => setCurrency(e.target.value)}
          placeholder="EGP"
          disabled={busy}
        />

        <Input
          label="Inventory qty"
          type="number"
          min={0}
          value={inventory}
          onChange={(e) => setInventory(Number(e.target.value || 0))}
          disabled={busy}
        />

        <label className="mt-7 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={busy}
            aria-label="Active"
          />
          <span>Active</span>
        </label>
      </div>

      <div className="grid gap-3">
        <div className="rounded-2xl border bg-[hsl(var(--card))] px-3 py-3 text-xs text-[hsl(var(--muted))]">
          Add up to 3 photos per product. Photo 1 is the main fallback image used across the Store when needed.
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((index) => {
            const slot = index as 0 | 1 | 2
            const previewUrl = imagePreviewUrls[slot] || existingImageUrls[slot] || ''
            const hasExisting = !!existingImageUrls[slot] && !imagePreviewUrls[slot]

            return (
              <div key={`image-slot-${slot}`} className="rounded-2xl border bg-white p-3">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Photo {slot + 1}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null
                      updateImageFile(slot, file)
                    }}
                  />
                  <span className="text-xs text-[hsl(var(--muted))]">
                    JPG, PNG or WEBP · max 5 MB {product?.id ? '· leave empty to keep current photo' : '· optional'}
                  </span>
                </label>

                <div className="mt-3 overflow-hidden rounded-2xl border bg-[hsl(var(--card))] p-2">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`${name || 'Product'} photo ${slot + 1}`}
                      className="h-36 w-full rounded-xl object-cover"
                    />
                  ) : (
                    <div className="grid h-36 place-items-center rounded-xl border border-dashed text-xs text-[hsl(var(--muted))]">
                      No photo selected
                    </div>
                  )}
                </div>

                {hasExisting ? (
                  <div className="mt-2 text-xs text-[hsl(var(--muted))]">Current photo kept unless you upload a replacement.</div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {status.msg ? (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'} compact>
          {status.msg}
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} loadingText="Saving…">
          Save
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}
