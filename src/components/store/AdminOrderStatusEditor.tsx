// src/components/store/AdminOrderStatusEditor.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { OrderStatus } from '@/lib/order'
import { ORDER_STATUSES, humanStatus, normalizeStatus } from '@/lib/order'
import Button from '@/components/ui/Button'

type Props = {
  orderId: string
  currentStatus: OrderStatus
  currentNote?: string | null
}

export default function AdminOrderStatusEditor({ orderId, currentStatus, currentNote }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<OrderStatus>(currentStatus)
  const [note, setNote] = useState<string>(currentNote || '')
  const [loading, setLoading] = useState(false)

  const dirty = useMemo(() => status !== currentStatus || (note || '') !== (currentNote || ''), [status, currentStatus, note, currentNote])

  async function save() {
    if (loading) return
    setLoading(true)
    try {
      const r = await fetch('/api/store/orders/update-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, status, note }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))

      if (!r.ok || !j?.ok) {
        const m = j?.details || j?.error || 'Update failed'
        toast.error(m)
        return
      }

      toast.success('Order updated')
      // Refresh server components (re-fetch orders list)
      router.refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[hsl(var(--muted))]">Status</label>
        <select
          value={status}
          onChange={(e) => {
            const v = normalizeStatus(e.target.value) || currentStatus
            setStatus(v)
          }}
          className="rounded-xl border px-3 py-2 text-sm bg-white"
        >
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanStatus(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[hsl(var(--muted))]">Note</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm bg-white min-w-[220px]"
          placeholder="Optional note…"
        />
      </div>

      <Button onClick={save} disabled={!dirty || loading} className="h-[40px]">
        {loading ? 'Saving…' : 'Update'}
      </Button>
    </div>
  )
}
