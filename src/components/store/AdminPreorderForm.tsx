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

  const depositCents = useMemo(() => {
    return Math.max(0, Math.min(parsePriceToCents(deposit), totalCents))
  }, [deposit, totalCents])

  const balancePreviewCents = useMemo(() => {
    return Math.max(totalCents - depositCents, 0)
  }, [depositCents, totalCents])

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) {
      toast.error('Select a preorder product')
      return
    }
    if (!selectedBuyer) {
      toast.error('Select a member for the preorder')
      return
    }

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const r = await fetch('/api/store/preorders/admin-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          qty: Math.max(1, Math.floor(qty || 0)),
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

      setStatus({ kind: 'success', msg: 'Preorder created' })
      toast.success('Preorder created')
      clearBuyer()
      setProductId(products[0]?.id ?? '')
      setQty(1)
      setDeposit('0.00')
      setPaymentMethod('cash')
      setPreorderStatus('confirmed')
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
        Admin preorders must be linked to an existing member. They do not reduce stock. Use sales when the item is sold and delivered from current stock.
      </InlineAlert>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_minmax(0,1.2fr)]">
        <Select
          label="Product *"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          disabled={busy || products.length === 0}
        >
          {products.length === 0 ? <option value="">No preorder-enabled products</option> : null}
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {productLabel(p)}
            </option>
          ))}
        </Select>

        <Input
          label="Quantity *"
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
      </div>

      {selectedBuyer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <div className="min-w-0">
            <div className="font-semibold">Selected member: {buyerName(selectedBuyer)}</div>
            <div className="truncate text-xs text-emerald-800">{buyerMeta(selectedBuyer) || 'No contact details'}</div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clearBuyer} disabled={busy}>
            Clear member
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Input
          label="Deposit now (EGP)"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          disabled={busy || !selectedProduct}
          hint="Cannot exceed preorder total."
        />
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
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3 text-sm">
        <div className="text-[11px] font-medium text-[hsl(var(--muted))]">Preview</div>
        <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          <div>Total: <span className="font-medium">{toPriceString(totalCents)} {selectedProduct?.currency || 'EGP'}</span></div>
          <div>Deposit: <span className="font-medium">{toPriceString(depositCents)} {selectedProduct?.currency || 'EGP'}</span></div>
          <div>Balance: <span className="font-medium">{toPriceString(balancePreviewCents)} {selectedProduct?.currency || 'EGP'}</span></div>
          <div>Stock impact: <span className="font-medium">None</span></div>
        </div>
        {selectedProduct ? (
          <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Current stock: {selectedProduct.inventory_qty} · Preorder enabled</div>
        ) : null}
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
          Create preorder
        </Button>
      </div>
    </form>
  )
}
