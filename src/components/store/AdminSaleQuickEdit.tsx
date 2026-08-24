'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import { parsePriceToCents, toPriceString } from '@/lib/money'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type SaleStatus = 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'

type SaleItemEdit = {
  productId: string
  productName: string | null
  qty: number
  unitPriceCents: number
  deliveredStockApplied: boolean
} | null

type Props = {
  id: string
  purchaseDate: string | null
  buyerFullName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  totalCents: number
  discountCents: number | null
  paidCents: number
  debtCents: number
  paymentMethod: PaymentMethod | null
  status: SaleStatus
  note: string | null
  currency: string | null
  item: SaleItemEdit
  hasAppliedStock: boolean
  canDelete: boolean
  deleteBlockedReason: string | null
}

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

const STATUSES: Array<{ value: SaleStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'partial_paid', label: 'Partial paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'canceled', label: 'Canceled' },
]

function centsToInput(cents: number | null | undefined) {
  return (Math.max(0, Math.floor(Number(cents || 0))) / 100).toFixed(2)
}


function formatAmount(cents: number, currency = 'EGP') {
  return `${toPriceString(cents)} ${currency}`
}

function saleStatusLabel(totalCents: number, paidCents: number, currentStatus?: SaleStatus) {
  if (currentStatus === 'delivered') return 'Delivered'
  if (currentStatus === 'canceled') return 'Canceled'
  if (totalCents <= 0) return 'Paid'
  if (paidCents <= 0) return 'Draft'
  if (paidCents >= totalCents) return 'Paid'
  return 'Partial paid'
}

function normalizeCollectPaymentCents(value: string, maxCents: number) {
  return Math.max(0, Math.min(parsePriceToCents(value), Math.max(0, Math.floor(Number(maxCents || 0)))))
}

