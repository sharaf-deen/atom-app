'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import { formatCurrency } from '@/lib/money'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'

type Props = {
  id: string
  status: PreorderStatus
  totalCents: number
  depositCents?: number
  balanceDueCents: number
  depositPaymentMethod: PaymentMethod | null
  convertedSaleId: string | null
  productLabel?: string
  buyerLabel?: string
  qty?: number
  unitPriceCents?: number
  stockAvailable?: number | null
}

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

function shortId(id: string | null | undefined) {
  return String(id || '').slice(0, 8)
}

function paymentMethodLabel(value: PaymentMethod) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value
}

function safeCents(value: number | null | undefined) {
  return Math.max(0, Math.floor(Number(value || 0)))
}

function stockLabel(stockAvailable: number | null | undefined) {
  if (stockAvailable === null || stockAvailable === undefined) return 'Unknown'
  return `${Math.max(0, Math.floor(Number(stockAvailable || 0)))} unit(s)`
}

function stockImpactLabel(stockAvailable: number | null | undefined, qty: number) {
  const safeQty = Math.max(0, Math.floor(Number(qty || 0)))
  if (stockAvailable === null || stockAvailable === undefined) return `Will deduct ${safeQty} unit(s) if the existing conversion check passes.`
  const safeStock = Math.max(0, Math.floor(Number(stockAvailable || 0)))
  const nextStock = safeStock - safeQty
  if (nextStock < 0) return `Will try to deduct ${safeQty} unit(s). Current visible stock is short by ${Math.abs(nextStock)} unit(s).`
  return `Will deduct ${safeQty} unit(s). Expected stock after completion: ${nextStock}.`
}

