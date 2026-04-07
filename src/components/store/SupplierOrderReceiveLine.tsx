'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'

export default function SupplierOrderReceiveLine({
  itemId,
  orderedQty,
  receivedQty,
  lineStatus,
}: {
  itemId: string
  orderedQty: number
  receivedQty: number
  lineStatus: string
}) {
  const router = useRouter()
  const [nextReceivedQty, setNextReceivedQty] = useState<number>(Math.max(0, Number(receivedQty || 0)))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  const maxQty = Math.max(0, Number(orderedQty || 0))
  const currentQty = Math.max(0, Number(receivedQty || 0))
  const dirty = useMemo(() => nextReceivedQty !== currentQty, [nextReceivedQty, currentQty])
  const disabled = lineStatus === 'received' || lineStatus === 'canceled'

  async function save(targetQty: number) {
    if (busy || disabled) return
    if (!Number.isFinite(targetQty) || targetQty < currentQty || targetQty > maxQty) {
      setFeedback({ kind: 'error', msg: `Received total must stay between ${currentQty} and ${maxQty}.` })
      toast.error('Invalid received quantity')
      return
    }

    setBusy(true)
    setFeedback({ kind: '', msg: '' })

    try {
      const response = await fetch('/api/store/supplier-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, received_qty: targetQty }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        const message = json?.details || json?.error || 'Receive update failed'
        setFeedback({ kind: 'error', msg: message })
        toast.error('Receive update failed')
        return
      }

      setFeedback({ kind: 'success', msg: 'Received quantity applied.' })
      toast.success('Received quantity applied')
      setNextReceivedQty(Math.max(0, Number(json?.item?.received_qty ?? targetQty)))
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (error: any) {
      const message = String(error?.message || error)
      setFeedback({ kind: 'error', msg: message })
      toast.error('Receive update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[hsl(var(--muted))]">Received total</span>
          <input
            type="number"
            min={currentQty}
            max={maxQty}
            value={nextReceivedQty}
            onChange={(e) => setNextReceivedQty(Math.max(currentQty, Math.min(maxQty, Number(e.target.value || currentQty))))}
            className="min-h-[42px] rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            disabled={busy || disabled}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => save(nextReceivedQty)} disabled={!dirty || busy || disabled}>
            {busy ? 'Saving…' : 'Apply received'}
          </Button>
          <Button type="button" variant="outline" onClick={() => save(maxQty)} disabled={busy || disabled || currentQty >= maxQty}>
            Mark full received
          </Button>
        </div>

        <div className="text-xs text-[hsl(var(--muted))]">
          Ordered: <span className="font-medium text-[hsl(var(--fg))]">{maxQty}</span> · Already received:{' '}
          <span className="font-medium text-[hsl(var(--fg))]">{currentQty}</span>
        </div>
      </div>

      {feedback.msg ? <InlineAlert compact variant={feedback.kind === 'error' ? 'error' : 'success'}>{feedback.msg}</InlineAlert> : null}
    </div>
  )
}
