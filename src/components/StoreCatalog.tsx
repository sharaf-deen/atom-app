// src/components/StoreCatalog.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatCurrency, toPriceString, parsePriceToCents } from '@/lib/money'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Badge from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type Product = {
  id: string
  category: Category
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency?: string | null
  inventory_qty?: number
  is_active: boolean
}

const CATEGORIES: Category[] = ['kimono', 'rashguard', 'short', 'belt']
const PER_PAGE = 4

export default function StoreCatalog({
  showAdd = true,
  canManage = false,
}: {
  showAdd?: boolean
  canManage?: boolean
}) {
  const [items, setItems] = useState<Product[]>([])
  const [err, setErr] = useState<string>('')
  const [info, setInfo] = useState<string>('')

  // Edition
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<Product>>({})
  const [editPrice, setEditPrice] = useState<string>('')
  const [busy, setBusy] = useState(false)

  // Filtres
  const [cat, setCat] = useState<'all' | Category>('all')
  const [active, setActive] = useState<'all' | '1' | '0'>('all')

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total])

  async function load(p = page) {
    setErr('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', String(PER_PAGE))
      if (canManage) params.set('all', '1')
      if (cat !== 'all') params.set('category', cat)
      if (canManage && active !== 'all') params.set('active', active)

      const r = await fetch(`/api/store/products/list?${params.toString()}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.error || j?.details || 'Failed to load products')
        setItems([])
        setTotal(0)
        return
      }

      const itemsRaw: Product[] = Array.isArray(j.items) ? j.items : []
      const totalFromApi = Number.isFinite(Number(j?.total)) ? Number(j.total) : null

      if (totalFromApi !== null) {
        setItems(itemsRaw)
        setTotal(totalFromApi)
        setPage(Number(j.page || p))
      } else {
        const computedTotal = itemsRaw.length
        const start = (p - 1) * PER_PAGE
        const pageItems = itemsRaw.slice(start, start + PER_PAGE)
        setItems(pageItems)
        setTotal(computedTotal)
        setPage(p)
      }
    } catch (e: any) {
      setErr(String(e?.message || e))
      setItems([])
      setTotal(0)
    }
  }

  useEffect(() => {
    setPage(1)
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, cat, active])

  function addToCart(p: Product) {
    const ev = new CustomEvent('cart:add', { detail: { product_id: p.id, qty: 1, product: p } })
    window.dispatchEvent(ev)
  }

  // ---- Edit helpers ----
  function startEdit(p: Product) {
    setEditingId(p.id)
    setEdit({
      id: p.id,
      category: p.category,
      name: p.name,
      color: p.color ?? '',
      size: p.size ?? '',
      price_cents: p.price_cents,
      inventory_qty: p.inventory_qty ?? 0,
      is_active: p.is_active,
      currency: p.currency ?? 'EGP',
    } as Partial<Product>)
    setEditPrice(toPriceString(p.price_cents)) // ex: "450.00"
    setInfo('')
    setErr('')
  }
  function cancelEdit() {
    setEditingId(null)
    setEdit({})
    setEditPrice('')
  }
  function update<K extends keyof Product>(k: K, v: any) {
    setEdit((e) => ({ ...e, [k]: v }))
  }

  async function saveEdit() {
    if (!editingId) return
    setBusy(true)
    setErr('')
    setInfo('')
    try {
      const payload: any = {
        id: editingId,
        category: edit.category,
        name: (edit.name || '').toString(),
        color: typeof edit.color === 'string' ? edit.color : null,
        size: typeof edit.size === 'string' ? edit.size : null,
        price_cents: parsePriceToCents(editPrice),
        inventory_qty: Number(edit.inventory_qty ?? 0),
        is_active: !!edit.is_active,
      }
      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Update failed')
        return
      }
      setInfo('Product updated.')
      setEditingId(null)
      setEditPrice('')
      await load(page) // rester sur la page courante
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this product? This cannot be undone.')) return
    setBusy(true)
    setErr('')
    setInfo('')
    try {
      const r = await fetch(`/api/store/products/delete?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.hint || j?.details || j?.error || 'Delete failed')
        return
      }
      setInfo('Product deleted.')
      await load(page)
      if (items.length === 1 && page > 1) {
        await load(page - 1)
      }
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(id: string, nextActive: boolean) {
    setBusy(true)
    setErr('')
    setInfo('')
    try {
      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: nextActive }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Toggle failed')
        return
      }
      setInfo(nextActive ? 'Product activated.' : 'Product deactivated.')
      await load(page)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header & filtres */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <h2 className="text-base font-semibold">Catalog</h2>

        <div className="flex flex-wrap items-center gap-2 sm:ml-4">
          <Select
            value={cat}
            onChange={(e) => setCat(e.target.value as any)}
            aria-label="Category"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </Select>

          {canManage && (
            <Select
              value={active}
              onChange={(e) => setActive(e.target.value as any)}
              aria-label="Active filter"
            >
              <option value="all">All (active + inactive)</option>
              <option value="1">Only active</option>
              <option value="0">Only inactive</option>
            </Select>
          )}
        </div>

        <div className="sm:ml-auto">
          <Button variant="outline" onClick={() => load(page)}>
            Refresh
          </Button>
        </div>
      </div>

      {(err || info) && (
        <div className="text-sm">
          {err && (
            <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-red-700">
              {err}
            </div>
          )}
          {info && (
            <div className="mt-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-[hsl(var(--muted))]">
              {info}
            </div>
          )}
        </div>
      )}

      {/* Grid produits */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => {
          const isEditing = editingId === p.id
          const currency = p.currency ?? 'EGP'
          return (
            <Card key={p.id} hover>
              <CardContent>
                {!isEditing ? (
                  <>
                    <div className="text-xs text-[hsl(var(--muted))] uppercase flex items-center gap-2">
                      {p.category.replace('_', ' ')}
                      {!p.is_active && <Badge>inactive</Badge>}
                    </div>
                    <div className="mt-1 font-medium">{p.name}</div>
                    <div className="text-sm text-[hsl(var(--muted))]">
                      {p.color || p.size ? [p.color, p.size].filter(Boolean).join(' · ') : '—'}
                    </div>
                    <div className="mt-2 text-lg font-semibold">
                      {formatCurrency(p.price_cents, 'en-EG', currency)}
                    </div>
                    <div className="text-xs text-[hsl(var(--muted))] mt-1">Stock: {p.inventory_qty ?? 0}</div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {showAdd && (
                        <Button variant="outline" onClick={() => addToCart(p)}>
                          Add to cart
                        </Button>
                      )}
                      {canManage && (
                        <>
                          <Button variant="outline" onClick={() => startEdit(p)}>
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => toggleActive(p.id, !p.is_active)}
                          >
                            {p.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="outline"
                            className="text-red-600"
                            onClick={() => deleteItem(p.id)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  // ---- Editing form ----
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Edit product</div>

                    <Select
                      label="Category"
                      value={edit.category || 'kimono'}
                      onChange={(e) => update('category', e.target.value as Category)}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>

                    <Input
                      label="Name"
                      value={edit.name || ''}
                      onChange={(e) => update('name', e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Color"
                        value={typeof edit.color === 'string' ? edit.color : ''}
                        onChange={(e) => update('color', e.target.value)}
                      />
                      <Input
                        label="Size"
                        value={typeof edit.size === 'string' ? edit.size : ''}
                        onChange={(e) => update('size', e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Price (EGP)"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        placeholder="0.00"
                      />
                      <Input
                        label="Inventory qty"
                        type="number"
                        min={0}
                        value={Number(edit.inventory_qty ?? 0)}
                        onChange={(e) => update('inventory_qty', Number(e.target.value || 0))}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!edit.is_active}
                        onChange={(e) => update('is_active', e.target.checked)}
                      />
                      <span>Active</span>
                    </label>

                    <div className="flex items-center gap-2 pt-1">
                      <Button onClick={saveEdit} disabled={busy}>
                        {busy ? 'Saving…' : 'Save'}
                      </Button>
                      <Button variant="outline" onClick={cancelEdit} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {items.length === 0 && (
        <div className="text-sm text-[hsl(var(--muted))]">No products found with current filters.</div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          onClick={() => load(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Prev
        </Button>
        <div className="text-xs text-[hsl(var(--muted))]">
          Page <strong>{page}</strong> / {totalPages} · Total {total}
        </div>
        <Button
          variant="outline"
          onClick={() => load(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
