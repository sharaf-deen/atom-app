'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
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
}: Props) {
  const router = useRouter()
  const [qty, setQty] = useState<number>(Number.isFinite(inventoryQty) ? inventoryQty : 0)
  const [active, setActive] = useState<boolean>(!!isActive)
  const [preorder, setPreorder] = useState<boolean>(!!allowPreorder)
  const [threshold, setThreshold] = useState<number>(Number.isFinite(lowStockThreshold) ? lowStockThreshold : 0)
  const [loading, setLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const dirty = useMemo(
    () => qty !== inventoryQty || active !== isActive || preorder !== allowPreorder || threshold !== lowStockThreshold,
    [qty, inventoryQty, active, isActive, preorder, allowPreorder, threshold, lowStockThreshold]
  )

  async function save() {
    if (!dirty || loading) return
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('Inventory must be a non-negative number')
      return
    }
    if (!Number.isFinite(threshold) || threshold < 0) {
      toast.error('Low stock threshold must be a non-negative number')
      return
    }

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
    const ok = globalThis.confirm(
      'Delete this product? Existing store history linked to this product may block deletion.'
    )
    if (!ok) return

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
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[120px_140px_auto_auto_auto] xl:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[hsl(var(--muted))]">Stock</label>
          <input
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value || 0))}
            className="rounded-xl border px-3 py-2 text-sm bg-white"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[hsl(var(--muted))]">Low stock threshold</label>
          <input
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value || 0))}
            className="rounded-xl border px-3 py-2 text-sm bg-white"
          />
        </div>

        <label className="flex items-center gap-2 text-sm select-none pb-2">
          <input
            type="checkbox"
            checked={preorder}
            onChange={(e) => setPreorder(e.target.checked)}
            className="h-4 w-4"
          />
          Preorder enabled
        </label>

        <label className="flex items-center gap-2 text-sm select-none pb-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          Active
        </label>

        <Button onClick={save} disabled={!dirty || loading} className="h-[40px]">
          {loading ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
          Edit details
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={removeProduct}
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
        title="Edit product"
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
          }}
          onSaved={() => {
            setEditOpen(false)
            router.refresh()
            setTimeout(() => router.refresh(), 250)
          }}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>
    </div>
  )
}
