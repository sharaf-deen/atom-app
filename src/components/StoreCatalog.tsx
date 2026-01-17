// src/components/StoreCatalog.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
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
const PER_PAGE = 8

type StatusKind = '' | 'info' | 'success' | 'error'

export default function StoreCatalog({
  showAdd = true,
  canManage = false,
}: {
  showAdd?: boolean
  canManage?: boolean
}) {
  const [items, setItems] = useState<Product[]>([])
  const [status, setStatus] = useState<{ kind: StatusKind; msg: string }>({ kind: '', msg: '' })

  // Edition
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<Product>>({})
  const [editPrice, setEditPrice] = useState<string>('')
  const [busy, setBusy] = useState(false) // mutations
  const [loading, setLoading] = useState(false) // list fetch

  // Filtres
  const [cat, setCat] = useState<'all' | Category>('all')
  const [active, setActive] = useState<'all' | '1' | '0'>('all')
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total])

  const clearTimer = useRef<number | null>(null)
  function flash(kind: StatusKind, msg: string, autoMs = 2500) {
    if (clearTimer.current) window.clearTimeout(clearTimer.current)
    setStatus({ kind, msg })
    if (autoMs > 0 && kind !== 'error') {
      clearTimer.current = window.setTimeout(() => {
        setStatus((s) => (s.msg === msg ? { kind: '', msg: '' } : s))
      }, autoMs)
    }
  }

  async function load(p = page) {
    setLoading(true)
    setStatus((s) => (s.kind === 'error' ? { kind: '', msg: '' } : s))

    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', String(PER_PAGE))

      if (canManage) params.set('all', '1')
      if (cat !== 'all') params.set('category', cat)
      if (canManage && active !== 'all') params.set('active', active)
      if (qApplied.trim()) params.set('q', qApplied.trim())

      const r = await fetch(`/api/store/products/list?${params.toString()}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.error || j?.details || 'Failed to load products'
        setItems([])
        setTotal(0)
        setPage(1)
        setStatus({ kind: 'error', msg })
        return
      }

      const itemsRaw: Product[] = Array.isArray(j.items) ? j.items : []
      const totalFromApi = Number.isFinite(Number(j?.total)) ? Number(j.total) : 0
      const nextPage = Number.isFinite(Number(j?.page)) ? Number(j.page) : p

      setItems(itemsRaw)
      setTotal(totalFromApi)
      setPage(nextPage)
    } catch (e: any) {
      const msg = String(e?.message || e)
      setItems([])
      setTotal(0)
      setPage(1)
      setStatus({ kind: 'error', msg })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, cat, active, qApplied])

  function applySearch() {
    const next = q.trim()
    setPage(1)
    setQApplied(next)
  }
  function clearFilters() {
    setCat('all')
    setActive('all')
    setQ('')
    setQApplied('')
    setPage(1)
  }

  function addToCart(p: Product) {
    const qty = Number(p.inventory_qty ?? 0)
    if (qty <= 0) {
      toast.error('Out of stock')
      return
    }
    const ev = new CustomEvent('cart:add', { detail: { product_id: p.id, qty: 1, product: p } })
    window.dispatchEvent(ev)
    toast.success('Added to cart')
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
    setEditPrice(toPriceString(p.price_cents))
    setStatus({ kind: '', msg: '' })
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
    setStatus({ kind: '', msg: '' })
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
        const msg = j?.details || j?.error || 'Update failed'
        setStatus({ kind: 'error', msg })
        toast.error('Update failed')
        return
      }

      flash('success', 'Product updated.')
      toast.success('Product updated')
      setEditingId(null)
      setEditPrice('')
      await load(page)
    } catch (e: any) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'error', msg })
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this product? This cannot be undone.')) return
    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const r = await fetch(`/api/store/products/delete?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.hint || j?.details || j?.error || 'Delete failed'
        setStatus({ kind: 'error', msg })
        toast.error('Delete failed')
        return
      }

      flash('success', 'Product deleted.')
      toast.success('Product deleted')

      // Si on supprime le dernier item de la page, recule d'une page
      const isLastOnPage = items.length === 1 && page > 1
      await load(isLastOnPage ? page - 1 : page)
    } catch (e: any) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'error', msg })
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(id: string, nextActive: boolean) {
    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: nextActive }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Toggle failed'
        setStatus({ kind: 'error', msg })
        toast.error('Toggle failed')
        return
      }

      flash('success', nextActive ? 'Product activated.' : 'Product deactivated.')
      toast.success(nextActive ? 'Activated' : 'Deactivated')
      await load(page)
    } catch (e: any) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'error', msg })
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const rangeEnd = Math.min(page * PER_PAGE, total)
  const canPrev = page > 1
  const canNext = page < totalPages
  const anyWorking = busy || loading

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <h2 className="text-base font-semibold">Catalog</h2>

        <div className="sm:ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => load(page)} disabled={anyWorking}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={clearFilters} disabled={anyWorking}>
            Clear filters
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-2 sm:grid-cols-[220px_220px_1fr_auto] items-end">
        <Select value={cat} onChange={(e) => setCat(e.target.value as any)} aria-label="Category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace('_', ' ')}
            </option>
          ))}
        </Select>

        {canManage ? (
          <Select value={active} onChange={(e) => setActive(e.target.value as any)} aria-label="Active filter">
            <option value="all">All (active + inactive)</option>
            <option value="1">Only active</option>
            <option value="0">Only inactive</option>
          </Select>
        ) : (
          <div />
        )}

        <div className="sm:col-span-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, color, size…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applySearch()
              }
            }}
            disabled={anyWorking}
          />
        </div>

        <Button variant="outline" onClick={applySearch} disabled={anyWorking}>
          Search
        </Button>
      </div>

      {/* Status */}
      {(status.msg || loading) && (
        <div className="text-sm">
          {loading && !status.msg ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-[hsl(var(--muted))]">
              Loading products…
            </div>
          ) : null}

          {status.msg ? (
            <div
              className={`rounded-2xl border px-3 py-2 ${
                status.kind === 'error'
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : status.kind === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted))]'
              }`}
            >
              {status.msg}
            </div>
          ) : null}
        </div>
      )}

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
        <span>
          Showing <strong>{rangeStart}</strong>–<strong>{rangeEnd}</strong> of <strong>{total}</strong>
        </span>
        {qApplied ? (
          <span className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1">
            Search: <strong>{qApplied}</strong>
          </span>
        ) : null}
      </div>

      {/* Grid produits */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => {
          const isEditing = editingId === p.id
          const currency = p.currency ?? 'EGP'
          const stock = Number(p.inventory_qty ?? 0)
          const out = stock <= 0

          return (
            <Card key={p.id} hover>
              <CardContent>
                {!isEditing ? (
                  <>
                    <div className="text-xs text-[hsl(var(--muted))] uppercase flex items-center gap-2">
                      {p.category.replace('_', ' ')}
                      {!p.is_active && <Badge>inactive</Badge>}
                      {out && <Badge>out</Badge>}
                    </div>
                    <div className="mt-1 font-medium">{p.name}</div>
                    <div className="text-sm text-[hsl(var(--muted))]">
                      {p.color || p.size ? [p.color, p.size].filter(Boolean).join(' · ') : '—'}
                    </div>
                    <div className="mt-2 text-lg font-semibold">{formatCurrency(p.price_cents, 'en-EG', currency)}</div>
                    <div className="text-xs text-[hsl(var(--muted))] mt-1">Stock: {stock}</div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {showAdd && (
                        <Button variant="outline" onClick={() => addToCart(p)} disabled={anyWorking || out}>
                          {out ? 'Out of stock' : 'Add to cart'}
                        </Button>
                      )}

                      {canManage && (
                        <>
                          <Button variant="outline" onClick={() => startEdit(p)} disabled={anyWorking}>
                            Edit
                          </Button>
                          <Button variant="outline" onClick={() => toggleActive(p.id, !p.is_active)} disabled={anyWorking}>
                            {p.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="outline"
                            className="border border-red-400 text-red-600 hover:bg-red-50"
                            onClick={() => deleteItem(p.id)}
                            disabled={anyWorking}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Edit product</div>

                    <Select
                      label="Category"
                      value={(edit.category || 'kimono') as any}
                      onChange={(e) => update('category', e.target.value as Category)}
                      disabled={busy}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>

                    <Input label="Name" value={edit.name || ''} onChange={(e) => update('name', e.target.value)} disabled={busy} />

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Color"
                        value={typeof edit.color === 'string' ? edit.color : ''}
                        onChange={(e) => update('color', e.target.value)}
                        disabled={busy}
                      />
                      <Input
                        label="Size"
                        value={typeof edit.size === 'string' ? edit.size : ''}
                        onChange={(e) => update('size', e.target.value)}
                        disabled={busy}
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
                        disabled={busy}
                      />
                      <Input
                        label="Inventory qty"
                        type="number"
                        min={0}
                        value={Number(edit.inventory_qty ?? 0)}
                        onChange={(e) => update('inventory_qty', Number(e.target.value || 0))}
                        disabled={busy}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!edit.is_active}
                        onChange={(e) => update('is_active', e.target.checked)}
                        disabled={busy}
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

      {items.length === 0 && !loading && (
        <div className="text-sm text-[hsl(var(--muted))]">No products found with current filters.</div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" onClick={() => load(Math.max(1, page - 1))} disabled={!canPrev || anyWorking}>
          Prev
        </Button>
        <div className="text-xs text-[hsl(var(--muted))]">
          Page <strong>{page}</strong> / {totalPages}
        </div>
        <Button variant="outline" onClick={() => load(Math.min(totalPages, page + 1))} disabled={!canNext || anyWorking}>
          Next
        </Button>
      </div>
    </div>
  )
}
