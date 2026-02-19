// src/components/store/AdminProductQuickEdit.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

type Props = {
  id: string
  inventoryQty: number
  isActive: boolean
}

export default function AdminProductQuickEdit({ id, inventoryQty, isActive }: Props) {
  const router = useRouter()
  const [qty, setQty] = useState<number>(Number.isFinite(inventoryQty) ? inventoryQty : 0)
  const [active, setActive] = useState<boolean>(!!isActive)
  const [loading, setLoading] = useState(false)

  const dirty = useMemo(() => qty !== inventoryQty || active !== isActive, [qty, inventoryQty, active, isActive])

  async function save() {
    if (!dirty || loading) return
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('Inventory must be a non-negative number')
      return
    }

    setLoading(true)
    try {
      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, inventory_qty: Math.floor(qty), is_active: active }),
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

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[hsl(var(--muted))]">Inventory</label>
        <input
          type="number"
          min={0}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          className="rounded-xl border px-3 py-2 text-sm bg-white w-[120px]"
        />
      </div>

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
  )
}
