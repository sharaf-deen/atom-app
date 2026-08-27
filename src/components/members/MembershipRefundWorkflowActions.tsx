'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'

type RefundStatus = 'pending_review' | 'approved' | 'paid' | 'rejected' | 'cancelled' | string

type RefundAction = 'approve' | 'reject' | 'mark_paid' | 'cancel'

type Props = {
  refund: {
    id: string
    status: RefundStatus | null
    amount: number | null
    refund_method: string | null
  }
  memberLabel: string
  subscriptionLabel: string
}

const ACTION_CONFIG: Record<RefundAction, { label: string; title: string; confirmLabel: string; pendingLabel: string; newStatus: string; tone?: 'default' | 'destructive'; requiresReason?: boolean }> = {
  approve: {
    label: 'Approve refund',
    title: 'Confirm refund approval',
    confirmLabel: 'Confirm approval',
    pendingLabel: 'Approving…',
    newStatus: 'Approved',
  },
  reject: {
    label: 'Reject refund',
    title: 'Confirm refund rejection',
    confirmLabel: 'Confirm rejection',
    pendingLabel: 'Rejecting…',
    newStatus: 'Rejected',
    tone: 'destructive',
    requiresReason: true,
  },
  mark_paid: {
    label: 'Mark as paid',
    title: 'Confirm refund payment',
    confirmLabel: 'Confirm paid refund',
    pendingLabel: 'Marking paid…',
    newStatus: 'Paid',
  },
  cancel: {
    label: 'Cancel record',
    title: 'Confirm refund cancellation',
    confirmLabel: 'Confirm cancellation',
    pendingLabel: 'Cancelling…',
    newStatus: 'Cancelled',
    tone: 'destructive',
    requiresReason: true,
  },
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
}

function statusLabel(status: RefundStatus | null | undefined) {
  switch (status) {
    case 'pending_review':
      return 'Pending review'
    case 'approved':
      return 'Approved'
    case 'paid':
      return 'Paid'
    case 'rejected':
      return 'Rejected'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status || '—'
  }
}

function methodLabel(method: string | null | undefined) {
  switch (method) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'Instapay'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return method || '—'
  }
}

function allowedActions(status: RefundStatus | null | undefined): RefundAction[] {
  if (status === 'pending_review') return ['approve', 'reject', 'cancel']
  if (status === 'approved') return ['mark_paid', 'cancel']
  return []
}

export default function MembershipRefundWorkflowActions({ refund, memberLabel, subscriptionLabel }: Props) {
  const router = useRouter()
  const actions = allowedActions(refund.status)
  const [selectedAction, setSelectedAction] = React.useState<RefundAction | null>(null)
  const [reason, setReason] = React.useState('')
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const config = selectedAction ? ACTION_CONFIG[selectedAction] : null
  const cleanReason = reason.trim()
  const reasonMissing = Boolean(config?.requiresReason) && cleanReason.length < 3

  function openAction(action: RefundAction) {
    setSelectedAction(action)
    setReason('')
    setConfirmOpen(false)
    setError(null)
    setSuccess(null)
  }

  async function submitAction() {
    if (!selectedAction || !config) return
    if (reasonMissing) {
      setError('A reason is required for reject/cancel actions.')
      return
    }

    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/membership-refunds/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundId: refund.id,
          action: selectedAction,
          reason: cleanReason || null,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || `HTTP_${res.status}`)
      }

      setConfirmOpen(false)
      setSelectedAction(null)
      setReason('')
      setSuccess('Refund workflow updated. Subscription, original payment, member access and freezes were not changed.')
      router.refresh()
    } catch (e: any) {
      setConfirmOpen(false)
      setError(e?.message ?? 'Failed to update refund workflow')
    } finally {
      setPending(false)
    }
  }

  const summaryItems: ConfirmActionSummaryItem[] = selectedAction && config ? [
    { label: 'Member', value: memberLabel },
    { label: 'Subscription', value: subscriptionLabel },
    { label: 'Refund amount', value: formatMoney(refund.amount) },
    { label: 'Refund method', value: methodLabel(refund.refund_method) },
    { label: 'Current status', value: statusLabel(refund.status) },
    { label: 'New status', value: config.newStatus },
    { label: config.requiresReason ? 'Required reason' : 'Reason', value: cleanReason || '—' },
    { label: 'Subscription/access impact', value: 'No automatic change' },
  ] : []

  if (actions.length === 0) {
    return null
  }

  return (
    <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Workflow actions</div>
        <div className="text-xs text-[hsl(var(--muted))]">Approval/payment actions only. No subscription, payment history, access, Cash, Store or reconciliation data is modified.</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={ACTION_CONFIG[action].tone === 'destructive' ? 'outline' : 'solid'}
            onClick={() => openAction(action)}
            disabled={pending}
          >
            {ACTION_CONFIG[action].label}
          </Button>
        ))}
      </div>

      {success ? <p className="mt-3 text-xs font-medium text-emerald-700">✅ {success}</p> : null}
      {error && !selectedAction ? <p className="mt-3 text-xs font-medium text-rose-700">❌ {error}</p> : null}

      {selectedAction && config ? (
        <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
          {config.requiresReason ? (
            <Textarea
              label={selectedAction === 'reject' ? 'Rejection reason' : 'Cancellation reason'}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder={selectedAction === 'reject' ? 'Explain why this refund request is rejected.' : 'Explain why this refund record is cancelled.'}
              required
              hint="Required for audit trail."
            />
          ) : null}

          {error ? <p className="mt-3 text-xs font-medium text-rose-700">❌ {error}</p> : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setSelectedAction(null)} disabled={pending}>
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={pending || reasonMissing}
            >
              Review & {config.label.toLowerCase()}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={confirmOpen && Boolean(selectedAction && config)}
        title={config?.title || 'Confirm refund action'}
        description="This updates the internal refund workflow only. It does not modify the original payment, subscription, access, Cash, Store, or Payment Reconciliation."
        confirmLabel={config?.confirmLabel || 'Confirm'}
        pendingLabel={config?.pendingLabel || 'Saving…'}
        pending={pending}
        tone={config?.tone || 'default'}
        summaryItems={summaryItems}
        warning="Audit note: this is workflow tracking only. No bank transfer is triggered automatically."
        onCancel={() => {
          if (!pending) setConfirmOpen(false)
        }}
        onConfirm={submitAction}
      />
    </div>
  )
}
