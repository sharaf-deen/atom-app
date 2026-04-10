'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { parsePriceToCents, toPriceString } from '@/lib/money'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'

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
  const [category, setCategory] = useState<Category>(product?.category ?? 'kimono')
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

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

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
  }, [product])

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

      let url = '/api/store/products/create'
      let method: 'POST' | 'PATCH' = 'POST'
      let body: BodyInit
      let headers: HeadersInit | undefined

      if (product?.id) {
        method = 'PATCH'
        url = '/api/store/products/update'
        body = JSON.stringify({
          id: product.id,
          category,
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
        fd.set('category', category)
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
        toast.error('Save failed')
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
