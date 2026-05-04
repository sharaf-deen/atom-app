'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import InlineAlert from '@/components/ui/InlineAlert'
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

export default function AdminSaleForm({ products }: { products: ProductOption[] }) {
  const router = useRouter()
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '')
  const [buyerQuery, setBuyerQuery] = useState('')
  const [buyerResults, setBuyerResults] = useState<BuyerOption[]>([])
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerOption | null>(null)
  const [buyerSearchBusy, setBuyerSearchBusy] = useState(false)
  const [qty, setQty] = useState<number>(1)
  const [discount, setDiscount] = useState<string>('0.00')
  const [paid, setPaid] = useState<string>('0.00')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId]
  )

  const subtotalCents = useMemo(() => {
    if (!selectedProduct) return 0
    return Math.max(1, Math.floor(qty || 0)) * Math.max(0, Number(selectedProduct.price_cents || 0))
  }, [qty, selectedProduct])

  const discountCents = useMemo(() => {
    return Math.max(0, Math.min(parsePriceToCents(discount), subtotalCents))
  }, [discount, subtotalCents])

  const totalCents = useMemo(() => {
    return Math.max(subtotalCents - discountCents, 0)
  }, [discountCents, subtotalCents])

  const debtPreviewCents = useMemo(() => {
    const paidCents = parsePriceToCents(paid)
    return Math.max(totalCents - Math.max(0, Math.min(paidCents, totalCents)), 0)
  }, [paid, totalCents])

  useEffect(() => {
    const q = buyerQuery.trim()
    if (q.length < 2) {
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
  }, [buyerQuery])

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) {
      toast.error('Select a product')
      return
    }
    if (!selectedBuyer) {
      toast.error('Select a buyer')
      return
    }

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const r = await fetch('/api/store/sales/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          qty: Math.max(1, Math.floor(qty || 0)),
          buyer_user_id: selectedBuyer.user_id,
          discount_cents: discountCents,
          paid_cents: parsePriceToCents(paid),
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

      setStatus({ kind: 'success', msg: 'Sale created' })
      toast.success('Sale created')
      clearBuyer()
      setQty(1)
      setDiscount('0.00')
      setPaid('0.00')
      setPaymentMethod('cash')
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
    <form onSubmit={onSubmit} className="grid gap-4">
      <InlineAlert compact variant="info">
        Select a member as buyer. Stock is reduced only when the sale is marked as delivered.
      </InlineAlert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Product *"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          disabled={busy || products.length === 0}
        >
          {products.length === 0 ? <option value="">No active products</option> : null}
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {productLabel(p)}
            </option>
          ))}
        </Select>

        <div className="relative">
          <Input
            label="Buyer *"
            value={buyerQuery}
            onChange={(e) => {
              setBuyerQuery(e.target.value)
              setSelectedBuyer(null)
            }}
            disabled={busy}
            required
            placeholder="Search by name, email, or member ID"
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
      </div>

      {selectedBuyer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <div className="min-w-0">
            <div className="font-semibold">Selected buyer: {buyerName(selectedBuyer)}</div>
            <div className="truncate text-xs text-emerald-800">{buyerMeta(selectedBuyer) || 'No contact details'}</div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clearBuyer} disabled={busy}>
            Change
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Quantity *"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value || 1))}
          disabled={busy || !selectedProduct}
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
          hint="Applied before calculating debt."
        />
        <Input
          label="Paid now"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Select
          label="Payment method"
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
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3 text-sm">
          <div className="text-[11px] font-medium text-[hsl(var(--muted))]">Preview</div>
          <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            <div>Subtotal: <span className="font-medium">{toPriceString(subtotalCents)} {selectedProduct?.currency || 'EGP'}</span></div>
            <div>Discount: <span className="font-medium">-{toPriceString(discountCents)} {selectedProduct?.currency || 'EGP'}</span></div>
            <div>Total: <span className="font-medium">{toPriceString(totalCents)} {selectedProduct?.currency || 'EGP'}</span></div>
            <div>Debt: <span className="font-medium">{toPriceString(debtPreviewCents)} {selectedProduct?.currency || 'EGP'}</span></div>
          </div>
          {selectedProduct ? (
            <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Current stock: {selectedProduct.inventory_qty}</div>
          ) : null}
        </div>
      </div>

      <Textarea
        label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        disabled={busy}
        placeholder="Optional internal note"
      />

      {status.msg ? (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.msg}</InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !selectedProduct || !selectedBuyer} loading={busy} loadingText="Saving…">
          Create sale
        </Button>
      </div>
    </form>
  )
}
