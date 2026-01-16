// src/components/StoreProductForm.tsx
'use client'

import { useEffect, useState } from 'react'
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
}

const CATEGORIES: Category[] = ['kimono', 'rashguard', 'short', 'belt']

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

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  useEffect(() => {
    if (product) {
      setCategory(product.category ?? 'kimono')
      setName(product.name ?? '')
      setColor(product.color ?? '')
      setSize(product.size ?? '')
      setPrice(toPriceString(product.price_cents ?? 0))
      setCurrency(product.currency ?? 'EGP')
      setInventory(Number(product.inventory_qty ?? 0))
      setActive(!!product.is_active || product.is_active === undefined)
    }
  }, [product?.id])

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

      if (product?.id) {
        payload.id = product.id
        url = '/api/store/products/update'
        method = 'PATCH'
      }

      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Save failed' })
        toast.error('Save failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Saved' })
      toast.success('Saved')
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

      {status.msg && (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>
          {status.msg}
        </InlineAlert>
      )}

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
