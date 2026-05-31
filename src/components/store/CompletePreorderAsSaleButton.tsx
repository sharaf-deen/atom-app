'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import { formatCurrency } from '@/lib/money'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'

type Props = {
  id: string
  status: PreorderStatus
  totalCents: number
  balanceDueCents: number
  depositPaymentMethod: PaymentMethod | null
  convertedSaleId: string | null
  productLabel?: string
  buyerLabel?: string
  qty?: number
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

export default function CompletePreorderAsSaleButton({
  id,
  status,
  totalCents,
  balanceDueCents,
  depositPaymentMethod,
  convertedSaleId,
  productLabel = '—',
  buyerLabel = '—',
  qty = 0,
}: Props) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(depositPaymentMethod || 'cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const alreadyConverted = Boolean(convertedSaleId)
  const disabledByStatus = status === 'completed' || status === 'canceled'
  const canComplete = !alreadyConverted && !disabledByStatus

  function requestComplete() {
    if (!canComplete || busy) return
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
          <div className="font-semibold">Complete as sale</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            Use this only after the customer received the order and paid the full balance.
          </div>
        </div>
        {alreadyConverted ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Sale {shortId(convertedSaleId)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 rounded-2xl border border-dashed bg-[hsl(var(--bg))]/50 p-3 text-xs sm:grid-cols-2">
        <div>
          <span className="text-[hsl(var(--muted))]">Total:</span>{' '}
          <span className="font-medium">{formatCurrency(totalCents)}</span>
        </div>
        <div>
          <span className="text-[hsl(var(--muted))]">Balance to collect:</span>{' '}
          <span className="font-medium">{formatCurrency(balanceDueCents)}</span>
        </div>
      </div>

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
              Complete & create sale
            </Button>
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={confirmOpen}
        title="Complete preorder and create sale?"
        description="Use this only after the customer received the item and paid the full amount."
        confirmLabel="Confirm & create sale"
        pendingLabel="Completing…"
        pending={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={completeConfirmed}
        summaryItems={[
          { label: 'Customer', value: buyerLabel },
          { label: 'Product', value: productLabel },
          { label: 'Quantity', value: qty || '—' },
          { label: 'Total amount', value: formatCurrency(totalCents) },
          { label: 'Balance to collect', value: formatCurrency(balanceDueCents) },
          { label: 'Final payment method', value: paymentMethodLabel(paymentMethod) },
          { label: 'Sale status', value: 'Delivered' },
          { label: 'Stock impact', value: 'Stock will be deducted' },
          { label: 'Preorder impact', value: 'Marked as completed' },
        ]}
      />

      {error ? (
        <InlineAlert compact variant="error" className="mt-3">
          {error}
        </InlineAlert>
      ) : null}
    </div>
  )
}
