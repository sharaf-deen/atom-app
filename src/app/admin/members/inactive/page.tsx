// src/app/admin/members/inactive/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  MEMBER_LIFETIME_ACCESS_ROLES,
  MEMBER_LIKE_ROLES,
  canAccessMembersList,
  hasLifetimeGymAccess,
  normalizeRole,
  type Role,
} from '@/lib/rbac'
import { cairoTodayDateOnly } from '@/lib/cairoTime'

type InactiveReason =
  | 'all'
  | 'expired_subscription'
  | 'never_subscribed'
  | 'remaining_due'
  | 'freeze_ended'
  | 'incomplete_profile'
  | 'no_active_subscription'

type MemberRow = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  created_at: string | null
  date_of_birth: string | null
}

type SubscriptionRow = {
  id: string
  member_id: string | null
  plan: string | null
  subscription_type: 'time' | 'sessions' | string | null
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
  created_at: string | null
}

type InactiveMember = {
  member: MemberRow
  latestSub: SubscriptionRow | null
  primaryReason: Exclude<InactiveReason, 'all'>
  reasonLabel: string
  reasonDetail: string
  suggestedAction: string
  inactiveSinceLabel: string
  inactiveDays: number | null
  profileIssues: string[]
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const DEFAULT_PAGE_SIZE = 20
const REASON_OPTIONS: { value: InactiveReason; label: string }[] = [
  { value: 'all', label: 'All reasons' },
  { value: 'expired_subscription', label: 'Expired subscription' },
  { value: 'never_subscribed', label: 'Never subscribed' },
  { value: 'remaining_due', label: 'Remaining due' },
  { value: 'freeze_ended', label: 'Freeze ended' },
  { value: 'incomplete_profile', label: 'Incomplete profile' },
  { value: 'no_active_subscription', label: 'No active subscription' },
]
const MEMBER_ROLE_OPTIONS: { value: '' | Role; label: string }[] = [
  { value: '', label: 'All member roles' },
  { value: 'member', label: 'Member' },
  { value: 'champion', label: 'Champion' },
  { value: 'vip', label: 'VIP' },
]

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function normalizeReason(value: unknown): InactiveReason {
  const s = typeof value === 'string' ? value : 'all'
  return REASON_OPTIONS.some((option) => option.value === s) ? (s as InactiveReason) : 'all'
}

function normalizeMemberRoleFilter(value: unknown): '' | Role {
  const role = normalizeRole(value)
  return (MEMBER_LIKE_ROLES as readonly Role[]).includes(role) ? role : ''
}

function isISODateOnly(value?: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateValue(value?: string | null) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const clean = String(value).slice(0, 10)
  if (!isISODateOnly(clean)) return clean
  const [y, m, d] = clean.split('-')
  return `${d}/${m}/${y}`
}

function diffDays(fromDate: string | null | undefined, toDate: string) {
  if (!fromDate) return null
  const from = String(fromDate).slice(0, 10)
  if (!isISODateOnly(from) || !isISODateOnly(toDate)) return null
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const end = Date.UTC(Number(toDate.slice(0, 4)), Number(toDate.slice(5, 7)) - 1, Number(toDate.slice(8, 10)))
  const days = Math.floor((end - start) / 86_400_000)
  return Number.isFinite(days) ? Math.max(days, 0) : null
}

function isFrozenNow(sub: SubscriptionRow, today: string) {
  const st = (sub.subscription_type ?? (sub.end_date ? 'time' : 'sessions')) as 'time' | 'sessions'
  if (st !== 'time') return false
  const until = isISODateOnly(sub.frozen_until) ? sub.frozen_until : null
  if (!until) return false
  const from = isISODateOnly(sub.frozen_from) ? sub.frozen_from : null
  return from ? today >= from && today < until : today < until
}

function isSubscriptionActive(sub: SubscriptionRow, today: string) {
  const status = String(sub.status ?? '').toLowerCase()
  if (status !== 'active') return false
  if (isFrozenNow(sub, today)) return false

  const type = (sub.subscription_type ?? (sub.end_date ? 'time' : 'sessions')) as string
  if (type === 'sessions') {
    const total = Number(sub.sessions_total ?? 0)
    const used = Number(sub.sessions_used ?? 0)
    return total > 0 && used < total
  }

  return isISODateOnly(sub.end_date) && (sub.end_date as string) >= today
}

function hasEndedFreeze(sub: SubscriptionRow | null, today: string) {
  if (!sub?.frozen_until || !isISODateOnly(sub.frozen_until)) return false
  return sub.frozen_until < today
}

function formatEGP(value: number | null | undefined) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '—'
  return `EGP ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function roleLabel(role: Role | null | undefined) {
  if (!role) return 'Member'
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function memberName(member: MemberRow) {
  return `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || 'Unnamed member'
}

