// src/components/ProductAdminForm.tsx
'use client'

import { useState } from 'react'
import { parsePriceToCents } from '@/lib/money'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

export default function ProductAdminForm() {
  const [form, setForm] = useState({
    category: 'kimono' as Category,
    name: '',
    color: '',
    size: '',
    price: '',           // ← prix “normal” saisi par l’admin (ex: "450.00")
    inventory_qty: '',   // on stocke temporairement en string dans le form
    is_active: true,
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function update<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')

    try {
      const price_cents = parsePriceToCents(form.price)
      const payload = {
        category: form.category,
        name: form.name.trim(),
        color: form.color.trim() || null,
        size: form.size.trim() || null,
        price_cents, // ← on envoie en cents à l’API
        inventory_qty: Number(form.inventory_qty || 0),
        is_active: !!form.is_active,
      }

      const r = await fetch('/api/store/products/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Create failed')
        return
      }

      setMsg('Product created.')
      setForm({
        category: 'kimono',
        name: '',
        color: '',
        size: '',
        price: '',
        inventory_qty: '',
        is_active: true,
      })
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Add product</h2>
      <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm">Category</span>
          <select
            value={form.category}
            onChange={(e) => update('category', e.target.value as Category)}
            className="px-3 py-2 border rounded"
          >
            <option value="kimono">Kimono</option>
            <option value="rashguard">Rashguard</option>
            <option value="short">Short</option>
            <option value="belt">Belt</option>
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Name</span>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="px-3 py-2 border rounded"
            required
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Color</span>
          <input
            value={form.color}
            onChange={(e) => update('color', e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Size</span>
          <input
            value={form.size}
            onChange={(e) => update('size', e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Price (EGP)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.price}
            onChange={(e) => update('price', e.target.value)}
            className="px-3 py-2 border rounded"
            required
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Inventory qty</span>
          <input
            type="number"
            min={0}
            value={form.inventory_qty}
            onChange={(e) => update('inventory_qty', e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => update('is_active', e.target.checked)}
          />
          <span className="text-sm">Active</span>
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy || !form.name.trim() || !form.price.trim()}
            className="px-3 py-2 rounded border bg-black text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {msg && <span className="text-xs text-gray-600 ml-2">{msg}</span>}
        </div>
      </form>
    </section>
  )
}
