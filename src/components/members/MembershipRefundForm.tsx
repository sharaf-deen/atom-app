'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'

type MemberOption = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

type SubscriptionOption = {
  id: string
  member_id: string
  plan: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  amount: number | null
  amount_due: number | null
  payment_method: string | null
  paid_at: string | null
  created_at: string | null
}

type Props = {
  members: MemberOption[]
  subscriptions: SubscriptionOption[]
  initialMemberId?: string
}

type RefundMethod = 'cash' | 'instapay' | 'card' | 'bank_transfer'
type RefundStatus = 'paid' | 'cancelled'

const METHOD_LABELS: Record<RefundMethod, string> = {
  cash: 'Cash',
  instapay: 'Instapay',
  card: 'Card',
  bank_transfer: 'Bank transfer',
}

const STATUS_LABELS: Record<RefundStatus, string> = {
  paid: 'Paid refund',
  cancelled: 'Cancelled record',
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
}

function memberName(member?: MemberOption | null) {
  if (!member) return '—'
  return `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.email || member.phone || member.member_id || 'Member'
}

function subscriptionLabel(subscription?: SubscriptionOption | null) {
  if (!subscription) return 'No subscription linked'
  const dates = [subscription.start_date, subscription.end_date].filter(Boolean).join(' → ')
  const amount = subscription.amount != null ? ` · ${formatMoney(subscription.amount)}` : ''
  const due = Number(subscription.amount_due ?? 0) > 0 ? ` · due ${formatMoney(subscription.amount_due)}` : ''
  return `${subscription.plan || 'subscription'} · ${subscription.status || 'status unknown'}${dates ? ` · ${dates}` : ''}${amount}${due}`
}

export default function MembershipRefundForm({ members, subscriptions, initialMemberId = '' }: Props) {
  const router = useRouter()

  const [memberId, setMemberId] = React.useState(initialMemberId)
  const [subscriptionId, setSubscriptionId] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [refundMethod, setRefundMethod] = React.useState<RefundMethod>('bank_transfer')
  const [status, setStatus] = React.useState<RefundStatus>('paid')
  const [refundedAt, setRefundedAt] = React.useState(todayDateOnly())
  const [reason, setReason] = React.useState('')
  const [internalNote, setInternalNote] = React.useState('')
  const [proofUrl, setProofUrl] = React.useState('')
  const [optionalOpen, setOptionalOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const selectedMember = React.useMemo(
    () => members.find((m) => m.user_id === memberId) ?? null,
    [memberId, members],
  )

  const memberSubscriptions = React.useMemo(
    () => subscriptions.filter((s) => s.member_id === memberId),
    [memberId, subscriptions],
  )

  const selectedSubscription = React.useMemo(
    () => memberSubscriptions.find((s) => s.id === subscriptionId) ?? null,
    [memberSubscriptions, subscriptionId],
  )

  React.useEffect(() => {
    if (!memberId) {
      setSubscriptionId('')
      return
    }
    if (subscriptionId && !memberSubscriptions.some((s) => s.id === subscriptionId)) {
      setSubscriptionId('')
    }
  }, [memberId, memberSubscriptions, subscriptionId])

  const amountNumber = Number(amount)
  const cleanReason = reason.trim()
  const canReview = Boolean(memberId) && Number.isFinite(amountNumber) && amountNumber > 0 && cleanReason.length >= 3 && Boolean(refundedAt)

  const summaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Member', value: selectedMember ? memberName(selectedMember) : '—' },
    { label: 'Member ID', value: selectedMember?.member_id || '—' },
    { label: 'Subscription', value: subscriptionLabel(selectedSubscription) },
    { label: 'Refund amount', value: formatMoney(amountNumber) },
    { label: 'Refund method', value: METHOD_LABELS[refundMethod] },
    { label: 'Refund date', value: refundedAt || '—' },
    { label: 'Status', value: STATUS_LABELS[status] },
    { label: 'Reason', value: cleanReason || '—' },
    { label: 'Proof', value: proofUrl.trim() ? 'Proof link/path provided' : 'No proof attached' },
    { label: 'Subscription impact', value: 'No automatic change' },
    { label: 'Member access impact', value: 'No automatic change' },
  ]

  async function submit() {
    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/membership-refunds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          subscriptionId: subscriptionId || null,
          amount: amountNumber,
          refundMethod,
          status,
          refundedAt,
          reason: cleanReason,
          internalNote: internalNote.trim() || null,
          proofUrl: proofUrl.trim() || null,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || `HTTP_${res.status}`)
      }

      setConfirmOpen(false)
      setSuccess('Exceptional refund record saved. Subscription, original payment, member access and freezes were not changed.')
      setAmount('')
      setReason('')
      setInternalNote('')
      setProofUrl('')
      setStatus('paid')
      setRefundedAt(todayDateOnly())
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save refund record')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Record exceptional membership refund</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            This creates an audit record only. It does not delete the original payment, delete the subscription, change access, or change freeze tokens.
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Select
            label="Member"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            required
          >
            <option value="">Select member…</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {memberName(member)}{member.member_id ? ` · ${member.member_id}` : ''}{member.email ? ` · ${member.email}` : ''}
              </option>
            ))}
          </Select>

          <Select
            label="Linked subscription"
            value={subscriptionId}
            onChange={(event) => setSubscriptionId(event.target.value)}
            disabled={!memberId}
            hint="Optional but recommended when the refund is related to a specific subscription."
          >
            <option value="">No subscription linked</option>
            {memberSubscriptions.map((subscription) => (
              <option key={subscription.id} value={subscription.id}>
                {subscriptionLabel(subscription)}
              </option>
            ))}
          </Select>
        </div>

        {selectedSubscription ? (
          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
            <span className="font-semibold">Subscription snapshot:</span>{' '}
            {subscriptionLabel(selectedSubscription)}. This snapshot is for review only; the subscription will not be changed by this refund record.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <Input
            label="Refund amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="1700"
            required
          />

          <Select label="Refund method" value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="instapay">Instapay</option>
            <option value="card">Card</option>
          </Select>

          <Input
            label="Refund date"
            type="date"
            value={refundedAt}
            onChange={(event) => setRefundedAt(event.target.value)}
            required
          />

          <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as RefundStatus)}>
            <option value="paid">Paid refund</option>
            <option value="cancelled">Cancelled record</option>
          </Select>
        </div>

        <div className="mt-4">
          <Textarea
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Example: exceptional medical refund approved by management."
            required
            hint="Required. Keep this clear because it explains the exceptional decision later."
          />
        </div>

        <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
          <button
            type="button"
            onClick={() => setOptionalOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold"
          >
            <span>Optional refund details</span>
            <span className="text-xs text-[hsl(var(--muted))]">{optionalOpen ? 'Hide' : 'Show'}</span>
          </button>

          {optionalOpen ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Textarea
                label="Internal note"
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
                rows={3}
                placeholder="Private admin note."
              />
              <Input
                label="Proof / transfer receipt URL or path"
                value={proofUrl}
                onChange={(event) => setProofUrl(event.target.value)}
                placeholder="https://… or storage path"
                hint="Optional for Lot 1A. Use it to paste a bank receipt link/path when available."
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 sm:grid-cols-3">
          <div>
            <div className="font-semibold">Historical payment</div>
            <div>Kept unchanged</div>
          </div>
          <div>
            <div className="font-semibold">Subscription/access</div>
            <div>No automatic change</div>
          </div>
          <div>
            <div className="font-semibold">Reconciliation/cash</div>
            <div>No automatic mutation</div>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-rose-700">❌ {error}</p> : null}
        {success ? <p className="mt-3 text-sm font-medium text-emerald-700">✅ {success}</p> : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canReview || pending}
            loading={pending}
            loadingText="Saving…"
          >
            Review & save refund record
          </Button>
        </div>
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm exceptional refund record"
        description="This saves a separate refund record only. It does not reverse or edit the original subscription payment."
        confirmLabel="Confirm & save refund"
        pendingLabel="Saving refund…"
        pending={pending}
        summaryItems={summaryItems}
        warning="Audit note: subscription, original payment, member access, freeze tokens, Payment Reconciliation, Cash and Store are not modified by this action."
        onCancel={() => {
          if (!pending) setConfirmOpen(false)
        }}
        onConfirm={submit}
      />
    </div>
  )
}
