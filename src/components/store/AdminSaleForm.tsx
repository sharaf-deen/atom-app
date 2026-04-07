'use client'

import { useMemo, useState } from 'react'
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

export default function AdminSaleForm({ products }: { products: ProductOption[] }) {
  const router = useRouter()
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '')
  const [buyerFullName, setBuyerFullName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [qty, setQty] = useState<number>(1)
  const [paid, setPaid] = useState<string>('0.00')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId]
  )

  const totalCents = useMemo(() => {
    if (!selectedProduct) return 0
    return Math.max(1, Math.floor(qty || 0)) * Math.max(0, Number(selectedProduct.price_cents || 0))
  }, [qty, selectedProduct])

  const debtPreviewCents = useMemo(() => {
    const paidCents = parsePriceToCents(paid)
    return Math.max(totalCents - Math.max(0, Math.min(paidCents, totalCents)), 0)
  }, [paid, totalCents])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) {
      toast.error('Select a product')
      return
    }
    if (!buyerFullName.trim()) {
      toast.error('Buyer name is required')
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
          buyer_full_name: buyerFullName.trim(),
          buyer_email: buyerEmail.trim() || null,
          buyer_phone: buyerPhone.trim() || null,
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
      setBuyerFullName('')
      setBuyerEmail('')
      setBuyerPhone('')
      setQty(1)
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
        Stock is reduced only when the sale is marked as delivered.
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

        <Input
          label="Buyer name *"
          value={buyerFullName}
          onChange={(e) => setBuyerFullName(e.target.value)}
          disabled={busy}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Buyer email"
          type="email"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          disabled={busy}
        />
        <Input
          label="Buyer phone"
          value={buyerPhone}
          onChange={(e) => setBuyerPhone(e.target.value)}
          disabled={busy}
        />
        <Input
          label="Quantity *"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value || 1))}
          disabled={busy || !selectedProduct}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <div className="mt-1 font-medium">Total: {toPriceString(totalCents)} {selectedProduct?.currency || 'EGP'}</div>
          <div className="mt-1 text-[hsl(var(--muted))]">Debt after save: {toPriceString(debtPreviewCents)} {selectedProduct?.currency || 'EGP'}</div>
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
        <Button type="submit" disabled={busy || !selectedProduct || !buyerFullName.trim()} loading={busy} loadingText="Saving…">
          Create sale
        </Button>
      </div>
    </form>
  )
}