function profileIssues(member: MemberRow) {
  const issues: string[] = []
  if (!String(member.email ?? '').trim()) issues.push('Missing email')
  if (!String(member.phone ?? '').trim()) issues.push('Missing phone')
  if (!String(member.date_of_birth ?? '').trim()) issues.push('Missing date of birth')
  return issues
}

function latestSubscriptionFor(memberId: string, byMember: Map<string, SubscriptionRow[]>) {
  const rows = byMember.get(memberId) ?? []
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => {
    const aValue = dateValue(a.end_date) || dateValue(a.created_at) || dateValue(a.start_date)
    const bValue = dateValue(b.end_date) || dateValue(b.created_at) || dateValue(b.start_date)
    return bValue - aValue
  })[0]
}

function buildInactiveMember(member: MemberRow, latestSub: SubscriptionRow | null, today: string): InactiveMember {
  const issues = profileIssues(member)
  const due = Number(latestSub?.amount_due ?? 0)
  const hasDue = Number.isFinite(due) && due > 0
  const freezeEnded = hasEndedFreeze(latestSub, today)
  const endDate = latestSub?.end_date ?? null
  const createdAt = member.created_at ? String(member.created_at).slice(0, 10) : null

  let primaryReason: InactiveMember['primaryReason'] = 'no_active_subscription'
  let reasonLabel = 'No active subscription'
  let reasonDetail = 'No valid active access was found for this account.'
  let suggestedAction = 'Review the member profile and subscription status.'
  let inactiveSinceLabel = 'Inactive since unknown'
  let inactiveDays: number | null = null

  if (issues.length > 0) {
    primaryReason = 'incomplete_profile'
    reasonLabel = 'Incomplete profile'
    reasonDetail = issues.join(' · ')
    suggestedAction = 'Complete or correct the profile details before follow-up.'
    inactiveDays = diffDays(createdAt, today)
    inactiveSinceLabel = inactiveDays === null ? 'Created date unknown' : `Created ${inactiveDays} day(s) ago`
  }

  if (!latestSub && issues.length === 0) {
    primaryReason = 'never_subscribed'
    reasonLabel = 'Never subscribed'
    reasonDetail = 'No subscription history was found for this member.'
    suggestedAction = 'Check if the account was created by mistake or add the first subscription.'
    inactiveDays = diffDays(createdAt, today)
    inactiveSinceLabel = inactiveDays === null ? 'Created date unknown' : `Created ${inactiveDays} day(s) ago`
  }

  if (latestSub && issues.length === 0) {
    const status = String(latestSub.status ?? '').toLowerCase() || 'unknown'
    inactiveDays = diffDays(endDate, today)
    inactiveSinceLabel = inactiveDays === null ? 'Inactive date unknown' : `Inactive for ${inactiveDays} day(s)`

    if (hasDue) {
      primaryReason = 'remaining_due'
      reasonLabel = 'Remaining due'
      reasonDetail = `Latest subscription has ${formatEGP(due)} remaining due.`
      suggestedAction = 'Open the member profile and settle or follow up on the remaining due.'
    } else if (freezeEnded) {
      primaryReason = 'freeze_ended'
      reasonLabel = 'Freeze ended'
      reasonDetail = `Freeze ended on ${formatDate(latestSub.frozen_until)} and no active access is currently available.`
      suggestedAction = 'Contact the member after freeze and renew or reactivate if needed.'
      inactiveDays = diffDays(latestSub.frozen_until, today)
      inactiveSinceLabel = inactiveDays === null ? 'Freeze end unknown' : `Freeze ended ${inactiveDays} day(s) ago`
    } else if (isISODateOnly(endDate) && (endDate as string) < today) {
      primaryReason = 'expired_subscription'
      reasonLabel = 'Expired subscription'
      reasonDetail = `Latest subscription ended on ${formatDate(endDate)}.`
      suggestedAction = 'Send a renewal reminder or create a new subscription.'
    } else if (status !== 'active') {
      primaryReason = 'no_active_subscription'
      reasonLabel = 'No active subscription'
      reasonDetail = `Latest subscription status is ${status}.`
      suggestedAction = 'Review the status and create or reactivate a subscription if needed.'
      inactiveDays = diffDays(latestSub.created_at ?? createdAt, today)
      inactiveSinceLabel = inactiveDays === null ? 'Inactive date unknown' : `Latest record ${inactiveDays} day(s) ago`
    }
  }

  return {
    member,
    latestSub,
    primaryReason,
    reasonLabel,
    reasonDetail,
    suggestedAction,
    inactiveSinceLabel,
    inactiveDays,
    profileIssues: issues,
  }
}

