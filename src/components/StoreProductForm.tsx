// src/components/StoreProductForm.tsx
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
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024

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
  // UI price as decimal string (e.g. "450.00")
  const [price, setPrice] = useState<string>(toPriceString(product?.price_cents ?? 0))
  const [currency, setCurrency] = useState(product?.currency ?? 'EGP')
  const [inventory, setInventory] = useState<number>(Number(product?.inventory_qty ?? 0))
  const [active, setActive] = useState<boolean>(product?.is_active ?? true)
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  const previewUrl = useMemo(() => {
    if (!photoFile) return ''
    return URL.createObjectURL(photoFile)
  }, [photoFile])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Keep form state in sync when switching products
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
    setPhotoFile(null)
  }, [product])

  function onPhotoChange(file: File | null) {
    if (!file) {
      setPhotoFile(null)
      return
    }

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      setStatus({ kind: 'error', msg: 'Photo must be JPG, PNG or WEBP.' })
      toast.error('Invalid photo format')
      return
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setStatus({ kind: 'error', msg: 'Photo is too large. Maximum size is 5MB.' })
      toast.error('Photo too large')
      return
    }

    setStatus((current) => (current.kind === 'error' && current.msg ? { kind: '', msg: '' } : current))
    setPhotoFile(file)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const price_cents = parsePriceToCents(price)

      const payload: any = {
        category,
        name: name.trim(),
        color: color.trim() || null,
        size: size.trim() || null,
        price_cents,
        currency: currency || null,
        inventory_qty: Number(inventory ?? 0),
        is_active: !!active,
      }

      let url = '/api/store/products/create'
      let method: 'POST' | 'PATCH' = 'POST'
      let body: BodyInit
      let headers: HeadersInit | undefined

      if (product?.id) {
        payload.id = product.id
        url = '/api/store/products/update'
        method = 'PATCH'
        headers = { 'Content-Type': 'application/json' }
        body = JSON.stringify(payload)
      } else {
        const formData = new FormData()
        formData.set('category', payload.category)
        formData.set('name', payload.name)
        formData.set('color', payload.color ?? '')
        formData.set('size', payload.size ?? '')
        formData.set('price_cents', String(payload.price_cents))
        formData.set('currency', payload.currency ?? 'EGP')
        formData.set('inventory_qty', String(payload.inventory_qty ?? 0))
        formData.set('is_active', payload.is_active ? '1' : '0')
        if (photoFile) formData.set('photo', photoFile)
        body = formData
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
      if (!product?.id) setPhotoFile(null)
      onSaved?.()
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Save failed')
    } finally {
      setBusy(false)
    }
  }

  const showPhotoField = !product?.id

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

      {showPhotoField ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-start">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[hsl(var(--fg))]">Photo</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
              className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            />
            <div className="text-xs text-[hsl(var(--muted))]">Optional. JPG, PNG or WEBP. Maximum 5MB.</div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            {previewUrl ? (
              <img src={previewUrl} alt="Product preview" className="h-32 w-full object-cover" />
            ) : (
              <div className="flex h-32 items-center justify-center px-3 text-center text-xs text-[hsl(var(--muted))]">
                No photo selected
              </div>
            )}
          </div>
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
