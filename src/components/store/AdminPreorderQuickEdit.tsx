'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import InlineAlert from '@/components/ui/InlineAlert'
import { STORE_PAYMENT_METHODS, STORE_PREORDER_STATUSES, type StorePaymentMethod, type StorePreorderStatus } from '@/lib/storeV2'

type Props = {
  id: string
  totalCents: number
  depositCents: number
  depositPaymentMethod: StorePaymentMethod | null
  status: StorePreorderStatus
  note?: string | null
}

function centsToAmount(cents: number) {
  const value = Math.max(0, Number(cents || 0)) / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function amountToCents(value: string) {
  const normalized = value.replace(/,/g, '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return NaN
  return Math.round(parsed * 100)
}

function paymentLabel(value: StorePaymentMethod) {
  switch (value) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank transfer'
    case 'card':
      return 'Card'
  }
}

function preorderStatusLabel(value: StorePreorderStatus) {
  switch (value) {
    case 'pending':
      return 'Pending'
    case 'confirmed':
      return 'Confirmed'
    case 'ordered_from_supplier':
      return 'Ordered from supplier'
    case 'ready':
      return 'Ready'
    case 'completed':
      return 'Completed'
    case 'canceled':
      return 'Canceled'
  }
}

export default function AdminPreorderQuickEdit({
  id,
  totalCents,
  depositCents,
  depositPaymentMethod,
  status,
  note,
}: Props) {
  const router = useRouter()
  const [depositAmount, setDepositAmount] = useState(centsToAmount(depositCents))
  const [paymentMethod, setPaymentMethod] = useState<StorePaymentMethod | ''>(depositPaymentMethod ?? '')
  const [nextStatus, setNextStatus] = useState<StorePreorderStatus>(status)
  const [nextNote, setNextNote] = useState(note ?? '')
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const nextDepositCents = useMemo(() => amountToCents(depositAmount), [depositAmount])
  const nextBalanceCents = useMemo(() => {
    if (!Number.isFinite(nextDepositCents)) return totalCents
    return Math.max(totalCents - nextDepositCents, 0)
  }, [nextDepositCents, totalCents])

  const dirty = useMemo(() => {
    const methodChanged = (paymentMethod || null) !== (depositPaymentMethod || null)
    return (
      nextStatus !== status ||
      nextDepositCents !== depositCents ||
      methodChanged ||
      nextNote.trim() !== (note ?? '').trim()
    )
  }, [depositCents, depositPaymentMethod, nextDepositCents, nextNote, nextStatus, note, paymentMethod, status])

  async function save() {
    if (loading || !dirty) return

    if (!Number.isFinite(nextDepositCents) || nextDepositCents < 0) {
      const msg = 'Deposit amount is invalid'
      setError(msg)
      toast.error(msg)
      return
    }

    if (nextDepositCents > totalCents) {
      const msg = 'Deposit cannot exceed total'
      setError(msg)
      toast.error(msg)
      return
    }

    if (nextDepositCents > 0 && !paymentMethod) {
      const msg = 'Select a payment method for the deposit'
      setError(msg)
      toast.error(msg)
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/store/preorders/admin-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          status: nextStatus,
          deposit_amount: depositAmount,
          deposit_payment_method: nextDepositCents > 0 ? paymentMethod : null,
          note: nextNote.trim() || null,
        }),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Failed to update preorder'
        setError(msg)
        toast.error(msg)
        return
      }

      toast.success('Preorder updated')
      router.refresh()
      setTimeout(() => router.refresh(), 200)
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function removePreorder() {
    if (deleting) return
    const confirmed = window.confirm('Delete this preorder? This action cannot be undone.')
    if (!confirmed) return

    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/store/preorders/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Failed to delete preorder'
        setError(msg)
        toast.error(msg)
        return
      }

      toast.success('Preorder deleted')
      router.refresh()
      setTimeout(() => router.refresh(), 200)
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      setError(msg)
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
      <div className="grid gap-3 xl:grid-cols-[160px_180px_minmax(0,220px)] xl:items-end">
        <label className="block">
          <span className="mb-1 block text-[11px] text-[hsl(var(--muted))]">Deposit</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="min-h-[40px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            disabled={loading || deleting}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-[hsl(var(--muted))]">Deposit payment</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod((e.target.value || '') as StorePaymentMethod | '')}
            className="min-h-[40px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            disabled={loading || deleting}
          >
            <option value="">No deposit</option>
            {STORE_PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {paymentLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-[hsl(var(--muted))]">Status</span>
          <select
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value as StorePreorderStatus)}
            className="min-h-[40px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            disabled={loading || deleting}
          >
            {STORE_PREORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {preorderStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Textarea
        label="Customer note"
        rows={3}
        value={nextNote}
        onChange={(e) => setNextNote(e.target.value)}
        disabled={loading || deleting}
      />

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm">
        <div>Total: {centsToAmount(totalCents)} EGP</div>
        <div>Current deposit: {centsToAmount(depositCents)} EGP</div>
        <div>Next balance after save: {centsToAmount(nextBalanceCents)} EGP</div>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty || loading || deleting} loading={loading} loadingText="Saving…">
          Save changes
        </Button>
        <Button
          variant="outline"
          onClick={removePreorder}
          disabled={loading || deleting}
          loading={deleting}
          loadingText="Deleting…"
        >
          Delete preorder
        </Button>
      </div>
    </div>
  )
}
