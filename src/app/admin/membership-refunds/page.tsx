// src/app/admin/membership-refunds/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import MembershipRefundForm from '@/components/members/MembershipRefundForm'
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

export default async function AdminMembershipRefundsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const rawMemberId = getOne(searchParams?.memberId)?.trim() || ''
  const currentPath = `/admin/membership-refunds${rawMemberId ? `?memberId=${encodeURIComponent(rawMemberId)}` : ''}`

  const me = await getSessionUser()
  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  const canManage = me.role === 'admin' || me.role === 'super_admin'

  if (!canManage) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Membership refunds</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can record exceptional membership refunds."
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
      .select('id, member_id, subscription_id, amount, refund_method, reason, internal_note, proof_url, status, refunded_at, created_by, created_at')
      .order('refunded_at', { ascending: false })
      .limit(200)

    if (selectedMemberId) refundQuery = refundQuery.eq('member_id', selectedMemberId)

    const { data, error } = await refundQuery
    if (error) refundsErrorMessage = error.message
    refunds = ((data ?? []) as any[]) as RefundRow[]
  } catch (e: any) {
    refundsErrorMessage = e?.message ?? String(e)
  }

  const profileIds = Array.from(new Set(refunds.flatMap((r) => [r.member_id, r.created_by].filter(Boolean) as string[])))
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

  const totalPaid = refunds
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  const cancelledCount = refunds.filter((r) => r.status === 'cancelled').length
  const missingProofCount = refunds.filter((r) => !String(r.proof_url ?? '').trim()).length
  const linkedCount = refunds.filter((r) => r.subscription_id).length

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted))]">Membership refunds</p>
          <h1 className="text-2xl font-bold">Exceptional refund records</h1>
          <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted))]">
            Record exceptional subscription refunds without deleting payments, subscriptions, access, freezes, Cash, Store, or Payment Reconciliation data.
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

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Paid refunds</div>
          <div className="mt-1 text-xl font-bold">{formatMoney(totalPaid)}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Records</div>
          <div className="mt-1 text-xl font-bold">{refunds.length}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Linked subscriptions</div>
          <div className="mt-1 text-xl font-bold">{linkedCount}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Missing proof</div>
          <div className="mt-1 text-xl font-bold">{missingProofCount}</div>
          {cancelledCount ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Cancelled records: {cancelledCount}</div> : null}
        </div>
      </section>

      <MembershipRefundForm members={members} subscriptions={subscriptions} initialMemberId={selectedMemberId} />

      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Refund history</h2>
            <p className="text-sm text-[hsl(var(--muted))]">
              Separate audit records. Original subscriptions and payments are preserved.
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
            <p className="mt-1 text-xs">Apply the Membership Refunds Lot 1A migration if this is the first deployment of the feature.</p>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {refunds.map((refund) => {
            const member = allProfileMap.get(refund.member_id)
            const subscription = refund.subscription_id ? subscriptionMap.get(refund.subscription_id) : null
            const actor = refund.created_by ? allProfileMap.get(refund.created_by) : null
            const hasProof = Boolean(String(refund.proof_url ?? '').trim())
            const isCancelled = refund.status === 'cancelled'

            return (
              <div
                key={refund.id}
                className={`rounded-2xl border p-4 shadow-soft ${
                  isCancelled
                    ? 'border-slate-200 bg-slate-50'
                    : hasProof
                      ? 'border-[hsl(var(--border))] bg-white'
                      : 'border-amber-200 bg-amber-50/60'
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{memberName(member)}</h3>
                      <Badge className={isCancelled ? 'border-slate-300 bg-slate-100' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}>
                        {isCancelled ? 'Cancelled' : 'Paid refund'}
                      </Badge>
                      <Badge className={hasProof ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-amber-200 bg-amber-100 text-amber-950'}>
                        {hasProof ? 'Proof attached' : 'Missing proof'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      Member ID: <code>{member?.member_id || '—'}</code> · Refunded at {formatDate(refund.refunded_at)}
                    </div>
                  </div>
                  <div className="text-left lg:text-right">
                    <div className="text-xl font-bold">{formatMoney(refund.amount)}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{methodLabel(refund.refund_method)}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 text-sm lg:grid-cols-3">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Subscription</div>
                    <div className="mt-1 font-medium">{subscriptionLabel(subscription)}</div>
                    {subscription ? (
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                        Original amount: {formatMoney(subscription.amount)} · Due: {formatMoney(subscription.amount_due)}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Reason</div>
                    <div className="mt-1 font-medium whitespace-pre-wrap">{refund.reason || '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Audit</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Created {formatDate(refund.created_at)}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">By {actor ? memberName(actor) : '—'}</div>
                    {hasProof ? (
                      <a href={refund.proof_url || '#'} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold underline">
                        Open proof
                      </a>
                    ) : null}
                  </div>
                </div>

                {refund.internal_note ? (
                  <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Internal note</div>
                    <div className="mt-1 whitespace-pre-wrap">{refund.internal_note}</div>
                  </div>
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
        Membership Refunds Lot 1A. This page records exceptional refund traces only. It does not reverse payments or modify subscriptions/access automatically.
      </p>
    </main>
  )
}
