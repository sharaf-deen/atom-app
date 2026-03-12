// src/app/members/[id]/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'
import QrImage from '@/components/QrImage'
import SubscribeDialog, { type Plan } from '@/components/SubscribeDialog'
import SubscriptionManageRowActions from '@/components/SubscriptionManageRowActions'
import ResendInviteButton from '@/components/ResendInviteButton'

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}
function daysLeft(endDate?: string | null) {
  if (!endDate) return null
  const t = todayDateOnlyUTC()
  const ms = new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${t}T00:00:00Z`).getTime()
  return Math.floor(ms / 86400000)
}
function humanPlan(p?: Plan | null) {
  switch (p) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return 'Per sessions'
    default:
      return '—'
  }
}

function isUuid(v: string) {
  // Accepts common UUID formats (v1-v5). Good enough for routing.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

export default async function MemberDetailPage({ params }: { params: { id: string } }) {
  const me = await getSessionUser()
  const nextPath = `/members/${params.id}`

  if (!me) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  const STAFF: Role[] = ['reception', 'admin', 'super_admin']
  const isStaff = STAFF.includes(me.role)
  const canManageSubscriptions = ['admin', 'super_admin'].includes(me.role)
  const supa = createSupabaseRSC()

  const idIsUuid = isUuid(params.id)

  // Fast path: when the route param is a UUID, non-staff can only open their own UUID.
  if (idIsUuid && !isStaff && me.id !== params.id) {
    return (
      <AccessDeniedPage
        title="Member"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can view other members."
        allowed="reception, admin, super_admin"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  const { data: profile } = await supa
    .from('profiles')
    .select('user_id, member_id, email, first_name, last_name, phone, role, qr_code, created_at')
    .eq(idIsUuid ? 'user_id' : 'member_id', params.id)
    .maybeSingle<{
      user_id: string
      member_id: string | null
      email: string | null
      first_name: string | null
      last_name: string | null
      phone: string | null
      role: Role | null
      qr_code: string | null
      created_at: string | null
    }>()

  if (!profile) return notFound()

  // Staff can view anyone. Non-staff can only view self.
  const isSelf = me.id === profile.user_id
  if (!isStaff && !isSelf) {
    return (
      <AccessDeniedPage
        title="Member"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can view other members."
        allowed="reception, admin, super_admin"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  const { data: subs } = await supa
    .from('subscriptions')
    .select('id, plan, subscription_type, status, start_date, end_date, frozen_from, frozen_until, sessions_total, sessions_used, amount, amount_due, payment_method, paid_at')
    .eq('member_id', profile.user_id)
    .order('paid_at', { ascending: false })
    .limit(500) as {
    data: Array<{
      id: string
      plan: Plan | null
      subscription_type: 'time' | 'sessions' | null
      status: string | null
      start_date: string | null
      end_date: string | null
      frozen_from: string | null
      frozen_until: string | null
      sessions_total: number | null
      sessions_used: number | null
      amount: number | null
      amount_due: number | null
      payment_method: string | null
      paid_at: string | null
    }> | null
  }

  function humanPayment(m?: string | null) {
    switch (m) {
      case 'cash':
        return 'Cash'
      case 'instapay':
        return 'InstaPay'
      case 'card':
        return 'Card'
      case 'bank_transfer':
        return 'Bank transfer'
      default:
        return '—'
    }
  }

  // Prevent creating a new subscription when there's already an active one
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
  const hasActiveSubscription = (subs ?? []).some((s) => {
    const status = String(s.status ?? '').toLowerCase()
    if (status !== 'active') return false

    const end = s.end_date
    if (end && today > end) return false

    if (s.subscription_type === 'sessions') {
      const total = Number(s.sessions_total ?? 0)
      const used = Number(s.sessions_used ?? 0)
      if (Number.isFinite(total) && total > 0) return total - used > 0
    }

    return true
  })
  const subscribeDisabledReason = hasActiveSubscription
    ? 'This member already has an active subscription. Please expire/edit it first.'
    : undefined

  // Renewal: allow stacking a future time subscription that starts after the active one ends
  const activeTimeEnds = (subs ?? [])
    .filter((s) => {
      const status = String(s.status ?? '').toLowerCase()
      if (status !== 'active') return false
      if (s.plan === 'sessions') return false
      const end = s.end_date
      if (!end) return false
      return today <= end
    })
    .map((s) => s.end_date as string)

  const maxActiveTimeEnd = activeTimeEnds.length ? activeTimeEnds.sort().slice(-1)[0] : null
  const renewStartDate = maxActiveTimeEnd ? addDays(maxActiveTimeEnd, 1) : today
  const defaultRenewPlan: Plan =
    ((subs ?? []).find((s) => String(s.status ?? '').toLowerCase() === 'active' && s.plan !== 'sessions')?.plan as Plan) ?? '1m'

  // Attendance is a staff-only view.
  // Members / coaches can see their own profile + subscriptions, but not attendance.
  let attendance:
    | Array<{
        id: string
        date: string
        valid: boolean | null
        from_sessions: boolean | null
        subscription_id: string | null
      }>
    | null = null

  if (isStaff) {
    const today = todayDateOnlyUTC()
    const from = addDays(today, -30)
    const { data } = (await supa
      .from('attendance')
      .select('id, date, valid, from_sessions, subscription_id')
      .eq('member_id', profile.user_id)
      .gte('date', from)
      .lte('date', today)
      .order('date', { ascending: false })
      .limit(1000)) as {
      data:
        | Array<{
            id: string
            date: string
            valid: boolean | null
            from_sessions: boolean | null
            subscription_id: string | null
          }>
        | null
    }
    attendance = data ?? null
  }

  const subPlanById = new Map<string, Plan | null>((subs ?? []).map((s) => [s.id, s.plan]))

  const activeTime = (subs ?? []).filter((s) => s.plan !== 'sessions' && s.status === 'active')
  const activeSessions = (subs ?? []).filter((s) => s.plan === 'sessions' && s.status === 'active')
  const alerts: Array<{ kind: 'time' | 'sessions'; text: string }> = []

  for (const s of activeTime) {
    const dl = daysLeft(s.end_date)
    if (dl !== null && dl <= 7) alerts.push({ kind: 'time', text: `Time plan ${humanPlan(s.plan)} expires in ${dl} day(s)` })
  }
  for (const s of activeSessions) {
    const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
    if (remaining <= 2) alerts.push({ kind: 'sessions', text: `Sessions plan: only ${remaining} session(s) left` })
  }

  return (
    <main>
      <PageHeader
        title="Member"
        subtitle={isStaff ? 'Profile, QR, subscriptions and attendance' : 'Profile, QR and subscriptions'}
        right={
          isStaff ? (
            <Link
              href="/members"
              className="px-4 py-2 rounded-2xl border border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--bg))]/80 shadow-soft text-sm"
            >
              Back to list
            </Link>
          ) : null
        }
      />

      <Section className="space-y-6">
        {/* Identity + QR */}
        <section className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="font-semibold">Identity</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <div>
                <span className="text-[hsl(var(--muted))]">Name:</span>{' '}
                {(profile.first_name || profile.last_name)
                  ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
                  : '—'}
              </div>
              <div>
                <span className="text-[hsl(var(--muted))]">Member ID:</span>{' '}
                <code className="text-xs">{profile.member_id?.trim() || '—'}</code>
              </div>
              <div><span className="text-[hsl(var(--muted))]">Email:</span> {profile.email ?? '—'}</div>
              <div><span className="text-[hsl(var(--muted))]">Phone:</span> {profile.phone ?? '—'}</div>
              <div><span className="text-[hsl(var(--muted))]">Role:</span> {profile.role ?? 'member'}</div>
              <div><span className="text-[hsl(var(--muted))]">Joined:</span> {fmtDate(profile.created_at)}</div>
            </div>

            {isStaff ? (
              <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
                <ResendInviteButton userId={profile.user_id} email={profile.email} />
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft flex items-center justify-center">
            {profile.qr_code ? (
              <div className="text-center">
                <QrImage value={profile.qr_code} size={180} />
                <div className="text-xs text-[hsl(var(--muted))] mt-2">Show this code at reception</div>
              </div>
            ) : (
              <div className="text-sm text-[hsl(var(--muted))]">No QR code.</div>
            )}
          </div>
        </section>

        {/* Alerts */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <h2 className="font-semibold">Alerts</h2>
          {alerts.length === 0 ? (
            <div className="mt-2 text-sm text-[hsl(var(--muted))]">No alerts.</div>
          ) : (
            <ul className="mt-3 grid gap-2">
              {alerts.map((a, i) => (
                <li
                  key={i}
                  className={`text-sm px-3 py-2 rounded-2xl border ${
                    a.kind === 'time'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-rose-50 border-rose-300 text-rose-900'
                  }`}
                >
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Subscriptions */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <h2 className="font-semibold">Subscriptions</h2>

            {isStaff ? (
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <SubscribeDialog
                  member={{
                    user_id: profile.user_id,
                    email: profile.email,
                    first_name: profile.first_name,
                    last_name: profile.last_name,
                  }}
                  buttonLabel="New subscription"
                  defaultPlan="1m"
                  defaultSessions={10}
                  disabled={hasActiveSubscription}
                  disabledReason={subscribeDisabledReason}
                />

                {canManageSubscriptions && maxActiveTimeEnd ? (
                  <SubscribeDialog
                    member={{
                      user_id: profile.user_id,
                      email: profile.email,
                      first_name: profile.first_name,
                      last_name: profile.last_name,
                    }}
                    buttonLabel="Renew / Extend"
                    defaultPlan={defaultRenewPlan}
                    defaultStartDate={renewStartDate}
                    defaultSessions={10}
                    mode="renew"
                    lockStartDate
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {(subs ?? []).length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">No subscriptions yet.</div>
          ) : (
            <>
              {/* Mobile cards (no horizontal scroll) */}
              <div className="grid gap-3 sm:hidden">
                {(subs ?? []).map((s) => {
                  const isSessions = s.plan === 'sessions'
                  const isTime = !isSessions
                  const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
                  const dleft = daysLeft(s.end_date)
                  const soon = isTime && dleft !== null && dleft <= 7 && dleft >= 0
                  const expired = s.status === 'expired' || (isTime && (dleft ?? -999) < 0)

                  const today = todayDateOnlyUTC()
                  const isFrozen =
                    isTime &&
                    !!(
                      s.frozen_until &&
                      (s.frozen_from
                        ? today >= s.frozen_from && today < s.frozen_until
                        : today < s.frozen_until)
                    )
                  const freezeDays = isFrozen
                    ? Math.max(
                        0,
                        Math.floor(
                          (new Date(`${s.frozen_until}T00:00:00Z`).getTime() -
                            new Date(`${today}T00:00:00Z`).getTime()) /
                            86400000,
                        ),
                      )
                    : null

                  return (
                    <div
                      key={s.id}
                      className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft space-y-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50">
                          {humanPlan(s.plan)}
                        </span>
                        <span className="text-xs text-[hsl(var(--muted))]">
                          {fmtDate(s.start_date)} → {fmtDate(s.end_date)}
                        </span>
                        <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full border bg-gray-50">
                          {s.status ?? '—'}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Paid</div>
                          <div className="font-medium">{s.amount ?? 0}</div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Due</div>
                          <div className="font-medium">{Number(s.amount_due ?? 0) || 0}</div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Payment</div>
                          <div className="font-medium">{humanPayment(s.payment_method)}</div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Paid at</div>
                          <div className="font-medium">{fmtDate(s.paid_at)}</div>
                        </div>
                        {isSessions ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-[hsl(var(--muted))]">Sessions</div>
                            <div className="font-medium">
                              {s.sessions_used ?? 0}/{s.sessions_total ?? 0} (left {remaining})
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {isTime && typeof dleft === 'number' && dleft >= 0 && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                              soon
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            }`}
                          >
                            {dleft} day(s) left
                          </span>
                        )}
                        {expired && (
                          <span className="text-[11px] px-2 py-0.5 rounded-2xl border bg-rose-50 border-rose-300 text-rose-900">
                            expired
                          </span>
                        )}
                        {isFrozen && (
                          <span className="text-[11px] px-2 py-0.5 rounded-2xl border bg-sky-50 border-sky-300 text-sky-900">
                            frozen{typeof freezeDays === 'number' ? ` (${freezeDays}d)` : ''}
                          </span>
                        )}
                        {isSessions && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                              remaining <= 2
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            }`}
                          >
                            {remaining} left
                          </span>
                        )}
                      </div>

                      {canManageSubscriptions ? (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
                          <SubscriptionManageRowActions sub={s} />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[hsl(var(--muted))]">
                    <tr className="border-b border-[hsl(var(--border))]">
                      <th className="text-left px-3 py-2">Plan</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Start</th>
                      <th className="text-left px-3 py-2">End</th>
                      <th className="text-left px-3 py-2">Sessions</th>
                      <th className="text-left px-3 py-2">Paid</th>
                      <th className="text-left px-3 py-2">Payment</th>
                      <th className="text-left px-3 py-2">Due</th>
                      <th className="text-left px-3 py-2">Paid at</th>
                      <th className="text-left px-3 py-2">Badges</th>
                      {canManageSubscriptions && <th className="text-left px-3 py-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(subs ?? []).map((s) => {
                      const isSessions = s.plan === 'sessions'
                      const isTime = !isSessions
                      const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
                      const dleft = daysLeft(s.end_date)
                      const soon = isTime && dleft !== null && dleft <= 7 && dleft >= 0
                      const expired = s.status === 'expired' || (isTime && (dleft ?? -999) < 0)

                      const today = todayDateOnlyUTC()
                      // Freeze logic (controlled range):
                      // - If frozen_from exists: frozen when today >= frozen_from AND today < frozen_until (exclusive end)
                      // - Legacy: if only frozen_until exists: frozen when today < frozen_until
                      const isFrozen =
                        isTime &&
                        !!(
                          s.frozen_until &&
                          (s.frozen_from
                            ? today >= s.frozen_from && today < s.frozen_until
                            : today < s.frozen_until)
                        )
                      const freezeDays = isFrozen
                        ? Math.max(
                            0,
                            Math.floor(
                              (new Date(`${s.frozen_until}T00:00:00Z`).getTime() -
                                new Date(`${today}T00:00:00Z`).getTime()) /
                                86400000,
                            ),
                          )
                        : null

                      return (
                        <tr key={s.id} className="border-t border-[hsl(var(--border))]">
                          <td className="px-3 py-2">{humanPlan(s.plan)}</td>
                          <td className="px-3 py-2">{s.status ?? '—'}</td>
                          <td className="px-3 py-2">{fmtDate(s.start_date)}</td>
                          <td className="px-3 py-2">{fmtDate(s.end_date)}</td>
                          <td className="px-3 py-2">
                            {isSessions
                              ? `${s.sessions_used ?? 0}/${s.sessions_total ?? 0} (left ${remaining})`
                              : '—'}
                          </td>
                          <td className="px-3 py-2">{s.amount ?? 0}</td>
                          <td className="px-3 py-2">{humanPayment(s.payment_method)}</td>
                          <td className="px-3 py-2">{Number(s.amount_due ?? 0) || 0}</td>
                          <td className="px-3 py-2">{fmtDate(s.paid_at)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {isTime && typeof dleft === 'number' && dleft >= 0 && (
                                <span
                                  className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                                    soon
                                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                                      : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                  }`}
                                >
                                  {dleft} day(s) left
                                </span>
                              )}
                              {expired && (
                                <span className="text-[11px] px-2 py-0.5 rounded-2xl border bg-rose-50 border-rose-300 text-rose-900">
                                  expired
                                </span>
                              )}
                              {isFrozen && (
                                <span className="text-[11px] px-2 py-0.5 rounded-2xl border bg-sky-50 border-sky-300 text-sky-900">
                                  frozen{typeof freezeDays === 'number' ? ` (${freezeDays}d)` : ''}
                                </span>
                              )}
                              {isSessions && (
                                <span
                                  className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                                    remaining <= 2
                                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                                      : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                  }`}
                                >
                                  {remaining} left
                                </span>
                              )}
                            </div>
                          </td>
                          {canManageSubscriptions && (
                            <td className="px-3 py-2">
                              <SubscriptionManageRowActions sub={s} />
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Attendance (staff only) */}
        {isStaff ? (
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="font-semibold">Attendance (last 30 days)</h2>
            {(attendance ?? []).length === 0 ? (
              <div className="mt-2 text-sm text-[hsl(var(--muted))]">No attendance.</div>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[hsl(var(--muted))]">
                    <tr className="border-b border-[hsl(var(--border))]">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Valid</th>
                      <th className="text-left px-3 py-2">From sessions</th>
                      <th className="text-left px-3 py-2">Plan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(attendance ?? []).map((a) => (
                      <tr key={a.id} className="border-t border-[hsl(var(--border))]">
                        <td className="px-3 py-2">{fmtDate(a.date)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                              a.valid
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : 'bg-rose-50 border-rose-300 text-rose-900'
                            }`}
                          >
                            {a.valid ? 'valid' : 'invalid'}
                          </span>
                        </td>
                        <td className="px-3 py-2">{a.from_sessions ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2">
                          {a.subscription_id ? humanPlan(subPlanById.get(a.subscription_id) ?? null) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </Section>
    </main>
  )
}

