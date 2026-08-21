'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import StoreProductForm from '@/components/StoreProductForm'

type Props = {
  id: string
  category: string
  modelId?: string | null
  modelName?: string | null
  name: string
  color: string | null
  size: string | null
  priceCents: number
  currency: string | null
  inventoryQty: number
  isActive: boolean
  allowPreorder: boolean
  lowStockThreshold: number
  imagePath?: string | null
  imagePath2?: string | null
  imagePath3?: string | null
  onSaved?: () => void
  onDeleted?: () => void
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

function formatCategory(value: string | null | undefined) {
  const clean = String(value ?? '').trim()
  if (!clean) return '—'
  return clean
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatBool(value: boolean, yes: string, no: string) {
  return value ? yes : no
}

export default function AdminProductQuickEdit({
  id,
  category,
  modelId,
  modelName,
  name,
  color,
  size,
  priceCents,
  currency,
  inventoryQty,
  isActive,
  allowPreorder,
  lowStockThreshold,
  imagePath,
  imagePath2,
  imagePath3,
  onSaved,
  onDeleted,
}: Props) {
  const router = useRouter()
  const [qty, setQty] = useState<number>(Number.isFinite(inventoryQty) ? inventoryQty : 0)
  const [active, setActive] = useState<boolean>(!!isActive)
  const [preorder, setPreorder] = useState<boolean>(!!allowPreorder)
  const [threshold, setThreshold] = useState<number>(Number.isFinite(lowStockThreshold) ? lowStockThreshold : 0)
  const [loading, setLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const dirty = useMemo(
    () => qty !== inventoryQty || active !== isActive || preorder !== allowPreorder || threshold !== lowStockThreshold,
    [qty, inventoryQty, active, isActive, preorder, allowPreorder, threshold, lowStockThreshold]
  )

  const productLabel = name || modelName || 'Product'
  const categoryLabel = formatCategory(category)
  const modelLabel = modelName || '—'
  const detailsLabel = [color, size].map((value) => String(value ?? '').trim()).filter(Boolean).join(' · ') || '—'

  const saveSummaryItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    return [
      { label: 'Product', value: productLabel },
      { label: 'Category', value: categoryLabel },
      { label: 'Model', value: modelLabel },
      { label: 'Price', value: formatEGP(priceCents) },
      { label: 'Stock', value: `${inventoryQty} → ${Number.isFinite(qty) ? Math.floor(qty) : '—'}` },
      { label: 'Status', value: `${formatBool(isActive, 'Active', 'Inactive')} → ${formatBool(active, 'Active', 'Inactive')}` },
      { label: 'Preorder', value: `${formatBool(allowPreorder, 'Enabled', 'Disabled')} → ${formatBool(preorder, 'Enabled', 'Disabled')}` },
      { label: 'Low stock alert', value: `${lowStockThreshold} → ${Number.isFinite(threshold) ? Math.floor(threshold) : '—'}` },
      { label: 'Impact', value: 'Only this product variant will be updated.' },
    ]
  }, [active, allowPreorder, categoryLabel, inventoryQty, isActive, lowStockThreshold, modelLabel, preorder, priceCents, productLabel, qty, threshold])

  const deleteSummaryItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    return [
      { label: 'Product', value: productLabel },
      { label: 'Category', value: categoryLabel },
      { label: 'Model', value: modelLabel },
      { label: 'Variant details', value: detailsLabel },
      { label: 'Price', value: formatEGP(priceCents) },
      { label: 'Current stock', value: String(inventoryQty) },
      { label: 'Impact', value: 'The backend may block deletion if Store history is linked to this product.' },
    ]
  }, [categoryLabel, detailsLabel, inventoryQty, modelLabel, priceCents, productLabel])

  function validateQuickEdit() {
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('Inventory must be a non-negative number')
      return false
    }
    if (!Number.isFinite(threshold) || threshold < 0) {
      toast.error('Low stock threshold must be a non-negative number')
      return false
    }
    return true
  }

  function openSaveConfirmation() {
    if (!dirty || loading) return
    if (!validateQuickEdit()) return
    setConfirmSaveOpen(true)
  }

  async function save() {
    if (!dirty || loading) return
    if (!validateQuickEdit()) return

    setLoading(true)
    try {
      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          inventory_qty: Math.floor(qty),
          is_active: active,
          allow_preorder: preorder,
          low_stock_threshold: Math.floor(threshold),
        }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))

      if (!r.ok || !j?.ok) {
        toast.error(j?.details || j?.error || 'Update failed')
        return
      }

      toast.success('Product updated')
      setConfirmSaveOpen(false)
      onSaved?.()
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  async function removeProduct() {
    if (deleteBusy) return

    setDeleteBusy(true)
    try {
      const r = await fetch(`/api/store/products/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        toast.error(j?.details || j?.error || 'Delete failed')
        return
      }
      toast.success('Product deleted')
      setConfirmDeleteOpen(false)
      onDeleted?.()
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-[hsl(var(--surface-2))] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Category</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-black">{categoryLabel}</div>
        </div>
        <div className="rounded-2xl bg-[hsl(var(--surface-2))] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Model</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-black">{modelLabel}</div>
        </div>
        <div className="rounded-2xl bg-[hsl(var(--surface-2))] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Price</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-black">{formatEGP(priceCents)}</div>
        </div>
        <div className="rounded-2xl bg-[hsl(var(--surface-2))] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Variant</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-black">{detailsLabel}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-black">Stock</span>
          <input
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value || 0))}
            className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
          />
        </label>

        <label className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm font-semibold text-black shadow-soft select-none">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          Active in catalog
        </label>
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white">
        <button
          type="button"
          onClick={() => setOptionalOpen((value) => !value)}
          className="flex min-h-[44px] w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-semibold text-black"
        >
          <span>Optional edit details</span>
          <span className="text-xs text-[hsl(var(--muted))]">{optionalOpen ? 'Hide' : 'Show'}</span>
        </button>

        {optionalOpen ? (
          <div className="space-y-3 border-t border-[hsl(var(--border))] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-black">Low stock threshold</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value || 0))}
                  className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
                />
              </label>

              <label className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm font-semibold text-black shadow-soft select-none sm:mt-[26px]">
                <input
                  type="checkbox"
                  checked={preorder}
                  onChange={(e) => setPreorder(e.target.checked)}
                  className="h-4 w-4"
                />
                Preorder enabled
              </label>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Name, model, category, price and photos stay in the detailed editor to preserve the existing Store V3 flow.
            </div>

            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              Edit name, price & photos
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={openSaveConfirmation} disabled={!dirty || loading} className="min-h-[44px] flex-1 sm:flex-none">
          {loading ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => setConfirmDeleteOpen(true)}
          loading={deleteBusy}
          loadingText="Deleting…"
          disabled={deleteBusy}
        >
          Delete product
        </Button>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit product details"
        className="w-[min(96vw,42rem)]"
      >
        <StoreProductForm
          product={{
            id,
            category,
            model_id: modelId ?? null,
            model_name: modelName ?? null,
            name,
            color,
            size,
            price_cents: priceCents,
            currency,
            inventory_qty: inventoryQty,
            is_active: isActive,
            image_path: imagePath ?? null,
            image_path_2: imagePath2 ?? null,
            image_path_3: imagePath3 ?? null,
          }}
          onSaved={() => {
            setEditOpen(false)
            onSaved?.()
            router.refresh()
            setTimeout(() => router.refresh(), 250)
          }}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>

      <ConfirmActionModal
        open={confirmSaveOpen}
        title="Confirm product update"
        description="Review the product changes before saving."
        confirmLabel="Confirm & save"
        pendingLabel="Saving…"
        pending={loading}
        summaryItems={saveSummaryItems}
        warning="This updates only the selected Store product variant. Existing sales, preorders and supplier orders are not changed."
        onCancel={() => (loading ? null : setConfirmSaveOpen(false))}
        onConfirm={save}
      />

      <ConfirmActionModal
        open={confirmDeleteOpen}
        title="Delete product?"
        description="Review this product before deleting."
        confirmLabel="Confirm delete"
        pendingLabel="Deleting…"
        pending={deleteBusy}
        tone="destructive"
        summaryItems={deleteSummaryItems}
        warning="This is a destructive action. Existing Store history linked to this product may block deletion."
        onCancel={() => (deleteBusy ? null : setConfirmDeleteOpen(false))}
        onConfirm={removeProduct}
      />
    </div>
  )
}
