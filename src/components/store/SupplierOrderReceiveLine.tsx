'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import InlineAlert from '@/components/ui/InlineAlert'

function asSafeQty(value: unknown) {
  const numeric = Math.floor(Number(value ?? 0))
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

function formatStock(value: number | null) {
  return value === null ? 'Unknown' : `${value} unit(s)`
}

export default function SupplierOrderReceiveLine({
  itemId,
  orderedQty,
  receivedQty,
  lineStatus,
  productName,
  productId,
  productColor,
  productSize,
  currentStock,
  productActive,
}: {
  itemId: string
  orderedQty: number
  receivedQty: number
  lineStatus: string
  productName?: string | null
  productId?: string | null
  productColor?: string | null
  productSize?: string | null
  currentStock?: number | null
  productActive?: boolean | null
}) {
  const router = useRouter()
  const maxQty = asSafeQty(orderedQty)
  const currentQty = asSafeQty(receivedQty)
  const remainingQty = Math.max(0, maxQty - currentQty)

  const [receiveNowQty, setReceiveNowQty] = useState<number>(remainingQty)
  const [stockAfterReceive, setStockAfterReceive] = useState<number | null>(
    typeof currentStock === 'number' && Number.isFinite(currentStock) ? Math.max(0, Math.floor(currentStock)) : null
  )
  const [confirmTargetQty, setConfirmTargetQty] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  useEffect(() => {
    setReceiveNowQty(remainingQty)
  }, [remainingQty])

  useEffect(() => {
    if (typeof currentStock === 'number' && Number.isFinite(currentStock)) {
      setStockAfterReceive(Math.max(0, Math.floor(currentStock)))
    }
  }, [currentStock])

  const disabled = lineStatus === 'received' || lineStatus === 'canceled' || remainingQty <= 0
  const targetQty = confirmTargetQty ?? Math.min(maxQty, currentQty + receiveNowQty)
  const receiveDelta = Math.max(0, Number(targetQty || 0) - currentQty)
  const remainingAfter = Math.max(0, maxQty - targetQty)
  const expectedStockAfter = stockAfterReceive === null ? null : stockAfterReceive + receiveDelta
  const variantLabel = [productColor, productSize].filter(Boolean).join(' · ') || 'Default variant'
  const hasValidReceiveQty = receiveNowQty > 0 && receiveNowQty <= remainingQty

  const confirmationItems = useMemo(
    () => [
      { label: 'Product', value: productName || 'Supplier order line' },
      { label: 'Variant', value: variantLabel },
      { label: 'Product ID', value: productId ? productId.slice(0, 8) : 'Not linked' },
      { label: 'Ordered qty', value: maxQty },
      { label: 'Already received', value: currentQty },
      { label: 'Remaining before', value: remainingQty },
      { label: 'Receive now', value: receiveDelta },
      { label: 'New received total', value: targetQty },
      { label: 'Remaining after', value: remainingAfter },
      { label: 'Current catalog stock', value: formatStock(stockAfterReceive) },
      { label: 'Expected stock after receiving', value: formatStock(expectedStockAfter) },
      { label: 'Line status', value: lineStatus.replaceAll('_', ' ') },
      { label: 'Stock impact', value: receiveDelta > 0 ? `Stock will increase by ${receiveDelta} unit(s).` : 'No additional stock increase.' },
      { label: 'Linked expenses', value: 'None automatic.' },
    ],
    [
      currentQty,
      expectedStockAfter,
      lineStatus,
      maxQty,
      productId,
      productName,
      receiveDelta,
      remainingAfter,
      remainingQty,
      stockAfterReceive,
      targetQty,
      variantLabel,
    ]
  )

  function clampReceiveNow(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(remainingQty, Math.floor(value)))
  }

  function requestReceiveNow(amount: number) {
    if (busy || disabled) return
    const safeAmount = clampReceiveNow(amount)
    if (safeAmount <= 0 || safeAmount > remainingQty) {
      setFeedback({ kind: 'error', msg: `Receive now must be between 1 and ${remainingQty}.` })
      toast.error('Invalid receiving quantity')
      return
    }

    setFeedback({ kind: '', msg: '' })
    setConfirmTargetQty(currentQty + safeAmount)
  }

  async function receiveConfirmed() {
    const target = confirmTargetQty ?? Math.min(maxQty, currentQty + receiveNowQty)
    if (busy || disabled) return
    if (!Number.isFinite(target) || target <= currentQty || target > maxQty) {
      setFeedback({ kind: 'error', msg: `Received total must stay between ${currentQty + 1} and ${maxQty}.` })
      toast.error('Invalid received quantity')
      return
    }

    setBusy(true)
    setFeedback({ kind: '', msg: '' })

    try {
      const response = await fetch('/api/store/supplier-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, received_qty: target }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        const message = json?.details || json?.error || 'Receive update failed'
        setFeedback({ kind: 'error', msg: message })
        toast.error('Receive update failed')
        return
      }

      const appliedReceivedQty = asSafeQty(json?.item?.received_qty ?? target)
      const nextRemaining = Math.max(0, maxQty - appliedReceivedQty)
      const returnedStock = json?.item?.inventory_qty
      if (typeof returnedStock === 'number' && Number.isFinite(returnedStock)) {
        setStockAfterReceive(Math.max(0, Math.floor(returnedStock)))
      } else if (stockAfterReceive !== null) {
        setStockAfterReceive(stockAfterReceive + Math.max(0, appliedReceivedQty - currentQty))
      }
      setConfirmTargetQty(null)
      setReceiveNowQty(nextRemaining)
      setFeedback({ kind: 'success', msg: 'Received stock applied.' })
      toast.success('Received stock applied')
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
    <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Receive stock</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">Review ordered, received, remaining, and stock impact before applying.</div>
        </div>
        {productActive === false ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Inactive product</span>
        ) : null}
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-gray-50 p-2">
          <div className="text-[hsl(var(--muted))]">Ordered qty</div>
          <div className="mt-1 text-base font-semibold text-[hsl(var(--fg))]">{maxQty}</div>
        </div>
        <div className="rounded-xl border bg-gray-50 p-2">
          <div className="text-[hsl(var(--muted))]">Already received</div>
          <div className="mt-1 text-base font-semibold text-[hsl(var(--fg))]">{currentQty}</div>
        </div>
        <div className="rounded-xl border bg-gray-50 p-2">
          <div className="text-[hsl(var(--muted))]">Remaining to receive</div>
          <div className="mt-1 text-base font-semibold text-[hsl(var(--fg))]">{remainingQty}</div>
        </div>
        <div className="rounded-xl border bg-gray-50 p-2">
          <div className="text-[hsl(var(--muted))]">Current catalog stock</div>
          <div className="mt-1 text-base font-semibold text-[hsl(var(--fg))]">{formatStock(stockAfterReceive)}</div>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border bg-gray-50 p-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[hsl(var(--muted))]">Receive now</span>
          <input
            type="number"
            min={0}
            max={remainingQty}
            value={receiveNowQty}
            onChange={(e) => setReceiveNowQty(clampReceiveNow(Number(e.target.value || 0)))}
            className="min-h-[42px] rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            disabled={busy || disabled}
          />
        </label>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => requestReceiveNow(receiveNowQty)} disabled={!hasValidReceiveQty || busy || disabled}>
              {busy ? 'Saving…' : 'Review receiving'}
            </Button>
            <Button type="button" variant="outline" onClick={() => requestReceiveNow(remainingQty)} disabled={busy || disabled || remainingQty <= 0}>
              Receive remaining
            </Button>
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">
            New received total:{' '}
            <span className="font-medium text-[hsl(var(--fg))]">{Math.min(maxQty, currentQty + receiveNowQty)}</span> · Remaining after:{' '}
            <span className="font-medium text-[hsl(var(--fg))]">{Math.max(0, maxQty - Math.min(maxQty, currentQty + receiveNowQty))}</span> · Expected stock after:{' '}
            <span className="font-medium text-[hsl(var(--fg))]">{formatStock(stockAfterReceive === null ? null : stockAfterReceive + receiveNowQty)}</span>
          </div>
        </div>
      </div>

      {remainingQty <= 0 ? <InlineAlert compact variant="success">This line is fully received. No additional stock is pending.</InlineAlert> : null}
      {feedback.msg ? <InlineAlert compact variant={feedback.kind === 'error' ? 'error' : 'success'}>{feedback.msg}</InlineAlert> : null}

      <ConfirmActionModal
        open={confirmTargetQty !== null}
        title="Confirm stock receiving"
        description="Please review the receiving quantity and stock impact before applying it."
        confirmLabel="Confirm receiving"
        pendingLabel="Saving…"
        pending={busy}
        summaryItems={confirmationItems}
        warning="This receiving action can increase product stock according to the existing Store supplier-order logic. It does not create expenses or payments automatically."
        onCancel={() => setConfirmTargetQty(null)}
        onConfirm={receiveConfirmed}
      />
    </div>
  )
}
