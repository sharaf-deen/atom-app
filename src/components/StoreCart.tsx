'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/money'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'

type Variant = {
  color?: string
  size?: string
}

type CartLine = {
  product_id: string
  name: string
  unit_price_cents: number
  qty: number
  currency?: string | null
  variant?: Variant
}

type CartAddEvent = CustomEvent<{
  product_id: string
  qty: number
  product?: {
    id: string
    name: string
    price_cents: number
    currency?: string | null
  }
  variant?: Variant
}>

type CartMetaEvent = CustomEvent<{
  payment?: 'cash'|'card'|'bank_transfer'|'instapay'
  note?: string
}>

const PAYMENT_METHODS = [
  { v: 'cash', label: 'Cash' },
  { v: 'card', label: 'Visa / Card' },
  { v: 'bank_transfer', label: 'Bank transfer' },
  { v: 'instapay', label: 'Instapay' },
] as const

export default function StoreCart() {
  const [lines, setLines] = useState<CartLine[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [payment, setPayment] = useState<'cash'|'card'|'bank_transfer'|'instapay'>('cash')
  const [note, setNote] = useState('')

  // Écoute évènements venant du catalogue
  useEffect(() => {
    function onAdd(e: Event) {
      const ev = e as CartAddEvent
      const { product_id, qty, product, variant } = ev.detail || {}
      if (!product_id || !qty) return

      setLines((prev) => {
        // Merge seulement si même produit + même variante
        const key = (v?: Variant) => `${v?.color || ''}__${v?.size || ''}`
        const idx = prev.findIndex(
          (l) => l.product_id === product_id && key(l.variant) === key(variant)
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], qty: next[idx].qty + qty }
          return next
        }
        return [
          ...prev,
          {
            product_id,
            name: product?.name ?? 'Item',
            unit_price_cents: Number(product?.price_cents ?? 0),
            currency: product?.currency ?? 'EGP',
            qty,
            variant: variant && (variant.color || variant.size) ? variant : undefined,
          },
        ]
      })
    }
    function onMeta(e: Event) {
      const ev = e as CartMetaEvent
      if (ev.detail?.payment) setPayment(ev.detail.payment)
      if (typeof ev.detail?.note === 'string') setNote(ev.detail.note)
    }

    window.addEventListener('cart:add', onAdd as EventListener)
    window.addEventListener('cart:set-meta', onMeta as EventListener)
    return () => {
      window.removeEventListener('cart:add', onAdd as EventListener)
      window.removeEventListener('cart:set-meta', onMeta as EventListener)
    }
  }, [])

  function inc(id: string, v?: Variant) {
    setLines((prev) =>
      prev.map((l) =>
        l.product_id === id && (l.variant?.color || '') === (v?.color || '') && (l.variant?.size || '') === (v?.size || '')
          ? { ...l, qty: l.qty + 1 }
          : l
      )
    )
  }
  function dec(id: string, v?: Variant) {
    setLines((prev) =>
      prev
        .map((l) =>
          l.product_id === id && (l.variant?.color || '') === (v?.color || '') && (l.variant?.size || '') === (v?.size || '')
            ? { ...l, qty: Math.max(1, l.qty - 1) }
            : l
        )
        .filter((l) => l.qty > 0)
    )
  }
  function removeLine(id: string, v?: Variant) {
    setLines((prev) =>
      prev.filter(
        (l) =>
          !(l.product_id === id &&
            (l.variant?.color || '') === (v?.color || '') &&
            (l.variant?.size || '') === (v?.size || ''))
      )
    )
  }
  function clear() {
    setLines([])
    setNote('')
  }

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unit_price_cents * l.qty, 0),
    [lines]
  )

  async function checkout() {
    if (lines.length === 0) return
    setBusy(true)
    setMsg('')
    try {
      // Compose une note enrichie avec les variantes (non-breaking avec API actuelle)
      const variantSummary = lines
        .map((l) => {
          const parts = []
          if (l.variant?.color) parts.push(`Color: ${l.variant.color}`)
          if (l.variant?.size) parts.push(`Size: ${l.variant.size}`)
          return parts.length ? `${l.name} — ${parts.join(', ')}` : ''
        })
        .filter(Boolean)
        .join('; ')
      const finalNote = [note.trim(), variantSummary ? `Items details: ${variantSummary}` : '']
        .filter(Boolean)
        .join(' | ')

      const payload = {
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        preferred_payment: payment,
        note: finalNote || undefined,
      }
      const r = await fetch('/api/store/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Order failed')
        return
      }
      const totalStr = formatCurrency(Number(j.total_cents ?? 0), 'en-EG', 'EGP')
      const disc = Number(j.discount_pct ?? 0)
      setMsg(`Order placed. ${disc ? `Discount ${disc}% applied. ` : ''}Total = ${totalStr}.`)
      clear()
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (lines.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="mt-3 text-sm text-[hsl(var(--muted))]">Your cart is empty.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Cart</h2>
        </div>

        <div className="mt-4 space-y-3">
          {lines.map((l) => {
            const lineTotal = l.unit_price_cents * l.qty
            return (
              <div
                key={`${l.product_id}__${l.variant?.color || ''}__${l.variant?.size || ''}`}
                className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-soft"
              >
                <div className="flex-1">
                  <div className="font-medium">{l.name}</div>
                  {!!(l.variant?.color || l.variant?.size) && (
                    <div className="text-xs text-[hsl(var(--muted))]">
                      {[l.variant?.color, l.variant?.size].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div className="text-xs text-[hsl(var(--muted))] mt-0.5">
                    Unit: {formatCurrency(l.unit_price_cents, 'en-EG', l.currency || 'EGP')}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dec(l.product_id, l.variant)}
                      aria-label="Decrease quantity"
                    >
                      −
                    </Button>
                    <span className="w-8 text-center">{l.qty}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inc(l.product_id, l.variant)}
                      aria-label="Increase quantity"
                    >
                      +
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600"
                      onClick={() => removeLine(l.product_id, l.variant)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-[hsl(var(--muted))]">Line total</div>
                  <div className="font-semibold">
                    {formatCurrency(lineTotal, 'en-EG', l.currency || 'EGP')}
                  </div>
                </div>
              </div>
            )
          })}

          <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
            <div className="text-sm text-[hsl(var(--muted))]">Subtotal</div>
            <div className="text-lg font-semibold">
              {formatCurrency(subtotal, 'en-EG', 'EGP')}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Preferred payment"
              value={payment}
              onChange={(e) => setPayment(e.target.value as any)}
              disabled={busy}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.v} value={m.v}>{m.label}</option>
              ))}
            </Select>

            <Input
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="E.g. size exchange, pickup time…"
              disabled={busy}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={checkout} disabled={busy || lines.length === 0}>
              {busy ? 'Placing…' : 'Place order'}
            </Button>
            <Button variant="outline" onClick={clear} disabled={busy || lines.length === 0}>
              Clear
            </Button>
            {msg && <span className="text-xs text-[hsl(var(--muted))]">{msg}</span>}
          </div>

          <p className="text-xs text-[hsl(var(--muted))]">
            After placing your order, please pay in cash or card at the gym, or via bank transfer / Instapay.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