export default function CompletePreorderAsSaleButton({
  id,
  status,
  totalCents,
  depositCents = 0,
  balanceDueCents,
  depositPaymentMethod,
  convertedSaleId,
  productLabel = '—',
  buyerLabel = '—',
  qty = 0,
  unitPriceCents = 0,
  stockAvailable = null,
}: Props) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(depositPaymentMethod || 'cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const alreadyConverted = Boolean(convertedSaleId)
  const disabledByStatus = status === 'completed' || status === 'canceled'
  const canComplete = !alreadyConverted && !disabledByStatus

  const safeQty = Math.max(0, Math.floor(Number(qty || 0)))
  const safeTotalCents = safeCents(totalCents)
  const safeDepositCents = Math.min(safeCents(depositCents), safeTotalCents)
  const safeBalanceCents = Math.max(0, Math.min(safeCents(balanceDueCents), Math.max(0, safeTotalCents - safeDepositCents)))
  const hasBalanceDue = safeBalanceCents > 0
  const safeStockAvailable = stockAvailable === null || stockAvailable === undefined ? null : Math.max(0, Math.floor(Number(stockAvailable || 0)))
  const stockAfterCompletion = safeStockAvailable === null ? null : safeStockAvailable - safeQty
  const hasVisibleStockShortage = stockAfterCompletion !== null && stockAfterCompletion < 0

  const saleResultLabel = 'Delivered sale created through the existing Complete & create sale flow'
  const confirmationSummary = useMemo<ConfirmActionSummaryItem[]>(() => [
    { label: 'Customer', value: buyerLabel },
    { label: 'Product / variant', value: productLabel },
    { label: 'Quantity', value: safeQty || '—' },
    { label: 'Unit price', value: formatCurrency(unitPriceCents) },
    { label: 'Total preorder', value: formatCurrency(safeTotalCents) },
    { label: 'Deposit paid', value: formatCurrency(safeDepositCents) },
    { label: 'Remaining balance', value: formatCurrency(safeBalanceCents) },
    { label: 'Current linked stock', value: stockLabel(safeStockAvailable) },
    { label: 'Stock impact', value: stockImpactLabel(safeStockAvailable, safeQty) },
    { label: 'Final payment method', value: paymentMethodLabel(paymentMethod) },
    { label: 'Sale after conversion', value: saleResultLabel },
    { label: 'Preorder impact', value: 'Preorder will be marked as completed and linked to the created sale.' },
  ], [buyerLabel, paymentMethod, productLabel, safeBalanceCents, safeDepositCents, safeQty, safeStockAvailable, safeTotalCents, unitPriceCents])

  function requestComplete() {
    if (!canComplete || busy) return
    setError('')
    setConfirmOpen(true)
  }

  async function completeConfirmed() {
    if (!canComplete || busy) return

    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/store/preorders/${id}/complete-as-sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: paymentMethod }),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Unable to complete preorder as sale'
        setError(msg)
        toast.error(msg)
        return
      }
      setConfirmOpen(false)
      toast.success('Preorder completed and sale created')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-4 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Complete & create sale</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            Final step: convert this preorder into a delivered sale through the existing conversion flow.
          </div>
        </div>
        {alreadyConverted ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Sale {shortId(convertedSaleId)}
          </span>
        ) : (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
            Sensitive action
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 rounded-2xl border border-dashed bg-[hsl(var(--bg))]/50 p-3 text-xs sm:grid-cols-2">
        <div>
          <span className="text-[hsl(var(--muted))]">Total:</span>{' '}
          <span className="font-medium">{formatCurrency(safeTotalCents)}</span>
        </div>
        <div>
          <span className="text-[hsl(var(--muted))]">Deposit paid:</span>{' '}
          <span className="font-medium">{formatCurrency(safeDepositCents)}</span>
        </div>
        <div>
          <span className="text-[hsl(var(--muted))]">Remaining balance:</span>{' '}
          <span className={`font-medium ${hasBalanceDue ? 'text-amber-800' : 'text-emerald-700'}`}>
            {formatCurrency(safeBalanceCents)}
          </span>
        </div>
        <div>
          <span className="text-[hsl(var(--muted))]">Current linked stock:</span>{' '}
          <span className={`font-medium ${hasVisibleStockShortage ? 'text-red-700' : ''}`}>{stockLabel(safeStockAvailable)}</span>
        </div>
        <div className="sm:col-span-2">
          <span className="text-[hsl(var(--muted))]">Stock impact:</span>{' '}
          <span className={`font-medium ${hasVisibleStockShortage ? 'text-red-700' : ''}`}>
            {stockImpactLabel(safeStockAvailable, safeQty)}
          </span>
        </div>
      </div>

      {hasBalanceDue && canComplete ? (
        <InlineAlert compact variant="warning" className="mt-3">
          Balance still due: {formatCurrency(safeBalanceCents)}. Collect the balance first, or confirm only if this amount has just been paid and you are using the selected final payment method below.
        </InlineAlert>
      ) : null}

      {hasVisibleStockShortage && canComplete ? (
        <InlineAlert compact variant="warning" className="mt-3">
          Visible linked stock is below preorder quantity. The existing conversion check may block completion if stock is still insufficient.
        </InlineAlert>
      ) : null}

      {alreadyConverted ? (
        <InlineAlert compact variant="success" className="mt-3">
          This preorder has already been converted to a sale.
        </InlineAlert>
      ) : disabledByStatus ? (
        <InlineAlert compact variant="warning" className="mt-3">
          This preorder cannot be converted because its status is {status}.
        </InlineAlert>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select
            label="Final payment method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            disabled={busy}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button type="button" onClick={requestComplete} disabled={busy} loading={busy} loadingText="Completing…">
              Review completion
            </Button>
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={confirmOpen}
        title="Complete preorder and create sale?"
        description="Review the money, stock and sale impact before completing this preorder."
        confirmLabel="Confirm & create sale"
        pendingLabel="Completing…"
        pending={busy}
        onCancel={() => (busy ? null : setConfirmOpen(false))}
        onConfirm={completeConfirmed}
        summaryItems={confirmationSummary}
        warning="This uses the existing Complete & create sale logic. It can deduct stock, create the sale, and mark the preorder as completed. No supplier orders, expenses, funding or payment reconciliation records are changed by this UI helper."
      />

      {error ? (
        <InlineAlert compact variant="error" className="mt-3">
          {error}
        </InlineAlert>
      ) : null}
    </div>
  )
}
