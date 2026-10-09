'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { parsePriceToCents, toPriceString } from '@/lib/money'

type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'

type Props = {
  reconciliationId: string
  recordedPaidCents: number
  actualReceivedCents: number
  paymentMethod: PaymentMethod | null
  receivedDate: string
  reference: string | null
  note: string | null
  currency?: string | null
}

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

function centsInput(cents: number) {
  return (Math.max(0, Math.floor(Number(cents || 0))) / 100).toFixed(2)
}

export default function StoreSaleReconciliationEdit({
  reconciliationId,
  recordedPaidCents,
  actualReceivedCents,
  paymentMethod,
  receivedDate,
  reference,
  note,
  currency = 'EGP',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [actual, setActual] = useState(centsInput(actualReceivedCents))
  const [method, setMethod] = useState<PaymentMethod>(paymentMethod || 'cash')
  const [date, setDate] = useState(receivedDate)
  const [referenceValue, setReferenceValue] = useState(reference || '')
  const [noteValue, setNoteValue] = useState(note || '')
  const [busy, setBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const actualCents = useMemo(() => Math.max(0, parsePriceToCents(actual)), [actual])
  const varianceCents = actualCents - Math.max(0, recordedPaidCents)
  const needsReason = varianceCents !== 0

  async function save() {
    if (busy || deleteBusy) return
    if (!date) {
      toast.error('Received date is required')
      return
    }
    if (needsReason && !noteValue.trim()) {
      toast.error('A note is required when there is a difference')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/store/sales/reconciliation-entry', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          reconciliation_id: reconciliationId,
          actual_received_cents: actualCents,
          payment_method: method,
          received_date: date,
          reference: referenceValue.trim() || null,
          note: noteValue.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        toast.error(json?.details || json?.error || 'Reconciliation update failed')
        return
      }

      toast.success('Reconciliation updated')
      setOpen(false)
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy || deleteBusy) return
    const confirmed = window.confirm(
      'Delete this reconciliation entry? This removes only the reconciliation line. The Store sale will remain and can then be deleted separately if needed.'
    )
    if (!confirmed) return

    setDeleteBusy(true)
    try {
      const res = await fetch('/api/store/sales/reconciliation-entry', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ reconciliation_id: reconciliationId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        toast.error(json?.details || json?.error || 'Reconciliation delete failed')
        return
      }

      toast.success('Reconciliation entry deleted')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          Edit reconciliation
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={remove} disabled={deleteBusy} loading={deleteBusy} loadingText="Deleting…">
          Delete reconciliation
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Edit reconciliation</div>
          <div className="text-xs text-[hsl(var(--muted))]">
            Sale link and recorded paid snapshot stay unchanged.
          </div>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-xs font-medium ${varianceCents === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          Variance: {varianceCents > 0 ? '+' : ''}{toPriceString(varianceCents)} {currency || 'EGP'}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Input
          label="Actual received (EGP)"
          type="number"
          min="0"
          step="0.01"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          disabled={busy || deleteBusy}
          hint={`Recorded snapshot: ${toPriceString(recordedPaidCents)} ${currency || 'EGP'}`}
        />
        <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy || deleteBusy}>
          {METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
        <Input label="Actual received date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy || deleteBusy} />
        <Input label="Reference" value={referenceValue} onChange={(e) => setReferenceValue(e.target.value)} disabled={busy || deleteBusy} placeholder="Instapay / bank / POS reference" />
      </div>

      <div className="mt-3">
        <Textarea
          label={needsReason ? 'Difference reason / note (required)' : 'Note'}
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={3}
          disabled={busy || deleteBusy}
        />
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" onClick={remove} disabled={busy || deleteBusy} loading={deleteBusy} loadingText="Deleting…">
          Delete reconciliation
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy || deleteBusy}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={busy || deleteBusy || (needsReason && !noteValue.trim())} loading={busy} loadingText="Saving…">
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
