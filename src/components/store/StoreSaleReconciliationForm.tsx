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
  saleId: string
  buyerLabel: string
  recordedPaidCents: number
  paymentMethod: PaymentMethod | null
  purchaseDate: string
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

export default function StoreSaleReconciliationForm({
  saleId,
  buyerLabel,
  recordedPaidCents,
  paymentMethod,
  purchaseDate,
  currency = 'EGP',
}: Props) {
  const router = useRouter()
  const [actual, setActual] = useState(centsInput(recordedPaidCents))
  const [method, setMethod] = useState<PaymentMethod>(paymentMethod || 'cash')
  const [receivedDate, setReceivedDate] = useState(purchaseDate)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const actualCents = useMemo(() => Math.max(0, parsePriceToCents(actual)), [actual])
  const varianceCents = actualCents - Math.max(0, recordedPaidCents)
  const varianceLabel = `${varianceCents > 0 ? '+' : ''}${toPriceString(varianceCents)} ${currency || 'EGP'}`
  const needsReason = varianceCents !== 0

  async function submit() {
    if (busy) return
    if (!receivedDate) {
      toast.error('Received date is required')
      return
    }
    if (needsReason && !note.trim()) {
      toast.error('A note is required when there is a difference')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/store/sales/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          sale_id: saleId,
          actual_received_cents: actualCents,
          payment_method: method,
          received_date: receivedDate,
          reference: reference.trim() || null,
          note: note.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const message = json?.details || json?.error || 'Reconciliation failed'
        toast.error(message)
        return
      }

      toast.success('Sale reconciliation validated')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Validate actual receipt</div>
          <div className="text-xs text-[hsl(var(--muted))]">{buyerLabel}</div>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-xs font-medium ${varianceCents === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          Variance: {varianceLabel}
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
          disabled={busy}
          hint={`Recorded in app: ${toPriceString(recordedPaidCents)} ${currency || 'EGP'}`}
        />
        <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy}>
          {METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
        <Input label="Actual received date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} disabled={busy} />
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} placeholder="Instapay / bank / POS reference" />
      </div>

      <div className="mt-3">
        <Textarea
          label={needsReason ? 'Difference reason / note (required)' : 'Note'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder={needsReason ? 'Explain the difference before validation.' : 'Optional reconciliation note.'}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={submit} disabled={busy || (needsReason && !note.trim())} loading={busy} loadingText="Validating…">
          Validate reconciliation
        </Button>
      </div>
    </div>
  )
}
