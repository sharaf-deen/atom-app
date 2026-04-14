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
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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
  const [imageFile, setImageFile] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  const imagePreviewUrl = useMemo(() => {
    if (!imageFile) return ''
    return URL.createObjectURL(imageFile)
  }, [imageFile])

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
    return 'Hard enforcement: every Store variant must now be linked to a Store V3 model before it can be saved.'
  }, [selectedModel])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

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
    setImageFile(null)
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', msg: '' })

    try {
      const price_cents = parsePriceToCents(price)
      const imageError = !product?.id ? validateImage(imageFile) : null
      if (imageError) {
        setStatus({ kind: 'error', msg: imageError })
        toast.error(imageError)
        return
      }
      if (!category.trim()) {
        setStatus({ kind: 'error', msg: 'Category is required.' })
        toast.error('Category is required')
        return
      }
      if (!modelId.trim()) {
        setStatus({ kind: 'error', msg: 'Linked model is required under Store V3 hard enforcement.' })
        toast.error('Linked model is required')
        return
      }

      let url = '/api/store/products/create'
      let method: 'POST' | 'PATCH' = 'POST'
      let body: BodyInit
      let headers: HeadersInit | undefined

      if (product?.id) {
        method = 'PATCH'
        url = '/api/store/products/update'
        body = JSON.stringify({
          id: product.id,
          category: category.trim(),
          model_id: modelId || null,
          name: name.trim(),
          color: color.trim() || null,
          size: size.trim() || null,
          price_cents,
          currency: currency || null,
          inventory_qty: Number(inventory ?? 0),
          is_active: !!active,
        })
        headers = { 'Content-Type': 'application/json' }
      } else {
        const fd = new FormData()
        fd.set('category', category.trim())
        fd.set('model_id', modelId || '')
        fd.set('name', name.trim())
        fd.set('color', color.trim())
        fd.set('size', size.trim())
        fd.set('price_cents', String(price_cents))
        fd.set('currency', currency || 'EGP')
        fd.set('inventory_qty', String(Number(inventory ?? 0)))
        fd.set('is_active', String(!!active))
        if (imageFile) fd.set('image', imageFile)
        body = fd
      }

      const r = await fetch(url, {
        method,
        headers,
        body,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Save failed' })
        toast.error(j?.details || j?.error || 'Save failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Saved' })
      toast.success('Saved')
      setImageFile(null)
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
              <div>Future Store V3 flow will use this parent model for model → color → size browsing.</div>
            </div>
          ) : (
            <div className="space-y-1">
              <div>No parent model linked yet.</div>
              <div>
                Hard enforcement is now active. Create or select the parent model in{' '}
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

      {!product?.id ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                setImageFile(file)
              }}
            />
            <span className="text-xs text-[hsl(var(--muted))]">Optional · JPG, PNG or WEBP · max 5 MB</span>
          </label>

          {imagePreviewUrl ? (
            <div className="overflow-hidden rounded-2xl border bg-white p-2">
              <img src={imagePreviewUrl} alt="Selected product" className="h-40 w-full rounded-xl object-cover" />
            </div>
          ) : null}
        </div>
      ) : null}

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
