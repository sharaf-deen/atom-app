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
type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'

type ProductOption = {
  id: string
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
  allow_preorder: boolean
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

const PREORDER_STATUSES: Array<{ value: PreorderStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'ordered_from_supplier', label: 'Ordered from supplier' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

function paymentMethodLabel(value: PaymentMethod | null | undefined) {
  if (!value) return '—'
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value
}

function preorderStatusLabel(value: PreorderStatus | null | undefined) {
  if (!value) return '—'
  return PREORDER_STATUSES.find((status) => status.value === value)?.label ?? value
}

function productLabel(p: ProductOption) {
  const bits = [p.name, p.color || null, p.size || null].filter(Boolean)
  return bits.join(' · ')
}

function buyerName(buyer: BuyerOption) {
  const name = [buyer.first_name, buyer.last_name]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
  return name || buyer.email || buyer.member_id || 'Member'
}

function buyerMeta(buyer: BuyerOption) {
  return [buyer.member_id ? `ID ${buyer.member_id}` : null, buyer.email || null, buyer.phone || null]
    .filter(Boolean)
    .join(' · ')
}

function normalizeQty(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function formatAmount(cents: number, currency = 'EGP') {
  return `${toPriceString(cents)} ${currency}`
}

function depositStatusLabel(totalCents: number, depositCents: number) {
  if (totalCents <= 0) return 'No balance'
  if (depositCents <= 0) return 'No deposit'
  if (depositCents >= totalCents) return 'Deposit paid in full'
  return 'Balance due'
}

export default function AdminPreorderForm({ products }: { products: ProductOption[] }) {
  const router = useRouter()
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '')
  const [buyerQuery, setBuyerQuery] = useState('')
  const [buyerResults, setBuyerResults] = useState<BuyerOption[]>([])
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerOption | null>(null)
  const [buyerSearchBusy, setBuyerSearchBusy] = useState(false)
  const [qty, setQty] = useState<number>(1)
  const [deposit, setDeposit] = useState<string>('0.00')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [preorderStatus, setPreorderStatus] = useState<PreorderStatus>('confirmed')
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })
  const [confirmOpen, setConfirmOpen] = useState(false)

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId]
  )

  const normalizedQty = useMemo(() => normalizeQty(qty), [qty])

  const totalCents = useMemo(() => {
    if (!selectedProduct) return 0
    return normalizedQty * Math.max(0, Number(selectedProduct.price_cents || 0))
  }, [normalizedQty, selectedProduct])

  const depositCents = useMemo(() => {
    return Math.max(0, Math.min(parsePriceToCents(deposit), totalCents))
  }, [deposit, totalCents])

  const balancePreviewCents = useMemo(() => {
    return Math.max(totalCents - depositCents, 0)
  }, [depositCents, totalCents])

  const currency = selectedProduct?.currency || 'EGP'
  const depositPreviewLabel = depositStatusLabel(totalCents, depositCents)

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
    setStatus({ kind: '', msg: '' })
  }

  function setDepositValue(value: string) {
    setDeposit(value)
    setStatus({ kind: '', msg: '' })
  }

  function setDepositPaidInFull() {
    setDeposit(toPriceString(totalCents))
    setStatus({ kind: '', msg: '' })
  }

  function setNoDeposit() {
    setDeposit('0.00')
    setStatus({ kind: '', msg: '' })
  }

  const confirmationItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    return [
      { label: 'Customer', value: selectedBuyer ? buyerName(selectedBuyer) : '—' },
      { label: 'Product', value: selectedProduct ? productLabel(selectedProduct) : '—' },
      { label: 'Current stock', value: selectedProduct ? String(selectedProduct.inventory_qty) : '—' },
      { label: 'Preorder enabled', value: selectedProduct?.allow_preorder ? 'Yes' : 'No' },
      { label: 'Quantity', value: String(normalizedQty) },
      { label: 'Unit price', value: selectedProduct ? formatAmount(selectedProduct.price_cents, currency) : '—' },
      { label: 'Total amount', value: formatAmount(totalCents, currency) },
      { label: 'Deposit paid', value: formatAmount(depositCents, currency) },
      { label: 'Remaining balance', value: formatAmount(balancePreviewCents, currency) },
      { label: 'Deposit payment method', value: depositCents > 0 ? paymentMethodLabel(paymentMethod) : 'No deposit' },
      { label: 'Initial status', value: preorderStatusLabel(preorderStatus) },
      { label: 'Stock impact', value: 'None — preorder only' },
      { label: 'Note', value: note.trim() || '—' },
    ]
  }, [balancePreviewCents, currency, depositCents, normalizedQty, note, paymentMethod, preorderStatus, selectedBuyer, selectedProduct, totalCents])

  function openCreateConfirmation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return

    setStatus({ kind: '', msg: '' })

    if (!selectedProduct) {
      toast.error('Select a preorder product')
      return
    }
    if (!selectedProduct.allow_preorder) {
      toast.error('This product is not enabled for preorders')
      return
    }
    if (!selectedBuyer) {
      toast.error('Select a member for the preorder')
      return
    }
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error('Quantity must be at least 1')
      return
    }
    if (parsePriceToCents(deposit) < 0) {
      toast.error('Deposit must be zero or more')
      return
    }

    setConfirmOpen(true)
  }

  async function createPreorder() {
    if (!selectedProduct || !selectedBuyer || busy) return

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const r = await fetch('/api/store/preorders/admin-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          qty: normalizedQty,
          buyer_user_id: selectedBuyer.user_id,
          deposit_cents: depositCents,
          deposit_payment_method: depositCents > 0 ? paymentMethod : null,
          status: preorderStatus,
          note: note.trim() || null,
        }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Preorder creation failed'
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }

      setConfirmOpen(false)
      setStatus({ kind: 'success', msg: 'Preorder created' })
      toast.success('Preorder created')
      clearBuyer()
      setProductId(products[0]?.id ?? '')
      setQty(1)
      setDeposit('0.00')
      setPaymentMethod('cash')
      setPreorderStatus('confirmed')
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
      <form onSubmit={openCreateConfirmation} className="grid gap-4">
        <InlineAlert compact variant="info">
          Admin preorders must be linked to an existing member. They do not reduce stock. Use Complete & create sale when the item is delivered.
        </InlineAlert>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_120px_minmax(0,1.1fr)_170px]">
            <Select
              label="Product / variant *"
              value={productId}
              onChange={(e) => handleProductChange(e.target.value)}
              disabled={busy || products.length === 0}
            >
              {products.length === 0 ? <option value="">No preorder-enabled products</option> : null}
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

            <div className="relative">
              <Input
                label="Member buyer *"
                value={buyerQuery}
                onChange={(e) => {
                  setBuyerQuery(e.target.value)
                  setSelectedBuyer(null)
                }}
                disabled={busy}
                placeholder="Search member by name, email, phone, or ID"
                autoComplete="off"
                required
              />
              {buyerQuery.trim().length >= 2 && !selectedBuyer ? (
                <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-2xl border border-[hsl(var(--border))] bg-white p-1 shadow-lg">
                  {buyerSearchBusy ? (
                    <div className="px-3 py-2 text-sm text-[hsl(var(--muted))]">Searching…</div>
                  ) : buyerResults.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-[hsl(var(--muted))]">No member found.</div>
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
              label="Deposit now"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={deposit}
              onChange={(e) => setDepositValue(e.target.value)}
              disabled={busy || !selectedProduct}
            />
          </div>

          {selectedBuyer ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              <div className="min-w-0">
                <div className="font-semibold">Selected member: {buyerName(selectedBuyer)}</div>
                <div className="truncate text-xs text-emerald-800">{buyerMeta(selectedBuyer) || 'No contact details'}</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={clearBuyer} disabled={busy}>
                Clear member
              </Button>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-2 rounded-2xl bg-[hsl(var(--surface-2))] p-3 text-sm sm:grid-cols-2 xl:grid-cols-6">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Stock</div>
                <div className="mt-0.5 font-semibold">{selectedProduct ? selectedProduct.inventory_qty : '—'}</div>
                <div className="text-[11px] text-[hsl(var(--muted))]">No stock impact</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Unit price</div>
                <div className="mt-0.5 font-semibold">{selectedProduct ? formatAmount(selectedProduct.price_cents, currency) : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Total</div>
                <div className="mt-0.5 font-semibold">{formatAmount(totalCents, currency)}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Deposit</div>
                <div className="mt-0.5 font-semibold text-sky-700">{formatAmount(depositCents, currency)}</div>
                <div className="text-[11px] text-[hsl(var(--muted))]">{depositCents > 0 ? paymentMethodLabel(paymentMethod) : 'No payment method'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Balance</div>
                <div className={`mt-0.5 font-semibold ${balancePreviewCents > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {formatAmount(balancePreviewCents, currency)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Preview</div>
                <div className={`mt-0.5 font-semibold ${balancePreviewCents > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{depositPreviewLabel}</div>
                <div className="text-[11px] text-[hsl(var(--muted))]">Initial status: {preorderStatusLabel(preorderStatus)}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={setDepositPaidInFull} disabled={busy || !selectedProduct}>
                Deposit paid in full
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={setNoDeposit} disabled={busy || !selectedProduct}>
                No deposit
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Select
              label="Deposit payment method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              disabled={busy || depositCents <= 0}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>

            <div className="rounded-2xl border border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
              <div className="font-semibold text-black">Preorder status</div>
              <div className="mt-1">Stock: {selectedProduct ? selectedProduct.inventory_qty : '—'} · Preorder enabled: {selectedProduct?.allow_preorder ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>

        <details
          open={optionalOpen}
          onToggle={(e) => setOptionalOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-3xl border border-[hsl(var(--border))] bg-white p-3"
        >
          <summary className="cursor-pointer list-none text-sm font-semibold">
            Optional preorder details
            <span className="ml-2 text-xs font-normal text-[hsl(var(--muted))]">initial status, note</span>
          </summary>

          <div className="mt-3 grid gap-3">
            <Select
              label="Initial status"
              value={preorderStatus}
              onChange={(e) => setPreorderStatus(e.target.value as PreorderStatus)}
              disabled={busy}
            >
              {PREORDER_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>

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
          <Button type="submit" disabled={busy || !selectedProduct || !selectedBuyer} loading={busy} loadingText="Saving…">
            Review & create preorder
          </Button>
        </div>
      </form>

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm preorder creation"
        description="Review the preorder before creating it. This does not reduce stock."
        confirmLabel="Confirm & create preorder"
        pendingLabel="Creating…"
        pending={busy}
        onCancel={() => (busy ? null : setConfirmOpen(false))}
        onConfirm={createPreorder}
        summaryItems={confirmationItems}
        warning="This creates a Store preorder only. Stock stays unchanged until the existing Complete & create sale flow is used."
      />
    </>
  )
}
