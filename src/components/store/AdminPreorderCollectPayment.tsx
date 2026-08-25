'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'

type Props = {
  id: string
  totalCents: number
  depositCents: number
  balanceDueCents: number
  depositPaymentMethod: PaymentMethod | null
  status: PreorderStatus
  convertedSaleId?: string | null
  productLabel?: string
  buyerLabel?: string
  qty?: number
  currency?: string | null
}

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

function centsToInput(cents: number | null | undefined) {
  return (Math.max(0, Math.floor(Number(cents || 0))) / 100).toFixed(2)
}

function formatAmount(cents: number | null | undefined, currency = 'EGP') {
  const value = Math.max(0, Math.floor(Number(cents || 0))) / 100
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2)
  return `${amount} ${currency}`
}

function parseAmountToCents(value: string) {
  const normalized = String(value || '').replace(/,/g, '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed * 100)
}

function normalizeCollectCents(value: string, maxCents: number) {
  return Math.max(0, Math.min(parseAmountToCents(value), Math.max(0, Math.floor(Number(maxCents || 0)))))
}

function paymentMethodLabel(value: PaymentMethod) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label || value
}

export default function AdminPreorderCollectPayment({
  id,
  totalCents,
  depositCents,
  balanceDueCents,
  depositPaymentMethod,
  status,
  convertedSaleId,
  productLabel = 'Product',
  buyerLabel = 'Member',
  qty = 0,
  currency = 'EGP',
}: Props) {
  const router = useRouter()
  const [amountValue, setAmountValue] = useState(centsToInput(balanceDueCents))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(depositPaymentMethod || 'cash')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: '' | 'success' | 'error'; text: string }>({ kind: '', text: '' })

  const safeTotalCents = Math.max(0, Math.floor(Number(totalCents || 0)))
  const safeDepositCents = Math.max(0, Math.min(Math.floor(Number(depositCents || 0)), safeTotalCents))
  const currentBalanceCents = Math.max(0, Math.min(Math.floor(Number(balanceDueCents || 0)), Math.max(0, safeTotalCents - safeDepositCents)))
  const canCollect = currentBalanceCents > 0 && status !== 'canceled' && status !== 'completed' && !convertedSaleId

  useEffect(() => {
    setAmountValue(centsToInput(balanceDueCents))
    setPaymentMethod(depositPaymentMethod || 'cash')
  }, [balanceDueCents, depositPaymentMethod])

  const preview = useMemo(() => {
    const payment = normalizeCollectCents(amountValue, currentBalanceCents)
    const newDeposit = Math.max(0, Math.min(safeDepositCents + payment, safeTotalCents))
    const newBalance = Math.max(0, safeTotalCents - newDeposit)
    return { payment, newDeposit, newBalance }
  }, [amountValue, currentBalanceCents, safeDepositCents, safeTotalCents])

  const summaryItems = useMemo<ConfirmActionSummaryItem[]>(() => [
    { label: 'Preorder', value: productLabel },
    { label: 'Customer', value: buyerLabel },
    { label: 'Quantity', value: qty || '—' },
    { label: 'Total', value: formatAmount(safeTotalCents, currency || 'EGP') },
    { label: 'Current deposit', value: formatAmount(safeDepositCents, currency || 'EGP') },
    { label: 'Current balance', value: formatAmount(currentBalanceCents, currency || 'EGP') },
    { label: 'Payment now', value: formatAmount(preview.payment, currency || 'EGP') },
    { label: 'Payment method', value: paymentMethodLabel(paymentMethod) },
    { label: 'New deposit', value: formatAmount(preview.newDeposit, currency || 'EGP') },
    { label: 'New remaining balance', value: formatAmount(preview.newBalance, currency || 'EGP') },
    { label: 'Impact', value: 'Only this preorder deposit, remaining balance and deposit payment method will be updated. Stock and sale conversion are not changed.' },
  ], [buyerLabel, currency, currentBalanceCents, paymentMethod, preview, productLabel, qty, safeDepositCents, safeTotalCents])

  function requestCollect() {
    setMessage({ kind: '', text: '' })

    if (!canCollect) {
      if (currentBalanceCents <= 0) toast.error('This preorder has no remaining balance.')
      else if (status === 'canceled') toast.error('Canceled preorders cannot receive balance payments.')
      else if (status === 'completed' || convertedSaleId) toast.error('Completed preorders should be settled from the related sale.')
      else toast.error('Balance payment is not available for this preorder.')
      return
    }

    if (preview.payment <= 0) {
      toast.error('Payment amount must be greater than 0')
      return
    }

    setConfirmOpen(true)
  }

  async function collectPayment() {
    if (busy || !canCollect || preview.payment <= 0) return

    setBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      const res = await fetch('/api/store/preorders/collect-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preorder_id: id,
          payment_cents: preview.payment,
          payment_method: paymentMethod,
        }),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        const err = json?.details || json?.error || 'Balance payment failed'
        setMessage({ kind: 'error', text: err })
        toast.error(err)
        return
      }

      const nextBalance = Math.max(0, Math.floor(Number(json?.balance_due_cents ?? preview.newBalance) || 0))
      setAmountValue(centsToInput(nextBalance))
      setConfirmOpen(false)
      setMessage({ kind: 'success', text: 'Preorder balance payment collected' })
      toast.success('Preorder balance payment collected')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const err = e?.message || 'Network error'
      setMessage({ kind: 'error', text: err })
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  if (currentBalanceCents <= 0) return null

  if (status === 'canceled') {
    return <InlineAlert compact variant="warning">This preorder has a remaining balance, but canceled preorders cannot receive payments.</InlineAlert>
  }

  if (status === 'completed' || convertedSaleId) {
    return <InlineAlert compact variant="info">This preorder is completed. Use the related sale to settle any remaining payment.</InlineAlert>
  }

  return (
    <>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-amber-950">Collect balance payment</div>
            <div className="text-xs text-amber-800">
              Current balance: {formatAmount(currentBalanceCents, currency || 'EGP')}. Collect all or part of the remaining preorder balance.
            </div>
          </div>
          <div className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900">
            No stock / sale conversion
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-amber-950">Collect now ({currency || 'EGP'})</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              max={centsToInput(currentBalanceCents)}
              value={amountValue}
              onChange={(e) => setAmountValue(e.target.value)}
              className="min-h-[40px] w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
              disabled={busy}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-amber-950">Payment method</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="min-h-[40px] w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
              disabled={busy}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAmountValue(centsToInput(currentBalanceCents))}
              disabled={busy}
            >
              Full balance
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={requestCollect}
              disabled={busy || preview.payment <= 0}
              loading={busy}
              loadingText="Collecting…"
            >
              Review payment
            </Button>
          </div>
        </div>

        <div className="mt-2 grid gap-1 text-xs text-amber-900 sm:grid-cols-3">
          <div>Payment now: <span className="font-medium">{formatAmount(preview.payment, currency || 'EGP')}</span></div>
          <div>New deposit: <span className="font-medium">{formatAmount(preview.newDeposit, currency || 'EGP')}</span></div>
          <div>New balance: <span className="font-medium">{formatAmount(preview.newBalance, currency || 'EGP')}</span></div>
        </div>

        {message.text ? (
          <div className="mt-3">
            <InlineAlert compact variant={message.kind === 'error' ? 'error' : 'success'}>{message.text}</InlineAlert>
          </div>
        ) : null}
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm preorder balance payment"
        description="Review the payment before updating this preorder."
        confirmLabel="Confirm payment"
        pendingLabel="Collecting…"
        pending={busy}
        summaryItems={summaryItems}
        warning="This updates only the preorder deposit amount, remaining balance and deposit payment method. Stock, sale conversion, sales, supplier orders, expenses, funding and reconciliation are not changed."
        onCancel={() => (busy ? null : setConfirmOpen(false))}
        onConfirm={collectPayment}
      />
    </>
  )
}
