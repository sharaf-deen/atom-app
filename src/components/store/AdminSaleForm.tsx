'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
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

type ProductOption = {
  id: string
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
}

type BuyerOption = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: string | null
}

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

function todayInputDate() {
  return new Date().toISOString().slice(0, 10)
}

function productLabel(p: ProductOption) {
  const bits = [p.name, p.color || null, p.size || null].filter(Boolean)
  return bits.join(' · ')
}

function buyerName(buyer: BuyerOption) {
  const name = [buyer.first_name, buyer.last_name].map((v) => String(v || '').trim()).filter(Boolean).join(' ')
  return name || buyer.email || buyer.member_id || 'Member'
}

function buyerMeta(buyer: BuyerOption) {
  return [buyer.member_id ? `ID ${buyer.member_id}` : null, buyer.email || null, buyer.phone || null]
    .filter(Boolean)
    .join(' · ')
}

function formatAmount(cents: number, currency = 'EGP') {
  return `${toPriceString(cents)} ${currency}`
}

function normalizeQty(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function saleStatusLabel(totalCents: number, paidCents: number) {
  if (totalCents <= 0) return 'Paid'
  if (paidCents <= 0) return 'Unpaid / draft'
  if (paidCents >= totalCents) return 'Paid'
  return 'Partial / debt'
}

export default function AdminSaleForm({ products }: { products: ProductOption[] }) {
  const router = useRouter()
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '')
  const [purchaseDate, setPurchaseDate] = useState<string>(todayInputDate())
  const [buyerQuery, setBuyerQuery] = useState('')
  const [buyerResults, setBuyerResults] = useState<BuyerOption[]>([])
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerOption | null>(null)
  const [buyerSearchBusy, setBuyerSearchBusy] = useState(false)
  const [qty, setQty] = useState<number>(1)
  const [discount, setDiscount] = useState<string>('0.00')
  const [paid, setPaid] = useState<string>('0.00')
  const [paidTouched, setPaidTouched] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId]
  )

  const normalizedQty = useMemo(() => normalizeQty(qty), [qty])

  const subtotalCents = useMemo(() => {
    if (!selectedProduct) return 0
    return normalizedQty * Math.max(0, Number(selectedProduct.price_cents || 0))
  }, [normalizedQty, selectedProduct])

  const discountCents = useMemo(() => {
    return Math.max(0, Math.min(parsePriceToCents(discount), subtotalCents))
  }, [discount, subtotalCents])

  const totalCents = useMemo(() => {
    return Math.max(subtotalCents - discountCents, 0)
  }, [discountCents, subtotalCents])

  const paidCents = useMemo(() => {
    return Math.max(0, Math.min(parsePriceToCents(paid), totalCents))
  }, [paid, totalCents])

  const debtPreviewCents = useMemo(() => {
    return Math.max(totalCents - paidCents, 0)
  }, [paidCents, totalCents])

  const currency = selectedProduct?.currency || 'EGP'
  const stockAfterDelivery = selectedProduct ? Number(selectedProduct.inventory_qty || 0) - normalizedQty : 0
  const stockWarning = Boolean(selectedProduct && normalizedQty > Number(selectedProduct.inventory_qty || 0))
  const statusPreview = saleStatusLabel(totalCents, paidCents)

  useEffect(() => {
    if (!paidTouched) {
      setPaid(toPriceString(totalCents))
    }
  }, [paidTouched, totalCents])

  useEffect(() => {
    const q = buyerQuery.trim()
    if (q.length < 2 || selectedBuyer) {
      setBuyerResults([])
      setBuyerSearchBusy(false)
      return
    }

    let alive = true
    const timer = window.setTimeout(async () => {
      setBuyerSearchBusy(true)
      try {
        const r = await fetch(`/api/members/search?q=${encodeURIComponent(q)}&limit=8`, { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok || !j?.ok) {
          setBuyerResults([])
          return
        }
        setBuyerResults(Array.isArray(j.items) ? (j.items as BuyerOption[]) : [])
      } catch {
        if (alive) setBuyerResults([])
      } finally {
        if (alive) setBuyerSearchBusy(false)
      }
    }, 250)

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [buyerQuery, selectedBuyer])

  function selectBuyer(buyer: BuyerOption) {
    setSelectedBuyer(buyer)
    setBuyerQuery(buyerName(buyer))
    setBuyerResults([])
  }

  function clearBuyer() {
    setSelectedBuyer(null)
    setBuyerQuery('')
    setBuyerResults([])
  }

  function handleProductChange(nextProductId: string) {
    setProductId(nextProductId)
    setPaidTouched(false)
    setStatus({ kind: '', msg: '' })
  }

  function setPaidValue(value: string) {
    setPaid(value)
    setPaidTouched(true)
  }

  function setPaidInFull() {
    setPaid(toPriceString(totalCents))
    setPaidTouched(true)
  }

  function setNoPayment() {
    setPaid('0.00')
    setPaidTouched(true)
  }

  const confirmationItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    const buyerLabel = selectedBuyer ? buyerName(selectedBuyer) : buyerQuery.trim() || 'Unknown buyer'
    return [
      { label: 'Product', value: selectedProduct ? productLabel(selectedProduct) : '—' },
      { label: 'Available stock', value: selectedProduct ? String(selectedProduct.inventory_qty) : '—' },
      { label: 'Quantity', value: String(normalizedQty) },
      { label: 'Stock after delivery', value: selectedProduct ? String(stockAfterDelivery) : '—' },
      { label: 'Unit price', value: selectedProduct ? formatAmount(selectedProduct.price_cents, currency) : '—' },
      { label: 'Subtotal', value: formatAmount(subtotalCents, currency) },
      { label: 'Discount', value: `-${formatAmount(discountCents, currency)}` },
      { label: 'Total', value: formatAmount(totalCents, currency) },
      { label: 'Paid now', value: formatAmount(paidCents, currency) },
      { label: 'Remaining debt', value: formatAmount(debtPreviewCents, currency) },
      { label: 'Payment method', value: PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label || paymentMethod },
      { label: 'Sale status', value: statusPreview },
      { label: 'Buyer', value: buyerLabel },
      { label: 'Purchase date', value: purchaseDate },
      { label: 'Note', value: note.trim() || '—' },
      { label: 'Impact', value: 'A Store sale will be created. Stock will still be reduced only when the sale is marked as delivered.' },
    ]
  }, [buyerQuery, currency, debtPreviewCents, discountCents, normalizedQty, note, paidCents, paymentMethod, purchaseDate, selectedBuyer, selectedProduct, statusPreview, stockAfterDelivery, subtotalCents, totalCents])

  function openConfirmation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus({ kind: '', msg: '' })

    if (!selectedProduct) {
      toast.error('Select a product')
      return
    }
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error('Quantity must be at least 1')
      return
    }
    if (parsePriceToCents(discount) < 0) {
      toast.error('Discount must be zero or more')
      return
    }
    if (parsePriceToCents(paid) < 0) {
      toast.error('Paid amount must be zero or more')
      return
    }

    setConfirmOpen(true)
  }

  async function createSale() {
    if (!selectedProduct || busy) return

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const r = await fetch('/api/store/sales/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          purchase_date: purchaseDate,
          qty: normalizedQty,
          buyer_user_id: selectedBuyer?.user_id ?? null,
          buyer_full_name: selectedBuyer ? null : buyerQuery.trim() || null,
          discount_cents: discountCents,
          paid_cents: paidCents,
          payment_method: paymentMethod,
          note: note.trim() || null,
        }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Sale creation failed'
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }

      setConfirmOpen(false)
      setStatus({ kind: 'success', msg: 'Sale created' })
      toast.success('Sale created')
      clearBuyer()
      setPurchaseDate(todayInputDate())
      setQty(1)
      setDiscount('0.00')
      setPaidTouched(false)
      setPaymentMethod('cash')
      setOptionalOpen(false)
      setNote('')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={openConfirmation} className="grid gap-4">
        <InlineAlert compact variant="info">
          Quick sale keeps the sensitive Store logic unchanged. Stock is reduced only when the sale is marked as delivered.
        </InlineAlert>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_120px_160px_170px]">
            <Select
              label="Product / variant *"
              value={productId}
              onChange={(e) => handleProductChange(e.target.value)}
              disabled={busy || products.length === 0}
            >
              {products.length === 0 ? <option value="">No active products</option> : null}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {productLabel(p)} · stock {p.inventory_qty} · {formatAmount(p.price_cents, p.currency || 'EGP')}
                </option>
              ))}
            </Select>

            <Input
              label="Qty *"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value || 1))}
              disabled={busy || !selectedProduct}
              required
            />

            <Select
              label="Payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              disabled={busy}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>

            <Input
              label="Paid now"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={paid}
              onChange={(e) => setPaidValue(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-2 rounded-2xl bg-[hsl(var(--surface-2))] p-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Stock</div>
                <div className="mt-0.5 font-semibold">{selectedProduct ? selectedProduct.inventory_qty : '—'}</div>
                <div className="text-[11px] text-[hsl(var(--muted))]">After delivery: {selectedProduct ? stockAfterDelivery : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Unit price</div>
                <div className="mt-0.5 font-semibold">{selectedProduct ? formatAmount(selectedProduct.price_cents, currency) : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Total</div>
                <div className="mt-0.5 font-semibold">{formatAmount(totalCents, currency)}</div>
                {discountCents > 0 ? <div className="text-[11px] text-[hsl(var(--muted))]">Discount: -{formatAmount(discountCents, currency)}</div> : null}
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Remaining</div>
                <div className={`mt-0.5 font-semibold ${debtPreviewCents > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatAmount(debtPreviewCents, currency)}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Status</div>
                <div className={`mt-0.5 font-semibold ${debtPreviewCents > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{statusPreview}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={setPaidInFull} disabled={busy || !selectedProduct}>
                Paid in full
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={setNoPayment} disabled={busy || !selectedProduct}>
                No payment
              </Button>
            </div>
          </div>

          {stockWarning ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Quantity is higher than current stock. The sale can be created, but stock application may need review before delivery.
            </div>
          ) : null}
        </div>

        <details
          open={optionalOpen}
          onToggle={(e) => setOptionalOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-3xl border border-[hsl(var(--border))] bg-white p-3"
        >
          <summary className="cursor-pointer list-none text-sm font-semibold">
            Optional sale details
            <span className="ml-2 text-xs font-normal text-[hsl(var(--muted))]">buyer, date, discount, note</span>
          </summary>

          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_180px]">
              <div className="relative">
                <Input
                  label="Buyer (optional)"
                  value={buyerQuery}
                  onChange={(e) => {
                    setBuyerQuery(e.target.value)
                    setSelectedBuyer(null)
                  }}
                  disabled={busy}
                  placeholder="Search member, type buyer name, or leave empty"
                  autoComplete="off"
                />
                {buyerQuery.trim().length >= 2 && !selectedBuyer ? (
                  <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-2xl border border-[hsl(var(--border))] bg-white p-1 shadow-lg">
                    {buyerSearchBusy ? (
                      <div className="px-3 py-2 text-sm text-[hsl(var(--muted))]">Searching…</div>
                    ) : buyerResults.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-[hsl(var(--muted))]">No buyer found.</div>
                    ) : (
                      buyerResults.map((buyer) => (
                        <button
                          key={buyer.user_id}
                          type="button"
                          onClick={() => selectBuyer(buyer)}
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[hsl(var(--bg))]"
                        >
                          <span className="block font-medium">{buyerName(buyer)}</span>
                          <span className="block truncate text-xs text-[hsl(var(--muted))]">{buyerMeta(buyer) || 'No contact details'}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <Input
                label="Purchase date *"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                disabled={busy}
                required
              />

              <Input
                label="Discount (EGP)"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                disabled={busy || !selectedProduct}
                hint="Applied before debt calculation."
              />
            </div>

            {selectedBuyer ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                <div className="min-w-0">
                  <div className="font-semibold">Selected buyer: {buyerName(selectedBuyer)}</div>
                  <div className="truncate text-xs text-emerald-800">{buyerMeta(selectedBuyer) || 'No contact details'}</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={clearBuyer} disabled={busy}>
                  Clear buyer
                </Button>
              </div>
            ) : null}

            <Textarea
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              disabled={busy}
              placeholder="Optional internal note"
            />
          </div>
        </details>

        {status.msg ? (
          <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.msg}</InlineAlert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || !selectedProduct} loading={busy} loadingText="Saving…">
            Review & create sale
          </Button>
        </div>
      </form>

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm sale creation"
        description="Review the sale details before creating it."
        confirmLabel="Confirm & create sale"
        pendingLabel="Creating…"
        pending={busy}
        summaryItems={confirmationItems}
        warning="This creates a Store sale only. Stock reduction remains controlled by the existing delivered sale flow."
        onCancel={() => (busy ? null : setConfirmOpen(false))}
        onConfirm={createSale}
      />
    </>
  )
}
