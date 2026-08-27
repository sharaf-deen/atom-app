// src/app/admin/membership-refunds/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import MembershipRefundForm from '@/components/members/MembershipRefundForm'
import MembershipRefundWorkflowActions from '@/components/members/MembershipRefundWorkflowActions'
import MembershipRefundSubscriptionImpactActions from '@/components/members/MembershipRefundSubscriptionImpactActions'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

type MemberRow = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

type SubscriptionRow = {
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

type RefundRow = {
  id: string
  member_id: string
  subscription_id: string | null
  amount: number | null
  refund_method: string | null
  reason: string | null
  internal_note: string | null
  proof_url: string | null
  status: string | null
  refunded_at: string | null
  created_by: string | null
  created_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  paid_by: string | null
  paid_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  subscription_impact_action: string | null
  subscription_impact_status: string | null
  subscription_impact_applied_by: string | null
  subscription_impact_applied_at: string | null
  subscription_impact_reason: string | null
  subscription_impact_original_status: string | null
  subscription_impact_original_end_date: string | null
  subscription_impact_new_status: string | null
  subscription_impact_new_end_date: string | null
}

function getOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
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

function memberName(member?: MemberRow | null) {
  if (!member) return '—'
  return `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.email || member.phone || member.member_id || 'Member'
}

function subscriptionLabel(subscription?: SubscriptionRow | null) {
  if (!subscription) return 'No linked subscription'
  const dates = [subscription.start_date, subscription.end_date].filter(Boolean).join(' → ')
  return `${subscription.plan || 'subscription'} · ${subscription.status || 'status unknown'}${dates ? ` · ${dates}` : ''}`
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

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case 'pending_review':
      return 'Pending review'
    case 'approved':
      return 'Approved'
    case 'paid':
      return 'Paid refund'
    case 'rejected':
      return 'Rejected'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status || '—'
  }
}

function statusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'pending_review':
      return 'border-amber-200 bg-amber-50 text-amber-950'
    case 'approved':
      return 'border-sky-200 bg-sky-50 text-sky-950'
    case 'paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900'
    case 'rejected':
      return 'border-rose-200 bg-rose-50 text-rose-900'
    case 'cancelled':
      return 'border-slate-300 bg-slate-100 text-slate-700'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))]'
  }
}

function workflowLabel(status: string | null | undefined) {
  switch (status) {
    case 'pending_review':
      return 'Needs approval or rejection'
    case 'approved':
      return 'Approved, waiting for real payment'
    case 'paid':
      return 'Paid and closed'
    case 'rejected':
      return 'Rejected and closed'
    case 'cancelled':
      return 'Cancelled and closed'
    default:
      return 'Workflow status unknown'
  }
}


function impactActionLabel(action: string | null | undefined) {
  switch (action) {
    case 'keep_active':
      return 'Keep subscription active'
    case 'cancel_subscription':
      return 'Cancel subscription'
    case 'shorten_subscription':
      return 'Shorten subscription'
    case 'none':
    case null:
    case undefined:
    case '':
      return 'No subscription impact recorded'
    default:
      return action
  }
}

function impactStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'not_applied':
      return 'Not applied'
    case 'applied':
      return 'Applied'
    case 'skipped':
      return 'Skipped'
    default:
      return status || 'Not applied'
  }
}

function impactBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'applied':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900'
    case 'skipped':
      return 'border-slate-200 bg-slate-50 text-slate-700'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-950'
  }
}

function proofHref(proofUrl: string | null | undefined) {
  const raw = String(proofUrl ?? '').trim()
  if (!raw) return '#'
  if (/^https?:\/\//i.test(raw)) return raw
  return `/api/membership-refunds/proof?path=${encodeURIComponent(raw)}`
}

export default async function AdminMembershipRefundsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const rawMemberId = getOne(searchParams?.memberId)?.trim() || ''
  const currentPath = `/admin/membership-refunds${rawMemberId ? `?memberId=${encodeURIComponent(rawMemberId)}` : ''}`

  const me = await getSessionUser()
  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Membership refunds</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can view exceptional membership refunds."
            nextPath="/admin/membership-refunds"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Membership refunds</h1>
        <p className="mt-3 text-sm text-rose-700">Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY</p>
      </main>
    )
  }

  const [{ data: membersData, error: membersError }, { data: subscriptionsData, error: subscriptionsError }] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id, member_id, email, first_name, last_name, phone')
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('subscriptions')
      .select('id, member_id, plan, status, start_date, end_date, amount, amount_due, payment_method, paid_at, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  const members = ((membersData ?? []) as any[]) as MemberRow[]
  const subscriptions = ((subscriptionsData ?? []) as any[]) as SubscriptionRow[]
  const selectedMemberId = members.some((m) => m.user_id === rawMemberId) ? rawMemberId : ''

  let refunds: RefundRow[] = []
  let refundsErrorMessage: string | null = null

  try {
    let refundQuery = admin
      .from('membership_refunds')
      .select('id, member_id, subscription_id, amount, refund_method, reason, internal_note, proof_url, status, refunded_at, created_by, created_at, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, paid_by, paid_at, cancelled_by, cancelled_at, cancellation_reason, subscription_impact_action, subscription_impact_status, subscription_impact_applied_by, subscription_impact_applied_at, subscription_impact_reason, subscription_impact_original_status, subscription_impact_original_end_date, subscription_impact_new_status, subscription_impact_new_end_date')
      .order('created_at', { ascending: false })
      .limit(200)

    if (selectedMemberId) refundQuery = refundQuery.eq('member_id', selectedMemberId)

    const { data, error } = await refundQuery
    if (error) refundsErrorMessage = error.message
    refunds = ((data ?? []) as any[]) as RefundRow[]
  } catch (e: any) {
    refundsErrorMessage = e?.message ?? String(e)
  }

  const profileIds = Array.from(new Set(refunds.flatMap((r) => [
    r.member_id,
    r.created_by,
    r.approved_by,
    r.rejected_by,
    r.paid_by,
    r.cancelled_by,
    r.subscription_impact_applied_by,
  ].filter(Boolean) as string[])))
  const subscriptionIds = Array.from(new Set(refunds.map((r) => r.subscription_id).filter(Boolean) as string[]))

  let refundProfiles: MemberRow[] = []
  if (profileIds.length) {
    const { data } = await admin
      .from('profiles')
      .select('user_id, member_id, email, first_name, last_name, phone')
      .in('user_id', profileIds)
    refundProfiles = ((data ?? []) as any[]) as MemberRow[]
  }

  let refundSubscriptions: SubscriptionRow[] = []
  if (subscriptionIds.length) {
    const { data } = await admin
      .from('subscriptions')
      .select('id, member_id, plan, status, start_date, end_date, amount, amount_due, payment_method, paid_at, created_at')
      .in('id', subscriptionIds)
    refundSubscriptions = ((data ?? []) as any[]) as SubscriptionRow[]
  }

  const allProfileMap = new Map<string, MemberRow>()
  for (const member of [...members, ...refundProfiles]) allProfileMap.set(member.user_id, member)

  const subscriptionMap = new Map<string, SubscriptionRow>()
  for (const subscription of [...subscriptions, ...refundSubscriptions]) subscriptionMap.set(subscription.id, subscription)

  const pendingCount = refunds.filter((r) => r.status === 'pending_review').length
  const approvedCount = refunds.filter((r) => r.status === 'approved').length
  const rejectedCount = refunds.filter((r) => r.status === 'rejected').length
  const paidCount = refunds.filter((r) => r.status === 'paid').length
  const totalPaid = refunds
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  const cancelledCount = refunds.filter((r) => r.status === 'cancelled').length
  const missingProofCount = refunds.filter((r) => !String(r.proof_url ?? '').trim()).length
  const linkedCount = refunds.filter((r) => r.subscription_id).length
  const impactAppliedCount = refunds.filter((r) => r.subscription_impact_status === 'applied').length

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted))]">Membership refunds</p>
          <h1 className="text-2xl font-bold">Exceptional refund workflow</h1>
          <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted))]">
            Track exceptional subscription refunds without deleting payments, subscriptions, access, freezes, Cash, Store, or Payment Reconciliation data. Write actions are restricted to Super Admin.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild variant="outline" href="/admin/members">
            ← Members
          </Button>
          <Button asChild variant="outline" href="/admin/payments">
            Payments
          </Button>
        </div>
      </div>

      {(membersError || subscriptionsError) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {membersError ? <p>Members load warning: {membersError.message}</p> : null}
          {subscriptionsError ? <p>Subscriptions load warning: {subscriptionsError.message}</p> : null}
        </div>
      ) : null}

      {!canWrite ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <p className="font-semibold">Read-only access</p>
          <p className="mt-1 text-xs">
            Only Super Admin can create refund requests, upload refund proof, approve/reject, mark refunds as paid, cancel records, or apply subscription impact decisions.
          </p>
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-950/70">Pending review</div>
          <div className="mt-1 text-xl font-bold">{pendingCount}</div>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-950/70">Approved</div>
          <div className="mt-1 text-xl font-bold">{approvedCount}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900/70">Paid refunds</div>
          <div className="mt-1 text-xl font-bold">{formatMoney(totalPaid)}</div>
          <div className="mt-1 text-xs text-emerald-900/70">Paid records: {paidCount}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Linked subscriptions</div>
          <div className="mt-1 text-xl font-bold">{linkedCount}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">Impact decisions: {impactAppliedCount}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Proof / closed</div>
          <div className="mt-1 text-xl font-bold">{missingProofCount}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">Missing proof · rejected {rejectedCount} · cancelled {cancelledCount}</div>
        </div>
      </section>

      {canWrite ? <MembershipRefundForm members={members} subscriptions={subscriptions} initialMemberId={selectedMemberId} /> : null}

      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Refund workflow history</h2>
            <p className="text-sm text-[hsl(var(--muted))]">
              Separate audit records. Approval/payment status is tracked without modifying original subscriptions or payments.
            </p>
          </div>
          {selectedMemberId ? (
            <Button asChild variant="outline" size="sm" href="/admin/membership-refunds">
              Clear member filter
            </Button>
          ) : null}
        </div>

        {refundsErrorMessage ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Refund history not available yet.</p>
            <p className="mt-1">{refundsErrorMessage}</p>
            <p className="mt-1 text-xs">Apply the Membership Refunds Lot 1A, Lot 1B and Lot 1C migrations if this is the first deployment of the workflow.</p>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {refunds.map((refund) => {
            const member = allProfileMap.get(refund.member_id)
            const subscription = refund.subscription_id ? subscriptionMap.get(refund.subscription_id) : null
            const createdBy = refund.created_by ? allProfileMap.get(refund.created_by) : null
            const approvedBy = refund.approved_by ? allProfileMap.get(refund.approved_by) : null
            const rejectedBy = refund.rejected_by ? allProfileMap.get(refund.rejected_by) : null
            const paidBy = refund.paid_by ? allProfileMap.get(refund.paid_by) : null
            const cancelledBy = refund.cancelled_by ? allProfileMap.get(refund.cancelled_by) : null
            const impactAppliedBy = refund.subscription_impact_applied_by ? allProfileMap.get(refund.subscription_impact_applied_by) : null
            const hasProof = Boolean(String(refund.proof_url ?? '').trim())
            const isClosed = refund.status === 'paid' || refund.status === 'rejected' || refund.status === 'cancelled'
            const needsAction = refund.status === 'pending_review' || refund.status === 'approved'
            const displayMemberName = memberName(member)
            const displaySubscriptionLabel = subscriptionLabel(subscription)

            return (
              <div
                key={refund.id}
                className={`rounded-2xl border p-4 shadow-soft ${
                  refund.status === 'pending_review'
                    ? 'border-amber-200 bg-amber-50/70'
                    : refund.status === 'approved'
                      ? 'border-sky-200 bg-sky-50/70'
                      : refund.status === 'rejected'
                        ? 'border-rose-200 bg-rose-50/70'
                        : refund.status === 'cancelled'
                          ? 'border-slate-200 bg-slate-50'
                          : hasProof
                            ? 'border-[hsl(var(--border))] bg-white'
                            : 'border-amber-200 bg-amber-50/40'
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{displayMemberName}</h3>
                      <Badge className={statusBadgeClass(refund.status)}>{statusLabel(refund.status)}</Badge>
                      <Badge className={hasProof ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-amber-200 bg-amber-100 text-amber-950'}>
                        {hasProof ? 'Proof attached' : 'Missing proof'}
                      </Badge>
                      {needsAction ? <Badge className="border-purple-200 bg-purple-50 text-purple-950">Action needed</Badge> : null}
                      {isClosed ? <Badge className="border-slate-200 bg-slate-50 text-slate-700">Closed</Badge> : null}
                      {refund.subscription_id ? (
                        <Badge className={impactBadgeClass(refund.subscription_impact_status)}>
                          Subscription impact: {impactStatusLabel(refund.subscription_impact_status)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      Member ID: <code>{member?.member_id || '—'}</code> · Requested date {formatDate(refund.refunded_at)}
                    </div>
                  </div>
                  <div className="text-left lg:text-right">
                    <div className="text-xl font-bold">{formatMoney(refund.amount)}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{methodLabel(refund.refund_method)}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 text-sm lg:grid-cols-4">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Subscription</div>
                    <div className="mt-1 font-medium">{displaySubscriptionLabel}</div>
                    {subscription ? (
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                        Original amount: {formatMoney(subscription.amount)} · Due: {formatMoney(subscription.amount_due)}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Reason</div>
                    <div className="mt-1 whitespace-pre-wrap font-medium">{refund.reason || '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Workflow</div>
                    <div className="mt-1 font-medium">{workflowLabel(refund.status)}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Created {formatDate(refund.created_at)} by {createdBy ? memberName(createdBy) : '—'}</div>
                    {refund.approved_at ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Approved {formatDate(refund.approved_at)} by {approvedBy ? memberName(approvedBy) : '—'}</div> : null}
                    {refund.paid_at ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Paid {formatDate(refund.paid_at)} by {paidBy ? memberName(paidBy) : '—'}</div> : null}
                    {refund.rejected_at ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Rejected {formatDate(refund.rejected_at)} by {rejectedBy ? memberName(rejectedBy) : '—'}</div> : null}
                    {refund.cancelled_at ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Cancelled {formatDate(refund.cancelled_at)} by {cancelledBy ? memberName(cancelledBy) : '—'}</div> : null}
                    {hasProof ? (
                      <a href={proofHref(refund.proof_url)} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold underline">
                        Open proof
                      </a>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Subscription impact</div>
                    <div className="mt-1 font-medium">{impactActionLabel(refund.subscription_impact_action)}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Status: {impactStatusLabel(refund.subscription_impact_status)}</div>
                    {refund.subscription_impact_applied_at ? (
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">Applied {formatDate(refund.subscription_impact_applied_at)} by {impactAppliedBy ? memberName(impactAppliedBy) : '—'}</div>
                    ) : null}
                    {(refund.subscription_impact_original_status || refund.subscription_impact_new_status || refund.subscription_impact_original_end_date || refund.subscription_impact_new_end_date) ? (
                      <div className="mt-2 rounded-xl border border-[hsl(var(--border))] bg-white/70 p-2 text-xs text-[hsl(var(--muted))]">
                        <div>Status: {refund.subscription_impact_original_status || '—'} → {refund.subscription_impact_new_status || '—'}</div>
                        <div>End date: {formatDate(refund.subscription_impact_original_end_date)} → {formatDate(refund.subscription_impact_new_end_date)}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {refund.subscription_impact_reason ? (
                  <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Subscription impact reason</div>
                    <div className="mt-1 whitespace-pre-wrap">{refund.subscription_impact_reason}</div>
                  </div>
                ) : null}

                {(refund.rejection_reason || refund.cancellation_reason) ? (
                  <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                      {refund.rejection_reason ? 'Rejection reason' : 'Cancellation reason'}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{refund.rejection_reason || refund.cancellation_reason}</div>
                  </div>
                ) : null}

                {refund.internal_note ? (
                  <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Internal note</div>
                    <div className="mt-1 whitespace-pre-wrap">{refund.internal_note}</div>
                  </div>
                ) : null}

                {canWrite ? (
                  <>
                    <MembershipRefundWorkflowActions
                      refund={{ id: refund.id, status: refund.status, amount: refund.amount, refund_method: refund.refund_method }}
                      memberLabel={displayMemberName}
                      subscriptionLabel={displaySubscriptionLabel}
                    />

                    <MembershipRefundSubscriptionImpactActions
                      refund={{
                        id: refund.id,
                        status: refund.status,
                        amount: refund.amount,
                        subscription_id: refund.subscription_id,
                        subscription_impact_action: refund.subscription_impact_action,
                        subscription_impact_status: refund.subscription_impact_status,
                        subscription_impact_applied_at: refund.subscription_impact_applied_at,
                      }}
                      subscription={subscription ? {
                        id: subscription.id,
                        status: subscription.status,
                        start_date: subscription.start_date,
                        end_date: subscription.end_date,
                        plan: subscription.plan,
                        amount: subscription.amount,
                        amount_due: subscription.amount_due,
                      } : null}
                      memberLabel={displayMemberName}
                      subscriptionLabel={displaySubscriptionLabel}
                    />
                  </>
                ) : null}
              </div>
            )
          })}

          {!refundsErrorMessage && refunds.length === 0 ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-6 text-center text-sm text-[hsl(var(--muted))]">
              No refund records yet.
            </div>
          ) : null}
        </div>
      </section>

      <p className="text-xs text-[hsl(var(--muted))]">
        Membership Refunds Lot 1D. This page tracks refund workflow, proof uploads and explicit subscription impact decisions. Write actions are restricted to Super Admin. Original payments are never deleted and no subscription impact is applied without confirmation.
      </p>
    </main>
  )
}
