'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import InlineAlert from '@/components/ui/InlineAlert'
import { formatCurrency } from '@/lib/money'

type Product = {
  id: string
  category: 'kimono' | 'rashguard' | 'short' | 'belt'
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  is_active: boolean
  allow_preorder: boolean
}

export default function StorePreorderAction({ product }: { product: Product }) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  const total = useMemo(() => {
    const safeQty = Math.max(1, Number(qty || 1))
    return formatCurrency((product.price_cents ?? 0) * safeQty, 'en-EG', product.currency ?? 'EGP')
  }, [product.currency, product.price_cents, qty])

  const blocked = !product.is_active || !product.allow_preorder

  async function submitPreorder() {
    if (busy || blocked) return
    setBusy(true)
    setStatus({ kind: '', msg: '' })

    try {
      const res = await fetch('/api/store/preorders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.id,
          qty: Math.max(1, Number(qty || 1)),
          note: note.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Failed to create preorder'
        setStatus({ kind: 'error', msg })
        toast.error('Pre-order failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Pre-order sent successfully.' })
      setNote('')
      setQty(1)
      setOpen(false)
      window.dispatchEvent(new CustomEvent('store:preorder:created'))
      toast.success('Pre-order sent')
    } catch (e: any) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'error', msg })
      toast.error('Pre-order failed')
    } finally {
      setBusy(false)
    }
  }

  if (blocked) {
    return (
      <InlineAlert variant="warning" compact>
        This product is not available for preorder right now.
      </InlineAlert>
    )
  }

  return (
    <div className="space-y-3">
      {open ? (
        <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Quantity"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value || 1)))}
              disabled={busy}
            />
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-2">
              <div className="text-xs text-[hsl(var(--muted))]">Estimated total</div>
              <div className="mt-1 text-sm font-semibold">{total}</div>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 400))}
              placeholder="Optional note"
              className="min-h-[88px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              disabled={busy}
            />
          </label>

          {status.msg ? (
            <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'} compact>
              {status.msg}
            </InlineAlert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={submitPreorder} loading={busy} loadingText="Sending…">
              Confirm pre-order
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (busy) return
                setOpen(false)
                setStatus({ kind: '', msg: '' })
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => setOpen(true)}>
            Pre-order
          </Button>
          <div className="text-xs text-[hsl(var(--muted))]">Simple request. Payment later.</div>
        </div>
      )}

      {!open && status.msg ? (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'} compact>
          {status.msg}
        </InlineAlert>
      ) : null}
    </div>
  )
}
