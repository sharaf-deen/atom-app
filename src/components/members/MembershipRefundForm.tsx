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

const METHOD_LABELS: Record<RefundMethod, string> = {
  cash: 'Cash',
  instapay: 'Instapay',
  card: 'Card',
  bank_transfer: 'Bank transfer',
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
  const [refundedAt, setRefundedAt] = React.useState(todayDateOnly())
  const [reason, setReason] = React.useState('')
  const [internalNote, setInternalNote] = React.useState('')
  const [proofUrl, setProofUrl] = React.useState('')
  const [proofFile, setProofFile] = React.useState<File | null>(null)
  const [proofUploadLabel, setProofUploadLabel] = React.useState('')
  const [proofInputKey, setProofInputKey] = React.useState(0)
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
  const selectedProofLabel = proofFile?.name || proofUploadLabel || proofUrl.trim()
  const canReview = Boolean(memberId) && Number.isFinite(amountNumber) && amountNumber > 0 && cleanReason.length >= 3 && Boolean(refundedAt)

  async function uploadProofIfNeeded() {
    if (!proofFile) return proofUrl.trim() || null

    const formData = new FormData()
    formData.append('file', proofFile)
    if (memberId) formData.append('memberId', memberId)
    if (subscriptionId) formData.append('subscriptionId', subscriptionId)

    const res = await fetch('/api/membership-refunds/upload-proof', {
      method: 'POST',
      body: formData,
    })

    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      throw new Error(data?.details || data?.error || `UPLOAD_HTTP_${res.status}`)
    }

    const storedPath = String(data.proofUrl || data.proofPath || '').trim()
    if (!storedPath) throw new Error('UPLOAD_RETURNED_EMPTY_PATH')
    setProofUrl(storedPath)
    setProofUploadLabel(String(data.fileName || proofFile.name || 'Uploaded proof'))
    return storedPath
  }

  const summaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Member', value: selectedMember ? memberName(selectedMember) : '—' },
    { label: 'Member ID', value: selectedMember?.member_id || '—' },
    { label: 'Subscription', value: subscriptionLabel(selectedSubscription) },
    { label: 'Refund amount', value: formatMoney(amountNumber) },
    { label: 'Refund method', value: METHOD_LABELS[refundMethod] },
    { label: 'Requested refund date', value: refundedAt || '—' },
    { label: 'Initial status', value: 'Pending review' },
    { label: 'Reason', value: cleanReason || '—' },
    { label: 'Proof', value: selectedProofLabel ? `Proof attached: ${selectedProofLabel}` : 'No proof attached' },
    { label: 'Approval impact', value: 'Requires approve/reject action after creation' },
    { label: 'Subscription impact', value: 'No automatic change' },
    { label: 'Member access impact', value: 'No automatic change' },
  ]

  async function submit() {
    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const uploadedProofUrl = await uploadProofIfNeeded()

      const res = await fetch('/api/membership-refunds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          subscriptionId: subscriptionId || null,
          amount: amountNumber,
          refundMethod,
          refundedAt,
          reason: cleanReason,
          internalNote: internalNote.trim() || null,
          proofUrl: uploadedProofUrl,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || `HTTP_${res.status}`)
      }

      setConfirmOpen(false)
      setSuccess('Refund request saved as Pending review. Subscription, original payment, member access and freezes were not changed.')
      setAmount('')
      setReason('')
      setInternalNote('')
      setProofUrl('')
      setProofFile(null)
      setProofUploadLabel('')
      setProofInputKey((v) => v + 1)
      setRefundedAt(todayDateOnly())
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save refund request')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Create exceptional refund request</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            This creates a pending refund request only. It does not pay the refund, delete the original payment, delete the subscription, change access, or change freeze tokens.
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
            {subscriptionLabel(selectedSubscription)}. This snapshot is for review only; the subscription will not be changed by this refund request.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
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
            label="Requested refund date"
            type="date"
            value={refundedAt}
            onChange={(event) => setRefundedAt(event.target.value)}
            required
            hint="Used as the requested/expected refund date. Mark as paid will add the real paid timestamp later."
          />
        </div>

        <div className="mt-4">
          <Textarea
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Example: exceptional medical refund requested by the member and reviewed by management."
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
              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-black">Upload proof / transfer receipt</span>
                  <input
                    key={proofInputKey}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      setProofFile(file)
                      if (file) {
                        setProofUploadLabel(file.name)
                        setProofUrl('')
                      }
                    }}
                    className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black file:mr-3 file:rounded-xl file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white placeholder:text-[hsl(var(--muted))] shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
                  />
                  <span className="mt-1.5 block text-xs text-[hsl(var(--muted))]">
                    Optional. Upload a bank transfer receipt, screenshot, image or PDF. The file path is stored automatically.
                  </span>
                </label>
                {selectedProofLabel ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                    Selected proof: <span className="font-semibold">{selectedProofLabel}</span>
                  </div>
                ) : null}
                <Input
                  label="Fallback proof URL or existing storage path"
                  value={proofUrl}
                  onChange={(event) => {
                    setProofUrl(event.target.value)
                    if (event.target.value.trim()) {
                      setProofFile(null)
                      setProofUploadLabel('')
                    }
                  }}
                  placeholder="Optional fallback only"
                  hint="Use this only for an existing external link/path. Normal use: upload the file above."
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 sm:grid-cols-3">
          <div>
            <div className="font-semibold">Initial workflow status</div>
            <div>Pending review</div>
          </div>
          <div>
            <div className="font-semibold">Approval/payment</div>
            <div>Separate admin actions</div>
          </div>
          <div>
            <div className="font-semibold">Subscription/access</div>
            <div>No automatic change</div>
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
            loadingText={proofFile ? 'Uploading proof…' : 'Saving…'}
          >
            Review & create refund request
          </Button>
        </div>
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm exceptional refund request"
        description="This saves a pending refund request only. It does not approve, pay, reverse or edit the original subscription payment."
        confirmLabel="Confirm & create request"
        pendingLabel="Saving request…"
        pending={pending}
        summaryItems={summaryItems}
        warning="Audit note: subscription, original payment, member access, freeze tokens, Payment Reconciliation, Cash and Store are not modified by this action. Approval and payment require separate actions."
        onCancel={() => {
          if (!pending) setConfirmOpen(false)
        }}
        onConfirm={submit}
      />
    </div>
  )
}
