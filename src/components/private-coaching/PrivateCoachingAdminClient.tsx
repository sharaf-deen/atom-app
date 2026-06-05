'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import {
  formatPrivateCoachingMoney,
  privateCoachingPaymentMethodLabel,
  privateCoachingStatusLabel,
} from '@/lib/privateCoaching'

type RequestRow = {
  id: string
  memberName: string
  memberMeta: string
  coachName: string
  packageSessions: number
  amountCents: number
  paymentMethod: string
  status: string
  createdAt: string
  confirmedAt: string | null
}

type Props = {
  rows: RequestRow[]
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'payment_pending') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function paymentSummaryItems(row: RequestRow | null): ConfirmActionSummaryItem[] {
  if (!row) return []

  return [
    { label: 'Member', value: row.memberName },
    { label: 'Member info', value: row.memberMeta || '—' },
    { label: 'Coach', value: row.coachName },
    { label: 'Package', value: `${row.packageSessions} session(s)` },
    { label: 'Amount', value: formatPrivateCoachingMoney(row.amountCents) },
    { label: 'Payment method', value: privateCoachingPaymentMethodLabel(row.paymentMethod) },
    { label: 'Current status', value: privateCoachingStatusLabel(row.status) },
    { label: 'Requested', value: formatDateTime(row.createdAt) },
    { label: 'Token impact', value: `${row.packageSessions} active token(s) will be created` },
    { label: 'Payment impact', value: 'Request becomes active after confirmation' },
  ]
}

export default function PrivateCoachingAdminClient({ rows }: Props) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState('')
  const [confirmPaymentRow, setConfirmPaymentRow] = React.useState<RequestRow | null>(null)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  async function confirmPayment(row: RequestRow) {
    setBusyId(row.id)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/requests/${encodeURIComponent(row.id)}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not confirm payment.' })
        return
      }
      setConfirmPaymentRow(null)
      setStatus({ kind: 'success', message: 'Payment confirmed. Sessions are now active for the member.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not confirm payment.' })
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No private coaching request yet.
        </div>
      ) : null}

      <div className="grid gap-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(row.status)}`}>
                    {privateCoachingStatusLabel(row.status)}
                  </span>
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--muted))]">
                    {row.packageSessions} session(s)
                  </span>
                </div>

                <div className="mt-3 text-base font-semibold tracking-tight">{row.memberName}</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.memberMeta}</div>

                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Amount</div>
                    <div className="font-semibold">{formatPrivateCoachingMoney(row.amountCents)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Payment</div>
                    <div className="font-semibold">{privateCoachingPaymentMethodLabel(row.paymentMethod)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Requested</div>
                    <div className="font-semibold">{formatDateTime(row.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Coach</div>
                    <div className="font-semibold">{row.coachName}</div>
                  </div>
                </div>
              </div>

              {row.status === 'payment_pending' ? (
                <Button
                  type="button"
                  onClick={() => setConfirmPaymentRow(row)}
                  disabled={Boolean(busyId)}
                  loading={busyId === row.id}
                  loadingText="Confirming…"
                  className="w-full lg:w-auto"
                >
                  Confirm payment received
                </Button>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                  Confirmed {formatDateTime(row.confirmedAt)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmActionModal
        open={Boolean(confirmPaymentRow)}
        title="Confirm private coaching payment"
        description="Please confirm that the payment was received before activating private coaching tokens."
        confirmLabel="Confirm payment"
        pendingLabel="Confirming…"
        pending={Boolean(confirmPaymentRow && busyId === confirmPaymentRow.id)}
        summaryItems={paymentSummaryItems(confirmPaymentRow)}
        warning="This action creates active private coaching tokens for the member."
        onCancel={() => {
          if (!busyId) setConfirmPaymentRow(null)
        }}
        onConfirm={() => {
          if (confirmPaymentRow) return confirmPayment(confirmPaymentRow)
        }}
      />
    </div>
  )
}