function buildPageHref(args: {
  page: number
  q: string
  reason: InactiveReason
  role: '' | Role
  inactiveSince: number
  pageSize: number
}) {
  const sp = new URLSearchParams()
  if (args.q) sp.set('q', args.q)
  if (args.reason !== 'all') sp.set('reason', args.reason)
  if (args.role) sp.set('role', args.role)
  if (args.inactiveSince > 0) sp.set('inactiveSince', String(args.inactiveSince))
  if (args.pageSize !== DEFAULT_PAGE_SIZE) sp.set('pageSize', String(args.pageSize))
  if (args.page > 1) sp.set('page', String(args.page))
  const qs = sp.toString()
  return qs ? `/admin/members/inactive?${qs}` : '/admin/members/inactive'
}

export default async function AdminInactiveMembersPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const q = String(firstParam(searchParams?.q) ?? '').trim()
  const reason = normalizeReason(firstParam(searchParams?.reason))
  const role = normalizeMemberRoleFilter(firstParam(searchParams?.role))
  const inactiveSince = clampInt(firstParam(searchParams?.inactiveSince), 0, 0, 3650)
  const pageSizeRaw = clampInt(firstParam(searchParams?.pageSize), DEFAULT_PAGE_SIZE, 5, 50)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE
  const page = clampInt(firstParam(searchParams?.page), 1, 1, 1_000_000)

  const currentPath = buildPageHref({ page, q, reason, role, inactiveSince, pageSize })
  const me = await getSessionUser()
  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  if (!canAccessMembersList(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Inactive accounts</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Reception / Admin / Super Admin can access inactive member accounts."
            nextPath="/admin/members/inactive"
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
        <h1 className="text-2xl font-bold">Inactive accounts</h1>
        <p className="mt-3 text-sm text-rose-700">Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY</p>
      </main>
    )
  }

  const today = cairoTodayDateOnly()

  const { data: profilesData, error: profilesError } = await admin
    .from('profiles')
    .select('user_id,member_id,email,first_name,last_name,phone,role,created_at,date_of_birth')
    .in('role', [...MEMBER_LIKE_ROLES])
    .order('created_at', { ascending: false })

  const { data: subscriptionsData, error: subscriptionsError } = await admin
    .from('subscriptions')
    .select('id,member_id,plan,subscription_type,status,start_date,end_date,frozen_from,frozen_until,sessions_total,sessions_used,amount,amount_due,payment_method,created_at')
    .order('created_at', { ascending: false })

  const profiles = ((profilesData ?? []) as MemberRow[]).filter((member) => !hasLifetimeGymAccess(member.role))
  const subscriptions = (subscriptionsData ?? []) as SubscriptionRow[]

  const subsByMember = new Map<string, SubscriptionRow[]>()
  for (const sub of subscriptions) {
    if (!sub.member_id) continue
    const existing = subsByMember.get(sub.member_id) ?? []
    existing.push(sub)
    subsByMember.set(sub.member_id, existing)
  }

  const activeIds = new Set<string>()
  for (const member of profiles) {
    if ((MEMBER_LIFETIME_ACCESS_ROLES as readonly Role[]).includes(member.role as Role)) {
      activeIds.add(member.user_id)
    }
  }
  for (const sub of subscriptions) {
    if (!sub.member_id) continue
    if (isSubscriptionActive(sub, today)) activeIds.add(sub.member_id)
  }

  const inactiveAll = profiles
    .filter((member) => !activeIds.has(member.user_id))
    .map((member) => buildInactiveMember(member, latestSubscriptionFor(member.user_id, subsByMember), today))

  const counts = inactiveAll.reduce(
    (acc, item) => {
      acc.total += 1
      acc[item.primaryReason] = (acc[item.primaryReason] ?? 0) + 1
      return acc
    },
    {
      total: 0,
      expired_subscription: 0,
      never_subscribed: 0,
      remaining_due: 0,
      freeze_ended: 0,
      incomplete_profile: 0,
      no_active_subscription: 0,
    } as Record<Exclude<InactiveReason, 'all'> | 'total', number>,
  )

  const needle = q.toLowerCase()
  const filtered = inactiveAll.filter((item) => {
    if (reason !== 'all' && item.primaryReason !== reason) return false
    if (role && item.member.role !== role) return false
    if (inactiveSince > 0 && (item.inactiveDays === null || item.inactiveDays < inactiveSince)) return false
    if (!needle) return true

    const haystack = [
      memberName(item.member),
      item.member.member_id,
      item.member.email,
      item.member.phone,
      item.reasonLabel,
      item.reasonDetail,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const from = (safePage - 1) * pageSize
  const rows = filtered.slice(from, from + pageSize)

  const baseArgs = { q, reason, role, inactiveSince, pageSize }
  const hasFilters = Boolean(q || reason !== 'all' || role || inactiveSince > 0 || pageSize !== DEFAULT_PAGE_SIZE)

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inactive accounts</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            Read-only view of member-like accounts without active access. Staff roles and lifetime-access roles are excluded from the inactive count.
          </p>
        </div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
          <Button asChild variant="outline" href="/admin/members" className="w-full">
            ← Members
          </Button>
          <Button asChild variant="outline" href="/admin" className="w-full">
            Admin
          </Button>
        </div>
      </div>

      {(profilesError || subscriptionsError) ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {profilesError ? <p>Profiles error: {profilesError.message}</p> : null}
          {subscriptionsError ? <p>Subscriptions error: {subscriptionsError.message}</p> : null}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Inactive total</p>
          <p className="mt-2 text-3xl font-bold">{counts.total}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Expired</p>
          <p className="mt-2 text-3xl font-bold">{counts.expired_subscription}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Never subscribed</p>
          <p className="mt-2 text-3xl font-bold">{counts.never_subscribed}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Remaining due</p>
          <p className="mt-2 text-3xl font-bold">{counts.remaining_due}</p>
        </div>
      </section>

      <form action="/admin/members/inactive" className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_220px_180px_160px_130px_auto] lg:items-end">
          <label className="block">
            <span className="text-sm font-semibold">Search</span>
            <input
              name="q"
              defaultValue={q}
              type="search"
              placeholder="Name, email, phone, ATOM ID"
              className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold">Reason</span>
            <select name="reason" defaultValue={reason} className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black">
              {REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold">Role</span>
            <select name="role" defaultValue={role} className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black">
              {MEMBER_ROLE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold">Inactive since</span>
            <select name="inactiveSince" defaultValue={String(inactiveSince)} className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black">
              <option value="0">Any duration</option>
              <option value="7">7+ days</option>
              <option value="14">14+ days</option>
              <option value="30">30+ days</option>
              <option value="60">60+ days</option>
              <option value="90">90+ days</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold">Rows</span>
            <select name="pageSize" defaultValue={String(pageSize)} className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black">
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Button type="submit" className="w-full">Apply</Button>
            <Button asChild variant="outline" className={`w-full ${!hasFilters ? 'pointer-events-none opacity-50' : ''}`} href="/admin/members/inactive">
              Reset
            </Button>
          </div>
        </div>
      </form>

      <div className="flex flex-col gap-2 text-sm text-[hsl(var(--muted))] sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing <span className="font-semibold text-[hsl(var(--fg))]">{rows.length}</span> of{' '}
          <span className="font-semibold text-[hsl(var(--fg))]">{total}</span> filtered inactive account(s)
        </p>
        <p>Today: {formatDate(today)}</p>
      </div>

      <section className="space-y-3">
        {rows.map((item) => {
          const member = item.member
          const latest = item.latestSub
          return (
            <article key={member.user_id} className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold leading-6">{memberName(member)}</h2>
                    <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-xs font-semibold">{roleLabel(member.role)}</span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{item.reasonLabel}</span>
                  </div>
                  <p className="mt-1 text-sm text-[hsl(var(--muted))] break-words">
                    ID {member.member_id || '—'} · {member.email || 'No email'} · {member.phone || 'No phone'}
                  </p>
                </div>
                <Button asChild variant="outline" className="w-full lg:w-auto" href={`/members/${member.user_id}`}>
                  Open profile
                </Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                  <p className="text-xs font-semibold uppercase text-[hsl(var(--muted))]">Reason detail</p>
                  <p className="mt-1 text-sm font-medium">{item.reasonDetail}</p>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                  <p className="text-xs font-semibold uppercase text-[hsl(var(--muted))]">Inactive duration</p>
                  <p className="mt-1 text-sm font-medium">{item.inactiveSinceLabel}</p>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                  <p className="text-xs font-semibold uppercase text-[hsl(var(--muted))]">Latest subscription</p>
                  <p className="mt-1 text-sm font-medium">{latest ? `${latest.plan || 'Plan'} · ${latest.status || 'status unknown'}` : 'No subscription history'}</p>
                  {latest ? <p className="mt-1 text-xs text-[hsl(var(--muted))]">End: {formatDate(latest.end_date)} · Due: {formatEGP(latest.amount_due)}</p> : null}
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                  <p className="text-xs font-semibold uppercase text-[hsl(var(--muted))]">Suggested action</p>
                  <p className="mt-1 text-sm font-medium">{item.suggestedAction}</p>
                </div>
              </div>

              {item.profileIssues.length > 0 ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  Profile issue(s): {item.profileIssues.join(' · ')}
                </div>
              ) : null}
            </article>
          )
        })}

        {rows.length === 0 ? (
          <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center shadow-soft">
            <p className="font-semibold">No inactive accounts found</p>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Try changing the filters.</p>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-[hsl(var(--muted))]">
          Page <span className="font-medium text-[hsl(var(--fg))]">{safePage}</span> / {totalPages}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4">
          <Button asChild variant="outline" className={`w-full ${safePage <= 1 ? 'pointer-events-none opacity-50' : ''}`} href={buildPageHref({ ...baseArgs, page: 1 })}>First</Button>
          <Button asChild variant="outline" className={`w-full ${safePage <= 1 ? 'pointer-events-none opacity-50' : ''}`} href={buildPageHref({ ...baseArgs, page: Math.max(1, safePage - 1) })}>Prev</Button>
          <Button asChild variant="outline" className={`w-full ${safePage >= totalPages ? 'pointer-events-none opacity-50' : ''}`} href={buildPageHref({ ...baseArgs, page: Math.min(totalPages, safePage + 1) })}>Next</Button>
          <Button asChild variant="outline" className={`w-full ${safePage >= totalPages ? 'pointer-events-none opacity-50' : ''}`} href={buildPageHref({ ...baseArgs, page: totalPages })}>Last</Button>
        </div>
      </div>

      <p className="text-xs text-[hsl(var(--muted))]">
        Read-only Lot 1. No account is modified from this page. Attendance-based inactivity can be added later if scan history is required.
      </p>
    </main>
  )
}
