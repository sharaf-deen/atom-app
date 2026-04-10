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
type SaleStatus = 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

const SALE_STATUSES: Array<{ value: SaleStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'partial_paid', label: 'Partial paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'canceled', label: 'Canceled' },
]

export default function AdminSaleQuickEdit({
  id,
  totalCents,
  paidCents,
  debtCents,
  paymentMethod,
  status,
  note,
}: {
  id: string
  totalCents: number
  paidCents: number
  debtCents: number
  paymentMethod: PaymentMethod | null
  status: SaleStatus
  note: string | null
}) {
  const router = useRouter()
  const [paid, setPaid] = useState<string>(toPriceString(paidCents))
  const [method, setMethod] = useState<PaymentMethod>(paymentMethod ?? 'cash')
  const [saleStatus, setSaleStatus] = useState<SaleStatus>(status)
  const [internalNote, setInternalNote] = useState(note ?? '')
  const [busy, setBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [err, setErr] = useState('')

  const nextPaidCents = useMemo(() => {
    const cents = parsePriceToCents(paid)
    return Math.max(0, Math.min(cents, totalCents))
  }, [paid, totalCents])

  const nextDebtCents = useMemo(() => Math.max(totalCents - nextPaidCents, 0), [totalCents, nextPaidCents])

  const dirty = useMemo(() => {
    return (
      nextPaidCents !== paidCents ||
      method !== (paymentMethod ?? 'cash') ||
      saleStatus !== status ||
      (internalNote || '') !== (note || '')
    )
  }, [nextPaidCents, paidCents, method, paymentMethod, saleStatus, status, internalNote, note])

  const statusLocked = status === 'delivered' || status === 'canceled'
  const canDelete = status === 'draft' || status === 'canceled'

  async function save() {
    if (!dirty || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/store/sales/admin-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          paid_cents: nextPaidCents,
          payment_method: method,
          status: saleStatus,
          note: internalNote.trim() || null,
        }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Update failed'
        setErr(msg)
        toast.error(msg)
        return
      }
      toast.success('Sale updated')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      setErr(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function removeSale() {
    if (!canDelete || deleteBusy) return
    const ok = globalThis.confirm('Delete this sale? Only draft or canceled sales can be deleted.')
    if (!ok) return

    setDeleteBusy(true)
    setErr('')
    try {
      const r = await fetch(`/api/store/sales/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Delete failed'
        setErr(msg)
        toast.error(msg)
        return
      }
      toast.success('Sale deleted')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      setErr(msg)
      toast.error(msg)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Paid"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
          disabled={busy || deleteBusy}
        />

        <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy || deleteBusy}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>

        <Select
          label="Status"
          value={saleStatus}
          onChange={(e) => setSaleStatus(e.target.value as SaleStatus)}
          disabled={busy || deleteBusy || statusLocked}
        >
          {SALE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <Textarea
        label="Internal note"
        rows={2}
        value={internalNote}
        onChange={(e) => setInternalNote(e.target.value)}
        disabled={busy || deleteBusy}
      />

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3 text-sm">
        <div>Total: {toPriceString(totalCents)} EGP</div>
        <div>Current debt: {toPriceString(debtCents)} EGP</div>
        <div>Next debt after save: {toPriceString(nextDebtCents)} EGP</div>
      </div>

      {statusLocked ? (
        <InlineAlert compact variant="info">
          {status === 'delivered'
            ? 'Delivered sales stay delivered. You can still adjust paid amount, payment method, and note.'
            : 'Canceled sales stay canceled. You can still update note and payment details if needed.'}
        </InlineAlert>
      ) : null}

      {!canDelete ? (
        <InlineAlert compact variant="info">
          Only draft or canceled sales can be deleted.
        </InlineAlert>
      ) : null}

      {err ? <InlineAlert variant="error">{err}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty || busy || deleteBusy} loading={busy} loadingText="Saving…">
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={removeSale}
          disabled={!canDelete || busy || deleteBusy}
          loading={deleteBusy}
          loadingText="Deleting…"
        >
          Delete sale
        </Button>
      </div>
    </div>
  )
}