export default function AdminSaleQuickEdit({
  id,
  purchaseDate,
  buyerFullName,
  buyerEmail,
  buyerPhone,
  totalCents,
  discountCents,
  paidCents,
  debtCents,
  paymentMethod,
  status,
  note,
  currency,
  item,
  hasAppliedStock,
  canDelete,
  deleteBlockedReason,
}: Props) {
  const router = useRouter()
  const [purchaseDateValue, setPurchaseDateValue] = useState(purchaseDate || new Date().toISOString().slice(0, 10))
  const [buyerNameValue, setBuyerNameValue] = useState(buyerFullName || 'Unknown buyer')
  const [buyerEmailValue, setBuyerEmailValue] = useState(buyerEmail || '')
  const [buyerPhoneValue, setBuyerPhoneValue] = useState(buyerPhone || '')
  const [statusValue, setStatusValue] = useState<SaleStatus>(status)
  const [paymentValue, setPaymentValue] = useState<PaymentMethod>(paymentMethod || 'cash')
  const [qtyValue, setQtyValue] = useState<number>(Math.max(1, Number(item?.qty || 1)))
  const [unitPriceValue, setUnitPriceValue] = useState<string>(centsToInput(item?.unitPriceCents || totalCents))
  const [discountValue, setDiscountValue] = useState<string>(centsToInput(discountCents))
  const [paidValue, setPaidValue] = useState<string>(centsToInput(paidCents))
  const [noteValue, setNoteValue] = useState(note || '')
  const [busy, setBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: '' | 'success' | 'error'; text: string }>({ kind: '', text: '' })
  const [collectOpen, setCollectOpen] = useState(false)
  const [collectBusy, setCollectBusy] = useState(false)
  const [collectAmountValue, setCollectAmountValue] = useState<string>(centsToInput(debtCents))
  const [collectPaymentValue, setCollectPaymentValue] = useState<PaymentMethod>(paymentMethod || 'cash')

  const preview = useMemo(() => {
    const qty = Math.max(1, Math.floor(Number(qtyValue || 1)))
    const unitPriceCents = parsePriceToCents(unitPriceValue)
    const subtotalCents = Math.max(0, qty * unitPriceCents)
    const discount = Math.max(0, Math.min(parsePriceToCents(discountValue), subtotalCents))
    const total = Math.max(0, subtotalCents - discount)
    const paid = Math.max(0, Math.min(parsePriceToCents(paidValue), total))
    const debt = Math.max(0, total - paid)
    return { qty, unitPriceCents, subtotalCents, discount, total, paid, debt }
  }, [discountValue, paidValue, qtyValue, unitPriceValue])

  const currentDebtCents = Math.max(0, Math.floor(Number(debtCents || 0)))
  const safeTotalCents = Math.max(0, Math.floor(Number(totalCents || 0)))
  const safePaidCents = Math.max(0, Math.min(Math.floor(Number(paidCents || 0)), safeTotalCents))
  const canCollectPayment = currentDebtCents > 0 && status !== 'canceled'

  useEffect(() => {
    setCollectAmountValue(centsToInput(debtCents))
    setCollectPaymentValue(paymentMethod || 'cash')
  }, [debtCents, paymentMethod])

  const collectPreview = useMemo(() => {
    const payment = normalizeCollectPaymentCents(collectAmountValue, currentDebtCents)
    const newPaid = Math.max(0, Math.min(safePaidCents + payment, safeTotalCents))
    const newDebt = Math.max(0, safeTotalCents - newPaid)
    return {
      payment,
      newPaid,
      newDebt,
      statusLabel: saleStatusLabel(safeTotalCents, newPaid, status),
    }
  }, [collectAmountValue, currentDebtCents, safePaidCents, safeTotalCents, status])

  const collectSummaryItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    const selectedPaymentLabel = PAYMENT_METHODS.find((method) => method.value === collectPaymentValue)?.label || collectPaymentValue

    return [
      { label: 'Sale', value: item?.productName || `Sale ${id.slice(0, 8)}` },
      { label: 'Buyer', value: buyerFullName || 'Unknown buyer' },
      { label: 'Total', value: formatAmount(safeTotalCents, currency || 'EGP') },
      { label: 'Already paid', value: formatAmount(safePaidCents, currency || 'EGP') },
      { label: 'Current debt', value: formatAmount(currentDebtCents, currency || 'EGP') },
      { label: 'Payment now', value: formatAmount(collectPreview.payment, currency || 'EGP') },
      { label: 'Payment method', value: selectedPaymentLabel },
      { label: 'New paid', value: formatAmount(collectPreview.newPaid, currency || 'EGP') },
      { label: 'New remaining debt', value: formatAmount(collectPreview.newDebt, currency || 'EGP') },
      { label: 'New status', value: collectPreview.statusLabel },
      { label: 'Impact', value: 'Only this sale payment amount, payment method and money status will be updated. Stock is not changed.' },
    ]
  }, [buyerFullName, collectPaymentValue, collectPreview, currency, currentDebtCents, id, item?.productName, safePaidCents, safeTotalCents])

  function openCollectConfirmation() {
    setMessage({ kind: '', text: '' })

    if (!canCollectPayment) {
      toast.error(currentDebtCents > 0 ? 'Canceled sales cannot receive payments.' : 'This sale has no remaining debt.')
      return
    }
    if (collectPreview.payment <= 0) {
      toast.error('Payment amount must be greater than 0')
      return
    }

    setCollectOpen(true)
  }

  async function collectPayment() {
    if (collectBusy || !canCollectPayment || collectPreview.payment <= 0) return

    setCollectBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      const res = await fetch('/api/store/sales/collect-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: id,
          payment_cents: collectPreview.payment,
          payment_method: collectPaymentValue,
        }),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const err = json?.details || json?.error || 'Payment collection failed'
        setMessage({ kind: 'error', text: err })
        toast.error(err)
        return
      }

      const nextPaid = Math.max(0, Math.floor(Number(json?.paid_cents ?? collectPreview.newPaid) || 0))
      const nextDebt = Math.max(0, Math.floor(Number(json?.debt_cents ?? collectPreview.newDebt) || 0))
      setPaidValue(centsToInput(nextPaid))
      setStatusValue((json?.status as SaleStatus) || statusValue)
      setPaymentValue(collectPaymentValue)
      setCollectAmountValue(centsToInput(nextDebt))
      setCollectOpen(false)
      setMessage({ kind: 'success', text: 'Payment collected' })
      toast.success('Payment collected')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const err = e?.message || 'Network error'
      setMessage({ kind: 'error', text: err })
      toast.error(err)
    } finally {
      setCollectBusy(false)
    }
  }

  async function saveChanges() {
    setBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      const res = await fetch('/api/store/sales/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: id,
          purchase_date: purchaseDateValue,
          buyer_full_name: buyerNameValue.trim() || null,
          buyer_email: buyerEmailValue.trim() || null,
          buyer_phone: buyerPhoneValue.trim() || null,
          status: statusValue,
          payment_method: paymentValue,
          qty: preview.qty,
          unit_price_cents: preview.unitPriceCents,
          discount_cents: preview.discount,
          paid_cents: preview.paid,
          note: noteValue.trim() || null,
        }),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const err = json?.details || json?.error || 'Sale update failed'
        setMessage({ kind: 'error', text: err })
        toast.error(err)
        return
      }
      setMessage({ kind: 'success', text: 'Sale updated' })
      toast.success('Sale updated')
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

  async function deleteSale() {
    if (!canDelete) return
    const ok = window.confirm('Delete this sale permanently? This cannot be undone.')
    if (!ok) return

    setDeleteBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      const res = await fetch('/api/store/sales/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale_id: id }),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const err = json?.details || json?.error || 'Sale delete failed'
        setMessage({ kind: 'error', text: err })
        toast.error(err)
        return
      }
      toast.success('Sale deleted')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const err = e?.message || 'Network error'
      setMessage({ kind: 'error', text: err })
      toast.error(err)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <div className="rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Edit sale</div>
          <div className="text-xs text-[hsl(var(--muted))]">Edit purchase, buyer, money, status, item quantity, and note.</div>
        </div>
        <div className="rounded-full border px-2.5 py-1 text-xs text-[hsl(var(--muted))]">
          Current debt: {toPriceString(debtCents)} {currency || 'EGP'}
        </div>
      </div>

        {canCollectPayment ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-amber-950">Collect remaining payment</div>
                <div className="text-xs text-amber-800">
                  Current debt: {formatAmount(currentDebtCents, currency || 'EGP')}. Collect all or part of the remaining balance.
                </div>
              </div>
              <div className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900">
                No stock change
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
              <Input
                label="Collect now (EGP)"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                max={centsToInput(currentDebtCents)}
                value={collectAmountValue}
                onChange={(e) => setCollectAmountValue(e.target.value)}
                disabled={busy || deleteBusy || collectBusy}
              />
              <Select
                label="Payment method"
                value={collectPaymentValue}
                onChange={(e) => setCollectPaymentValue(e.target.value as PaymentMethod)}
                disabled={busy || deleteBusy || collectBusy}
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCollectAmountValue(centsToInput(currentDebtCents))}
                  disabled={busy || deleteBusy || collectBusy}
                >
                  Full debt
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={openCollectConfirmation}
                  disabled={busy || deleteBusy || collectBusy || collectPreview.payment <= 0}
                  loading={collectBusy}
                  loadingText="Collecting…"
                >
                  Review payment
                </Button>
              </div>
            </div>

            <div className="mt-2 grid gap-1 text-xs text-amber-900 sm:grid-cols-3">
              <div>Payment now: <span className="font-medium">{formatAmount(collectPreview.payment, currency || 'EGP')}</span></div>
              <div>New paid: <span className="font-medium">{formatAmount(collectPreview.newPaid, currency || 'EGP')}</span></div>
              <div>New debt: <span className="font-medium">{formatAmount(collectPreview.newDebt, currency || 'EGP')}</span></div>
            </div>
          </div>
        ) : currentDebtCents > 0 && status === 'canceled' ? (
          <InlineAlert compact variant="warning">This sale has remaining debt, but canceled sales cannot receive payments.</InlineAlert>
        ) : null}

      <div className="mt-4 grid gap-3">
        <Input
          label="Purchase date"
          type="date"
          value={purchaseDateValue}
          onChange={(e) => setPurchaseDateValue(e.target.value)}
          disabled={busy || deleteBusy}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Buyer name"
            value={buyerNameValue}
            onChange={(e) => setBuyerNameValue(e.target.value)}
            disabled={busy || deleteBusy}
            placeholder="Unknown buyer"
          />
          <Input
            label="Buyer email"
            type="email"
            value={buyerEmailValue}
            onChange={(e) => setBuyerEmailValue(e.target.value)}
            disabled={busy || deleteBusy}
            placeholder="Optional"
          />
          <Input
            label="Buyer phone"
            value={buyerPhoneValue}
            onChange={(e) => setBuyerPhoneValue(e.target.value)}
            disabled={busy || deleteBusy}
            placeholder="Optional"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Status"
            value={statusValue}
            onChange={(e) => setStatusValue(e.target.value as SaleStatus)}
            disabled={busy || deleteBusy || hasAppliedStock}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
          <Select
            label="Payment method"
            value={paymentValue}
            onChange={(e) => setPaymentValue(e.target.value as PaymentMethod)}
            disabled={busy || deleteBusy}
          >
            {PAYMENT_METHODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>

        {item ? (
          <div className="rounded-2xl border p-3">
            <div className="text-xs font-medium text-[hsl(var(--muted))]">Item</div>
            <div className="mt-1 truncate text-sm font-semibold">{item.productName || 'Product'}</div>
            {hasAppliedStock ? (
              <div className="mt-2 text-xs text-amber-700">Quantity and price are locked because stock was already applied.</div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input
                label="Quantity"
                type="number"
                min={1}
                value={qtyValue}
                onChange={(e) => setQtyValue(Number(e.target.value || 1))}
                disabled={busy || deleteBusy || hasAppliedStock}
              />
              <Input
                label="Unit price (EGP)"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={unitPriceValue}
                onChange={(e) => setUnitPriceValue(e.target.value)}
                disabled={busy || deleteBusy || hasAppliedStock}
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Discount (EGP)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            disabled={busy || deleteBusy}
          />
          <Input
            label="Paid (EGP)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={paidValue}
            onChange={(e) => setPaidValue(e.target.value)}
            disabled={busy || deleteBusy}
          />
        </div>

        <div className="rounded-2xl border bg-[hsl(var(--bg))] p-3 text-sm">
          <div className="text-[11px] font-medium text-[hsl(var(--muted))]">Preview</div>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            <div>Total: <span className="font-medium">{toPriceString(preview.total)} {currency || 'EGP'}</span></div>
            <div>Debt: <span className="font-medium">{toPriceString(preview.debt)} {currency || 'EGP'}</span></div>
          </div>
        </div>

        <Textarea
          label="Note"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={3}
          disabled={busy || deleteBusy}
          placeholder="Optional internal note"
        />

        {message.text ? (
          <InlineAlert compact variant={message.kind === 'error' ? 'error' : 'success'}>{message.text}</InlineAlert>
        ) : null}

        {deleteBlockedReason ? (
          <InlineAlert compact variant="info">{deleteBlockedReason}</InlineAlert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={saveChanges} disabled={busy || deleteBusy} loading={busy} loadingText="Saving…">
            Save changes
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={deleteSale}
            disabled={!canDelete || busy || deleteBusy}
            loading={deleteBusy}
            loadingText="Deleting…"
          >
            Delete sale
          </Button>
        </div>
      </div>
      </div>

      <ConfirmActionModal
        open={collectOpen}
        title="Confirm debt payment"
        description="Review the payment before updating this sale."
        confirmLabel="Confirm payment"
        pendingLabel="Collecting…"
        pending={collectBusy}
        summaryItems={collectSummaryItems}
        warning="This updates only the sale payment amount, payment method and money status. Stock, products, preorders, supplier orders, expenses, funding and reconciliation are not changed."
        onCancel={() => (collectBusy ? null : setCollectOpen(false))}
        onConfirm={collectPayment}
      />
    </>
  )
}
