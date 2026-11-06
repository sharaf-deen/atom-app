'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Method = 'cash' | 'instapay' | 'card' | 'bank_transfer'
type LedgerPayment = {
  id: string
  amount: number
  payment_method: string
  paid_at: string | null
  created_at: string | null
}

const methods: { value: Method; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'InstaPay' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
]

function methodLabel(value: string): string {
  return methods.find((m) => m.value === value)?.label ?? value
}

function dateLabel(value: string | null) {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SubscriptionPaymentMethodCorrection({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [payments, setPayments] = useState<LedgerPayment[]>([])
  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [newMethod, setNewMethod] = useState<Method>('instapay')
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const selected = payments.find((row) => row.id === selectedPaymentId) ?? null
  const oldMethod = selected?.payment_method ?? ''
  const canSubmit = !!selected && methods.some((row) => row.value === oldMethod)
    && newMethod !== oldMethod && reason.trim().length >= 5
    && reason.trim().length <= 500 && confirm && !saving && !loading

  async function loadPayments() {
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const response = await fetch(
        `/api/subscriptions/payments/correct-method?subscription_id=${encodeURIComponent(subscriptionId)}`,
        { cache: 'no-store', credentials: 'same-origin' },
      )
      const body = await response.json()
      if (!response.ok || !body.ok || !Array.isArray(body.payments)) {
        throw new Error(body.error ?? 'Unable to load payment ledger')
      }
      const rows = body.payments as LedgerPayment[]
      setPayments(rows)
      setSelectedPaymentId('')
      setReason('')
      setConfirm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load payment ledger')
    } finally {
      setLoading(false)
    }
  }

  async function saveCorrection() {
    if (!canSubmit || !selected) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/subscriptions/payments/correct-method', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_id: selected.id,
          old_method: oldMethod,
          new_method: newMethod,
          reason: reason.trim(),
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) {
        if (body.error === 'PAYMENT_CORRECTION_NOT_DEPLOYED') {
          throw new Error('Correction is not available yet: the reviewed database migration is not deployed.')
        }
        if (body.error === 'PAYMENT_CORRECTION_REJECTED') {
          throw new Error('Correction blocked. Check existing bank matches, refunds, or batch restrictions before retrying.')
        }
        throw new Error(body.error ?? 'Payment correction failed')
      }
      setMessage('Method corrected. The original validation remains in history. Validate the payment under its new method and business date before bank matching.')
      setConfirm(false)
      setReason('')
      await loadPayments()
      setMessage('Method corrected. The original validation remains in history. Revalidate the payment with the new method and date before bank matching.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment correction failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        onClick={() => {
          setOpen(true)
          void loadPayments()
        }}
      >
        Correct payment method
      </button>
      {open ? (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-label="Correct subscription payment method"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Correct payment method</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Super Admin only · Correct a specific payment, not the subscription header.
                </p>
              </div>
              <button type="button" onClick={() => !saving && setOpen(false)}
                disabled={saving} className="rounded-lg border px-3 py-1.5 text-sm">Close</button>
            </div>
            {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
            {message ? <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p> : null}
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor={`payment-correction-source-${subscriptionId}`}
                  className="mb-1 block text-sm font-medium">Payment to correct</label>
                <select id={`payment-correction-source-${subscriptionId}`}
                  className="w-full rounded-lg border p-2 text-sm"
                  value={selectedPaymentId}
                  disabled={loading || saving}
                  onChange={(e) => {
                    const id = e.target.value
                    setSelectedPaymentId(id)
                    const next = payments.find((row) => row.id === id)
                    const fallback = methods.find((row) => row.value !== next?.payment_method)
                    setNewMethod(fallback?.value ?? 'instapay')
                    setReason('')
                    setConfirm(false)
                    setError('')
                  }}>
                  <option value="">{loading ? 'Loading payments…' : 'Choose a payment'}</option>
                  {payments.map((payment) => (
                    <option key={payment.id} value={payment.id}>
                      {dateLabel(payment.paid_at ?? payment.created_at)} · {Number(payment.amount).toFixed(2)} EGP · {methodLabel(payment.payment_method)} · {payment.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {!loading && payments.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-600">No payment ledger entry found for this subscription.</p>
                ) : null}
              </div>
              {selected ? (
                <div className="rounded-lg border bg-gray-50 p-3 text-sm">
                  <p><strong>Payment ID:</strong> {selected.id}</p>
                  <p><strong>Recorded amount:</strong> {Number(selected.amount).toFixed(2)} EGP</p>
                  <p><strong>Current method:</strong> {methodLabel(oldMethod)}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    The recorded amount, other installments and subscription balance are not changed.
                  </p>
                </div>
              ) : null}
              <div>
                <label htmlFor={`payment-correction-new-${subscriptionId}`}
                  className="mb-1 block text-sm font-medium">Correct method</label>
                <select id={`payment-correction-new-${subscriptionId}`}
                  className="w-full rounded-lg border p-2 text-sm"
                  value={newMethod} disabled={!selected || saving}
                  onChange={(e) => {
                    setNewMethod(e.target.value as Method)
                    setConfirm(false)
                  }}>
                  {methods.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`payment-correction-reason-${subscriptionId}`}
                  className="mb-1 block text-sm font-medium">Reason (required, 5–500 characters)</label>
                <textarea id={`payment-correction-reason-${subscriptionId}`}
                  value={reason} maxLength={500} rows={3} disabled={!selected || saving}
                  onChange={(e) => { setReason(e.target.value); setConfirm(false) }}
                  className="w-full rounded-lg border p-2 text-sm"
                  placeholder="E.g. Bank statement confirms InstaPay; originally recorded as Card." />
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                Existing bank matches, refunds and multi-payment validation batches may block correction.
                A corrected validated payment must be validated again under its new method.
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirm} disabled={!selected || saving}
                  onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
                <span>I verified the bank evidence and confirm that only this payment method should change.</span>
              </label>
              <button type="button" disabled={!canSubmit} onClick={() => void saveCorrection()}
                className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Saving correction…' : 'Confirm payment method correction'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
