// src/components/StoreProductForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { parsePriceToCents, toPriceString } from '@/lib/money'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import { STORE_PRODUCT_IMAGE_MAX_BYTES } from '@/lib/storeProductImages'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

type Product = {
  id?: string
  category?: Category
  name: string
  color?: string | null
  size?: string | null
  price_cents: number
  currency?: string | null
  inventory_qty?: number
  is_active?: boolean
  image_path?: string | null
}

const CATEGORIES: Category[] = ['kimono', 'rashguard', 'short', 'belt']

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const [category, setCategory] = useState<Category>(product?.category ?? 'kimono')
  const [name, setName] = useState(product?.name ?? '')
  const [color, setColor] = useState(product?.color ?? '')
  const [size, setSize] = useState(product?.size ?? '')
  const [price, setPrice] = useState<string>(toPriceString(product?.price_cents ?? 0))
  const [currency, setCurrency] = useState(product?.currency ?? 'EGP')
  const [inventory, setInventory] = useState<number>(Number(product?.inventory_qty ?? 0))
  const [active, setActive] = useState<boolean>(product?.is_active ?? true)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [removeImage, setRemoveImage] = useState(false)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  useEffect(() => {
    if (!product) return
    setCategory(product.category ?? 'kimono')
    setName(product.name ?? '')
    setColor(product.color ?? '')
    setSize(product.size ?? '')
    setPrice(toPriceString(product.price_cents ?? 0))
    setCurrency(product.currency ?? 'EGP')
    setInventory(Number(product.inventory_qty ?? 0))
    setActive(product.is_active === undefined ? true : !!product.is_active)
    setImageFile(null)
    setRemoveImage(false)
  }, [product])

  const previewUrl = useMemo(() => {
    if (!imageFile) return null
    return URL.createObjectURL(imageFile)
  }, [imageFile])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      if (imageFile && imageFile.size > STORE_PRODUCT_IMAGE_MAX_BYTES) {
        setStatus({ kind: 'error', msg: `Image is too large (max ${formatBytes(STORE_PRODUCT_IMAGE_MAX_BYTES)}).` })
        toast.error('Image is too large')
        return
      }

      const price_cents = parsePriceToCents(price)
      const form = new FormData()
      form.set('category', category)
      form.set('name', name.trim())
      form.set('color', color.trim())
      form.set('size', size.trim())
      form.set('price_cents', String(price_cents))
      form.set('currency', currency || 'EGP')
      form.set('inventory_qty', String(Number(inventory ?? 0)))
      form.set('is_active', active ? 'true' : 'false')
      if (product?.id) form.set('id', product.id)
      if (imageFile) form.set('image', imageFile)
      if (removeImage) form.set('remove_image', 'true')

      let url = '/api/store/products/create'
      let method: 'POST' | 'PATCH' = 'POST'

      if (product?.id) {
        url = '/api/store/products/update'
        method = 'PATCH'
      }

      const r = await fetch(url, {
        method,
        body: form,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Save failed' })
        toast.error('Save failed')
        return
      }

      setStatus({ kind: 'success', msg: product?.id ? 'Product updated' : 'Product created' })
      toast.success(product?.id ? 'Product updated' : 'Product created')
      setImageFile(null)
      setRemoveImage(false)
      if (!product?.id) {
        setCategory('kimono')
        setName('')
        setColor('')
        setSize('')
        setPrice(toPriceString(0))
        setCurrency('EGP')
        setInventory(0)
        setActive(true)
      }
      onSaved?.()
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Category *"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          disabled={busy}
          aria-label="Category"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace('_', ' ')}
            </option>
          ))}
        </Select>

        <Input
          label="Name *"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label="Name"
        />
      </div>

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

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Product photo</div>
          <div className="text-xs text-[hsl(var(--muted))]">Optional. JPG, PNG, or WEBP up to {formatBytes(STORE_PRODUCT_IMAGE_MAX_BYTES)}.</div>
        </div>

        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={busy}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null
            setImageFile(next)
            if (next) setRemoveImage(false)
          }}
          className="block w-full text-sm"
        />

        {previewUrl ? (
          <div className="space-y-2">
            <img src={previewUrl} alt="Selected product preview" className="h-40 w-full rounded-xl border object-cover bg-[hsl(var(--bg))]" />
            <div className="text-xs text-[hsl(var(--muted))]">Selected: {imageFile?.name} {imageFile?.size ? `· ${formatBytes(imageFile.size)}` : ''}</div>
          </div>
        ) : null}

        {product?.id && product.image_path ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={removeImage}
              onChange={(e) => setRemoveImage(e.target.checked)}
              disabled={busy || !!imageFile}
            />
            <span>Remove current photo on save</span>
          </label>
        ) : null}
      </div>

      {status.msg && <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.msg}</InlineAlert>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : product?.id ? 'Update' : 'Create'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
