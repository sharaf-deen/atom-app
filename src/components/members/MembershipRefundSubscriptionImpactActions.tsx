'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'

type ImpactAction = 'keep_active' | 'cancel_subscription' | 'shorten_subscription'
type RefundStatus = 'pending_review' | 'approved' | 'paid' | 'rejected' | 'cancelled' | string

type Props = {
  refund: {
    id: string
    status: RefundStatus | null
    amount: number | null
    subscription_id: string | null
    subscription_impact_action: string | null
    subscription_impact_status: string | null
    subscription_impact_applied_at: string | null
  }
  subscription: {
    id: string
    status: string | null
    start_date: string | null
    end_date: string | null
    plan: string | null
    amount: number | null
    amount_due: number | null
  } | null
  memberLabel: string
  subscriptionLabel: string
}

const ACTION_CONFIG: Record<ImpactAction, { label: string; title: string; confirmLabel: string; pendingLabel: string; tone?: 'default' | 'destructive' }> = {
  keep_active: {
    label: 'Keep active',
    title: 'Confirm keep subscription active',
    confirmLabel: 'Confirm keep active',
    pendingLabel: 'Saving decision…',
  },
  cancel_subscription: {
    label: 'Cancel subscription now',
    title: 'Confirm subscription cancellation',
    confirmLabel: 'Confirm cancellation',
    pendingLabel: 'Cancelling subscription…',
    tone: 'destructive',
  },
  shorten_subscription: {
    label: 'Shorten subscription',
    title: 'Confirm subscription shortening',
    confirmLabel: 'Confirm shortening',
    pendingLabel: 'Shortening subscription…',
    tone: 'destructive',
  },
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeDateOnly(value: string | null | undefined) {
  const raw = String(value ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function addDaysDateOnly(value: string, days: number) {
  const normalized = normalizeDateOnly(value)
  if (!normalized) return ''

  const [year, month, day] = normalized.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function effectiveSubscriptionStatus(subscription: Props['subscription']) {
  if (!subscription) return null

  const status = subscription.status
  const endDate = normalizeDateOnly(subscription.end_date)
  if (endDate && endDate < todayDateOnly() && status !== 'cancelled' && status !== 'expired') {
    return 'expired'
  }

  return status
}

function cancellationEndDate(subscription: Props['subscription']) {
  const today = todayDateOnly()
  const currentEndDate = normalizeDateOnly(subscription?.end_date)
  return currentEndDate && currentEndDate < today ? currentEndDate : today
}

function shortenMaxEndDate(subscription: Props['subscription']) {
  const currentEndDate = normalizeDateOnly(subscription?.end_date)
  return currentEndDate ? addDaysDateOnly(currentEndDate, -1) : ''
}

function defaultShortenEndDate(subscription: Props['subscription']) {
  const candidate = shortenMaxEndDate(subscription)
  const startDate = normalizeDateOnly(subscription?.start_date)
  if (!candidate || (startDate && candidate < startDate)) return ''
  return candidate
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'paused':
      return 'Paused'
    case 'expired':
      return 'Expired'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status || '—'
  }
}

function planLabel(plan: string | null | undefined) {
  switch (plan) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return 'Sessions package'
    default:
      return plan || '—'
  }
}

function impactLabel(action: ImpactAction | null) {
  if (action === 'keep_active') return 'Refund + keep subscription active'
  if (action === 'cancel_subscription') return 'Refund + cancel subscription now'
  if (action === 'shorten_subscription') return 'Refund + shorten subscription'
  return '—'
}

function expectedStatus(action: ImpactAction | null, subscription: Props['subscription'], shortenDate: string) {
  if (!subscription || !action) return '—'
  if (action === 'keep_active') return statusLabel(effectiveSubscriptionStatus(subscription))
  if (action === 'cancel_subscription') return 'Cancelled'
  if (action === 'shorten_subscription') {
    const date = shortenDate || subscription.end_date || ''
    if (!date) return statusLabel(effectiveSubscriptionStatus(subscription))
    return date < todayDateOnly() ? 'Expired' : statusLabel(subscription.status === 'paused' ? 'paused' : 'active')
  }
  return '—'
}

function expectedEndDate(action: ImpactAction | null, subscription: Props['subscription'], shortenDate: string) {
  if (!subscription || !action) return '—'
  if (action === 'keep_active') return formatDate(subscription.end_date)
  if (action === 'cancel_subscription') return cancellationEndDate(subscription)
  if (action === 'shorten_subscription') return shortenDate || '—'
  return '—'
}

export default function MembershipRefundSubscriptionImpactActions({ refund, subscription, memberLabel, subscriptionLabel }: Props) {
  const router = useRouter()
  const [selectedAction, setSelectedAction] = React.useState<ImpactAction | null>(null)
  const [shortenEndDate, setShortenEndDate] = React.useState(defaultShortenEndDate(subscription))
  const [reason, setReason] = React.useState('')
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const impactApplied = refund.subscription_impact_status === 'applied'
  const hasLinkedSubscription = Boolean(refund.subscription_id && subscription)
  const canApply = refund.status === 'paid' && hasLinkedSubscription && !impactApplied
  const config = selectedAction ? ACTION_CONFIG[selectedAction] : null
  const cleanReason = reason.trim()
  const reasonMissing = cleanReason.length < 3
  const currentEndDate = normalizeDateOnly(subscription?.end_date)
  const currentStartDate = normalizeDateOnly(subscription?.start_date)
  const shortenMaxDate = shortenMaxEndDate(subscription)
  const shortenDateInvalid = selectedAction === 'shorten_subscription' && (
    !shortenEndDate
    || !currentEndDate
    || shortenEndDate >= currentEndDate
    || Boolean(currentStartDate && shortenEndDate < currentStartDate)
  )

  React.useEffect(() => {
    setShortenEndDate(defaultShortenEndDate(subscription))
  }, [subscription?.end_date, subscription?.start_date])

  function openAction(action: ImpactAction) {
    setSelectedAction(action)
    setReason('')
    setConfirmOpen(false)
    setError(null)
    setSuccess(null)
    if (action === 'shorten_subscription') setShortenEndDate(defaultShortenEndDate(subscription))
  }

  async function submitAction() {
    if (!selectedAction || !config) return
    if (reasonMissing) {
      setError('A clear decision reason is required.')
      return
    }
    if (selectedAction === 'shorten_subscription') {
      if (!currentEndDate) {
        setError('This subscription has no current end date, so it cannot be shortened safely.')
        return
      }
      if (!shortenEndDate) {
        setError('Select the new subscription end date.')
        return
      }
      if (shortenEndDate >= currentEndDate) {
        setError('The new end date must be strictly earlier than the current subscription end date.')
        return
      }
      if (currentStartDate && shortenEndDate < currentStartDate) {
        setError('The new end date cannot be before the subscription start date.')
        return
      }
    }

    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const refundId = String(refund.id ?? '').trim()
      if (!refundId) throw new Error('Missing refund ID. Refresh the page and try again.')

      const res = await fetch(`/api/membership-refunds/subscription-impact?refundId=${encodeURIComponent(refundId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundId,
          refund_id: refundId,
          action: selectedAction,
          impactEndDate: selectedAction === 'shorten_subscription' ? shortenEndDate : null,
          reason: cleanReason,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || `HTTP_${res.status}`)
      }

      setConfirmOpen(false)
      setSelectedAction(null)
      setReason('')
      setSuccess('Subscription impact decision saved. Original refund/payment record was preserved.')
      router.refresh()
    } catch (e: any) {
      setConfirmOpen(false)
      setError(e?.message ?? 'Failed to apply subscription impact')
    } finally {
      setPending(false)
    }
  }

  if (!hasLinkedSubscription) {
    return refund.status === 'paid' ? (
      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        This paid refund has no linked subscription, so no subscription impact action is available.
      </div>
    ) : null
  }

  if (impactApplied) {
    return (
      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="font-semibold">Subscription impact decision already applied</div>
        <p className="mt-1 text-xs">
          This refund record already has a subscription impact decision. Further subscription changes should be handled manually from the subscription admin flow if needed.
        </p>
      </div>
    )
  }

  if (refund.status !== 'paid') {
    return (
      <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-3 text-sm text-[hsl(var(--muted))]">
        Subscription impact actions become available after the refund workflow is marked as paid.
      </div>
    )
  }

  const summaryItems: ConfirmActionSummaryItem[] = selectedAction && config ? [
    { label: 'Member', value: memberLabel },
    { label: 'Refund amount', value: formatMoney(refund.amount) },
    { label: 'Subscription', value: subscriptionLabel },
    { label: 'Current status', value: statusLabel(effectiveSubscriptionStatus(subscription)) },
    { label: 'Current end date', value: formatDate(subscription?.end_date) },
    { label: 'Decision', value: impactLabel(selectedAction) },
    { label: 'New status', value: expectedStatus(selectedAction, subscription, shortenEndDate) },
    { label: 'New end date', value: expectedEndDate(selectedAction, subscription, shortenEndDate) },
    { label: 'Decision reason', value: cleanReason || '—' },
    { label: 'Original payment/refund records', value: 'Preserved' },
  ] : []

  return (
    <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-soft">
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Subscription impact decision</div>
        <div className="text-xs text-[hsl(var(--muted))]">
          Paid refund only. Choose whether the linked subscription stays active, is cancelled now, or is shortened. Every action requires confirmation and keeps original payments/refund records intact.
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3 text-xs text-[hsl(var(--muted))] sm:grid-cols-3">
        <div>
          <div className="font-semibold text-black">{planLabel(subscription?.plan)}</div>
          <div>Plan</div>
        </div>
        <div>
          <div className="font-semibold text-black">{statusLabel(effectiveSubscriptionStatus(subscription))}</div>
          <div>Current status</div>
        </div>
        <div>
          <div className="font-semibold text-black">{formatDate(subscription?.end_date)}</div>
          <div>Current end date</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => openAction('keep_active')} disabled={!canApply || pending}>
          Keep active
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => openAction('shorten_subscription')} disabled={!canApply || pending}>
          Shorten subscription
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => openAction('cancel_subscription')} disabled={!canApply || pending}>
          Cancel now
        </Button>
      </div>

      {success ? <p className="mt-3 text-xs font-medium text-emerald-700">✅ {success}</p> : null}
      {error && !selectedAction ? <p className="mt-3 text-xs font-medium text-rose-700">❌ {error}</p> : null}

      {selectedAction && config ? (
        <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
          {selectedAction === 'shorten_subscription' ? (
            <Input
              label="New subscription end date"
              type="date"
              value={shortenEndDate}
              min={currentStartDate || undefined}
              max={shortenMaxDate || undefined}
              onChange={(event) => {
                setShortenEndDate(event.target.value)
                setError(null)
              }}
              required
              hint={currentEndDate
                ? `Must be strictly earlier than the current end date (${currentEndDate}).`
                : 'A current subscription end date is required before this subscription can be shortened.'}
            />
          ) : null}

          {selectedAction === 'cancel_subscription' ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              This will set the linked subscription status to cancelled. Its end date becomes today only when today is earlier than the existing end date; a past end date is never moved forward.
            </div>
          ) : null}

          {selectedAction === 'keep_active' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              This records that the subscription should stay unchanged after the paid refund.
            </div>
          ) : null}

          <div className="mt-3">
            <Textarea
              label="Decision reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Example: exceptional medical refund approved, subscription kept active as a goodwill decision."
              required
              hint="Required for the audit trail."
            />
          </div>

          {error ? <p className="mt-3 text-xs font-medium text-rose-700">❌ {error}</p> : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setSelectedAction(null)} disabled={pending}>
              Back
            </Button>
            <Button type="button" size="sm" onClick={() => setConfirmOpen(true)} disabled={pending || reasonMissing || shortenDateInvalid}>
              Review subscription impact
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={confirmOpen && Boolean(selectedAction && config)}
        title={config?.title || 'Confirm subscription impact'}
        description="This applies the explicit subscription decision linked to this paid refund. Original payments and refund records are preserved."
        confirmLabel={config?.confirmLabel || 'Confirm'}
        pendingLabel={config?.pendingLabel || 'Saving…'}
        pending={pending}
        tone={config?.tone || 'default'}
        summaryItems={summaryItems}
        warning="This can affect member access through the linked subscription. Review the dates/status carefully before confirming."
        onCancel={() => {
          if (!pending) setConfirmOpen(false)
        }}
        onConfirm={submitAction}
      />
    </div>
  )
}
