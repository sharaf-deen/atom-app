'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { parsePriceToCents, toPriceString } from '@/lib/money'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type SupplierOrderStatus = 'draft' | 'ordered' | 'canceled'

type ProductOption = {
  id: string
  name: string
  category: Category
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  is_active: boolean
}

type LineState = {
  key: string
  productId: string
  orderedQty: number
  unitCost: string
}

const STATUS_OPTIONS: Array<{ value: SupplierOrderStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'canceled', label: 'Canceled' },
]

function makeLine(): LineState {
  return {
    key: Math.random().toString(36).slice(2),
    productId: '',
    orderedQty: 1,
    unitCost: '0.00',
  }
}

function productLabel(product: ProductOption) {
  const parts = [product.name, product.size, product.color].filter(Boolean)
  return parts.join(' — ')
}

export default function SupplierOrderForm({
  products,
}: {
  products: ProductOption[]
}) {
  const router = useRouter()
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const [reference, setReference] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [status, setStatus] = useState<SupplierOrderStatus>('ordered')
  const [expectedAt, setExpectedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineState[]>([makeLine()])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line
        const next = { ...line, ...patch }
        if (patch.productId) {
          const product = productMap.get(patch.productId)
          if (product) next.unitCost = toPriceString(product.price_cents)
        }
        return next
      })
    )
  }

  function addLine() {
    setLines((current) => [...current, makeLine()])
  }

  function removeLine(key: string) {
    setLines((current) => (current.length <= 1 ? current : current.filter((line) => line.key !== key)))
  }

  const linePreview = useMemo(() => {
    return lines
      .map((line) => {
        const product = productMap.get(line.productId)
        const qty = Math.max(0, Number(line.orderedQty || 0))
        const unitCostCents = Math.max(0, parsePriceToCents(line.unitCost))
        return {
          key: line.key,
          product,
          qty,
          unitCostCents,
          subtotalCents: qty * unitCostCents,
        }
      })
      .filter((line) => line.product)
  }, [lines, productMap])

  const totalCents = linePreview.reduce((sum, line) => sum + line.subtotalCents, 0)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    const items = lines
      .map((line) => ({
        product_id: line.productId,
        ordered_qty: Math.max(0, Math.floor(Number(line.orderedQty || 0))),
        unit_cost_cents: Math.max(0, parsePriceToCents(line.unitCost)),
      }))
      .filter((line) => line.product_id && line.ordered_qty > 0)

    if (!supplierName.trim()) {
      setFeedback({ kind: 'error', msg: 'Supplier name is required.' })
      toast.error('Supplier name is required')
      return
    }

    if (items.length === 0) {
      setFeedback({ kind: 'error', msg: 'Add at least one valid supplier-order line.' })
      toast.error('Add at least one valid line')
      return
    }

    setBusy(true)
    setFeedback({ kind: '', msg: '' })

    try {
      const response = await fetch('/api/store/supplier-orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: reference.trim() || null,
          supplier_name: supplierName.trim(),
          status,
          expected_at: expectedAt || null,
          notes: notes.trim() || null,
          items,
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        const message = json?.details || json?.error || 'Supplier order creation failed'
        setFeedback({ kind: 'error', msg: message })
        toast.error('Supplier order creation failed')
        return
      }

      setFeedback({ kind: 'success', msg: 'Supplier order created.' })
      toast.success('Supplier order created')
      setReference('')
      setSupplierName('')
      setStatus('ordered')
      setExpectedAt('')
      setNotes('')
      setLines([makeLine()])
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (error: any) {
      const message = String(error?.message || error)
      setFeedback({ kind: 'error', msg: message })
      toast.error('Supplier order creation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Input label="Supplier *" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={busy} />
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as SupplierOrderStatus)} disabled={busy}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Input label="Expected date" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} disabled={busy} />
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
      </div>

      <div className="grid gap-3">
        {lines.map((line, index) => {
          const product = productMap.get(line.productId)
          return (
            <div key={line.key} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Line {index + 1}</div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => removeLine(line.key)} disabled={busy || lines.length <= 1}>
                    Remove
                  </Button>
                  {index === lines.length - 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={addLine} disabled={busy}>
                      Add line
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_140px_140px]">
                <Select
                  label="Catalog product *"
                  value={line.productId}
                  onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                  disabled={busy}
                >
                  <option value="">Select a product</option>
                  {products.map((option) => (
                    <option key={option.id} value={option.id}>
                      {productLabel(option)}
                    </option>
                  ))}
                </Select>

                <Input
                  label="Ordered qty *"
                  type="number"
                  min={1}
                  value={line.orderedQty}
                  onChange={(e) => updateLine(line.key, { orderedQty: Math.max(1, Number(e.target.value || 1)) })}
                  disabled={busy}
                />

                <Input
                  label="Unit cost *"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={line.unitCost}
                  onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                  disabled={busy}
                />
              </div>

              {product ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
                  <span className="rounded-full border px-2 py-1">Product ID: {product.id.slice(0, 8)}</span>
                  <span className="rounded-full border px-2 py-1">Model: {product.name}</span>
                  {product.size ? <span className="rounded-full border px-2 py-1">Size: {product.size}</span> : null}
                  {product.color ? <span className="rounded-full border px-2 py-1">Color: {product.color}</span> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">Estimated supplier total</span>
          <span className="text-base font-semibold">{toPriceString(totalCents)} EGP</span>
        </div>
      </div>

      {feedback.msg ? <InlineAlert variant={feedback.kind === 'error' ? 'error' : 'success'}>{feedback.msg}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !supplierName.trim()}>
          {busy ? 'Saving…' : 'Create supplier order'}
        </Button>
      </div>
    </form>
  )
}
