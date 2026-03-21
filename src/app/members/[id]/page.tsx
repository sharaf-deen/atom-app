// src/app/members/[id]/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CreditCard,
  Mail,
  Phone,
  QrCode,
  ScanLine,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser, type Role } from '@/lib/session'
import { addDays, cairoToday, diffDays } from '@/lib/cairoDate'
import QrImage from '@/components/QrImage'
import SubscribeDialog, { type Plan } from '@/components/SubscribeDialog'
import SubscriptionManageRowActions from '@/components/SubscriptionManageRowActions'
import ResendInviteButton from '@/components/ResendInviteButton'
import DeleteUserButton from '@/components/DeleteUserButton'

type ProfileRow = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  qr_code: string | null
  created_at: string | null
  date_of_birth: string | null
}

type SubscriptionRow = {
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
}

type AttendanceRow = {
  id: string
  date: string
  valid: boolean | null
  from_sessions: boolean | null
  subscription_id: string | null
}

type SummaryTone = 'success' | 'warning' | 'danger' | 'neutral'

type MembershipSummary = {
  tone: SummaryTone
  label: string
  title: string
  hint: string
}

type CoachTrainingUseful = {
  membershipNow: string
  membershipHint: string
  sessionsNow: string
  sessionsHint: string
  lastCheckIn: string
  lastCheckInHint: string
  attentionPoint: string
  attentionHint: string
}

type ReceptionDeskUseful = {
  checkInStatus: string
  checkInHint: string
  renewalState: string
  renewalHint: string
  paymentState: string
  paymentHint: string
  lastSeen: string
  lastSeenHint: string
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (Number.isNaN(dt.getTime())) return dateStr
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(dt)
}

function fmtMoneyEGP(value?: number | null) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0 EGP'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
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
      return 'Sessions'
    default:
      return 'Membership'
  }
}

function humanRole(role?: Role | null) {
  switch (role) {
    case 'assistant_coach':
      return 'Assistant coach'
    case 'super_admin':
      return 'Super admin'
    case 'coach':
      return 'Coach'
    case 'reception':
      return 'Reception'
    case 'admin':
      return 'Admin'
    default:
      return 'Member'
  }
}

function humanPayment(method?: string | null) {
  switch (method) {
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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function ageYears(dob?: string | null) {
  if (!dob) return null
  const dateOnly = dob.length === 10 ? dob : dob.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null
  const [y, m, d] = dateOnly.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(born.getTime())) return null

  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  if (age < 0) return null
  return age
}

function isFrozenNow(sub: Pick<SubscriptionRow, 'subscription_type' | 'frozen_from' | 'frozen_until'>, today: string) {
  const type = (sub.subscription_type ?? 'time') as 'time' | 'sessions'
  if (type !== 'time') return false
  const until = sub.frozen_until
  if (!until) return false
  const from = sub.frozen_from
  return from ? today >= from && today < until : today < until
}

function daysUntil(endDate?: string | null, today: string = cairoToday()) {
  if (!endDate) return null
  return diffDays(today, endDate)
}

function getSubscriptionDisplayState(
  sub: Pick<SubscriptionRow, 'subscription_type' | 'plan' | 'status' | 'end_date' | 'frozen_from' | 'frozen_until' | 'sessions_total' | 'sessions_used'>,
  today: string,
) {
  const type = (sub.subscription_type ?? (sub.plan === 'sessions' ? 'sessions' : 'time')) as 'time' | 'sessions'
  const isSessions = type === 'sessions'
  const frozen = !isSessions && isFrozenNow(sub, today)
  const left = !isSessions ? daysUntil(sub.end_date, today) : null
  const expired = !isSessions && left !== null && left < 0
  const remaining = isSessions
    ? Math.max(Number(sub.sessions_total ?? 0) - Number(sub.sessions_used ?? 0), 0)
    : null

  const rawStatus = String(sub.status ?? '').toLowerCase()

  let displayStatus = rawStatus || '—'
  if (!isSessions && rawStatus === 'active' && expired) displayStatus = 'expired'
  else if (!isSessions && rawStatus === 'active' && frozen) displayStatus = 'frozen'

  let statusTone: SummaryTone = 'neutral'
  if (displayStatus === 'active') statusTone = 'success'
  else if (displayStatus === 'frozen') statusTone = 'warning'
  else if (displayStatus === 'expired') statusTone = 'danger'

  return {
    type,
    isSessions,
    frozen,
    left,
    expired,
    remaining,
    displayStatus,
    statusTone,
  }
}

function toneClasses(tone: SummaryTone) {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function buildMembershipSummary(
  viewedRole: Role | null,
  isSelf: boolean,
  subs: SubscriptionRow[],
  today: string,
): MembershipSummary {
  if (isSelf && (viewedRole === 'coach' || viewedRole === 'assistant_coach')) {
    return {
      tone: 'success',
      label: 'Staff access',
      title: 'Always active',
      hint: 'Your staff access is active in the app.',
    }
  }

  const activeTime = subs.find((s) => {
    if ((s.subscription_type ?? 'time') !== 'time') return false
    if (String(s.status ?? '').toLowerCase() !== 'active') return false
    if (!s.end_date || s.end_date < today) return false
    return true
  })

  if (activeTime) {
    if (isFrozenNow(activeTime, today)) {
      return {
        tone: 'warning',
        label: 'Membership frozen',
        title: humanPlan(activeTime.plan),
        hint: `Frozen until ${fmtDate(activeTime.frozen_until)}`,
      }
    }

    const left = daysUntil(activeTime.end_date, today)
    return {
      tone: left !== null && left <= 7 ? 'warning' : 'success',
      label: left !== null && left <= 7 ? 'Expiring soon' : 'Membership active',
      title: humanPlan(activeTime.plan),
      hint:
        left === null
          ? 'Time membership active.'
          : left === 0
            ? 'Ends today.'
            : `${left} day(s) left · ends ${fmtDate(activeTime.end_date)}`,
    }
  }

  const activeSessions = subs.find((s) => {
    const type = (s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) as 'time' | 'sessions'
    if (type !== 'sessions') return false
    if (String(s.status ?? '').toLowerCase() !== 'active') return false
    const remaining = Math.max(Number(s.sessions_total ?? 0) - Number(s.sessions_used ?? 0), 0)
    return remaining > 0
  })

  if (activeSessions) {
    const remaining = Math.max(Number(activeSessions.sessions_total ?? 0) - Number(activeSessions.sessions_used ?? 0), 0)
    return {
      tone: remaining <= 2 ? 'warning' : 'success',
      label: remaining <= 2 ? 'Low sessions left' : 'Sessions active',
      title: `${remaining} session(s) left`,
      hint: `${activeSessions.sessions_used ?? 0}/${activeSessions.sessions_total ?? 0} used`,
    }
  }

  const latest = subs[0]
  if (latest) {
    return {
      tone: 'neutral',
      label: 'No active membership',
      title: humanPlan(latest.plan),
      hint: latest.end_date ? `Last ended ${fmtDate(latest.end_date)}` : `Last paid ${fmtDate(latest.paid_at)}`,
    }
  }

  return {
    tone: 'neutral',
    label: 'No subscription',
    title: 'No active membership',
    hint: 'No subscription history yet.',
  }
}

function buildCoachTrainingUseful(subs: SubscriptionRow[], attendance: AttendanceRow[], today: string): CoachTrainingUseful {
  const activeTime = subs.find((s) => {
    const status = String(s.status ?? '').toLowerCase()
    if (status !== 'active') return false
    if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'time') return false
    if (!s.end_date || s.end_date < today) return false
    return true
  })

  const activeSessions = subs.find((s) => {
    const status = String(s.status ?? '').toLowerCase()
    if (status !== 'active') return false
    const type = (s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) as 'time' | 'sessions'
    if (type !== 'sessions') return false
    const remaining = Math.max(Number(s.sessions_total ?? 0) - Number(s.sessions_used ?? 0), 0)
    return remaining > 0
  })

  let membershipNow = 'No active plan'
  let membershipHint = 'No active membership right now.'
  let sessionsNow = '—'
  let sessionsHint = 'No active sessions plan.'
  let attentionPoint = 'Needs review'
  let attentionHint = 'No active plan found.'

  if (activeTime) {
    if (isFrozenNow(activeTime, today)) {
      membershipNow = 'Frozen'
      membershipHint = `${humanPlan(activeTime.plan)} · until ${fmtDate(activeTime.frozen_until)}`
      attentionPoint = 'Frozen now'
      attentionHint = `Pause active until ${fmtDate(activeTime.frozen_until)}`
    } else {
      const left = daysUntil(activeTime.end_date, today)
      membershipNow = left !== null && left <= 7 ? 'Active · soon' : 'Active'
      membershipHint =
        left === null
          ? `${humanPlan(activeTime.plan)} active`
          : left === 0
            ? `${humanPlan(activeTime.plan)} ends today`
            : `${humanPlan(activeTime.plan)} · ${left} day(s) left`

      if (left !== null && left <= 7) {
        attentionPoint = 'Expiring soon'
        attentionHint = `${left} day(s) left`
      } else {
        attentionPoint = 'No urgent issue'
        attentionHint = 'Membership status looks okay.'
      }
    }
  } else if (activeSessions) {
    const remaining = Math.max(Number(activeSessions.sessions_total ?? 0) - Number(activeSessions.sessions_used ?? 0), 0)
    membershipNow = remaining <= 2 ? 'Sessions low' : 'Sessions active'
    membershipHint = `${humanPlan(activeSessions.plan)}`
    sessionsNow = `${remaining}`
    sessionsHint = `${activeSessions.sessions_used ?? 0}/${activeSessions.sessions_total ?? 0} used`

    if (remaining <= 2) {
      attentionPoint = 'Low sessions'
      attentionHint = `${remaining} session(s) left`
    } else {
      attentionPoint = 'No urgent issue'
      attentionHint = 'Sessions balance looks okay.'
    }
  } else {
    const latest = subs[0]
    if (latest) {
      membershipHint = latest.end_date
        ? `Last ended ${fmtDate(latest.end_date)}`
        : `Last update ${fmtDate(latest.paid_at)}`
      attentionPoint = 'Needs renewal'
      attentionHint = 'No active subscription found.'
    }
  }

  const validAttendance = attendance.filter((a) => a.valid).length
  const lastAttendance = attendance[0]?.date ?? null

  return {
    membershipNow,
    membershipHint,
    sessionsNow,
    sessionsHint,
    lastCheckIn: lastAttendance ? fmtDate(lastAttendance) : 'No recent check-in',
    lastCheckInHint: lastAttendance
      ? `${validAttendance} valid check-in(s) in last 30 days`
      : 'No valid attendance in the last 30 days.',
    attentionPoint,
    attentionHint,
  }
}

function buildReceptionDeskUseful(
  subs: SubscriptionRow[],
  attendance: AttendanceRow[],
  today: string,
  outstandingTotal: number,
): ReceptionDeskUseful {
  const activeTime = subs.find((s) => {
    const status = String(s.status ?? '').toLowerCase()
    if (status !== 'active') return false
    if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'time') return false
    if (!s.end_date || s.end_date < today) return false
    return true
  })

  const activeSessions = subs.find((s) => {
    const status = String(s.status ?? '').toLowerCase()
    if (status !== 'active') return false
    const type = (s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) as 'time' | 'sessions'
    if (type !== 'sessions') return false
    const remaining = Math.max(Number(s.sessions_total ?? 0) - Number(s.sessions_used ?? 0), 0)
    return remaining > 0
  })

  const latestPayment = subs.find((s) => !!s.paid_at)?.paid_at ?? null
  const validAttendance = attendance.filter((a) => a.valid).length
  const lastAttendance = attendance[0]?.date ?? null

  let checkInStatus = 'Not ready'
  let checkInHint = 'No active membership found.'
  let renewalState = 'Renew now'
  let renewalHint = 'No active plan.'
  let paymentState = outstandingTotal > 0 ? fmtMoneyEGP(outstandingTotal) : 'No due'
  let paymentHint = outstandingTotal > 0
    ? 'Outstanding due on subscriptions.'
    : latestPayment
      ? `Last payment ${fmtDate(latestPayment)}`
      : 'No due recorded.'
  let lastSeen = lastAttendance ? fmtDate(lastAttendance) : 'No recent check-in'
  let lastSeenHint = lastAttendance
    ? `${validAttendance} valid check-in(s) in last 30 days`
    : 'No attendance in the last 30 days.'

  if (activeTime) {
    if (isFrozenNow(activeTime, today)) {
      checkInStatus = 'Frozen'
      checkInHint = `Until ${fmtDate(activeTime.frozen_until)}`
      renewalState = 'Wait / review'
      renewalHint = 'Membership is currently frozen.'
    } else {
      const left = daysUntil(activeTime.end_date, today)
      checkInStatus = 'Ready'
      checkInHint =
        left === null
          ? `${humanPlan(activeTime.plan)} active`
          : left === 0
            ? `${humanPlan(activeTime.plan)} ends today`
            : `${humanPlan(activeTime.plan)} · ${left} day(s) left`

      if (left !== null && left <= 7) {
        renewalState = 'Renew soon'
        renewalHint = `${left} day(s) left`
      } else {
        renewalState = 'OK'
        renewalHint = 'No urgent renewal needed.'
      }
    }
  } else if (activeSessions) {
    const remaining = Math.max(Number(activeSessions.sessions_total ?? 0) - Number(activeSessions.sessions_used ?? 0), 0)
    checkInStatus = 'Ready'
    checkInHint = `${remaining} session(s) left`

    if (remaining <= 2) {
      renewalState = 'Low sessions'
      renewalHint = `${remaining} session(s) left`
    } else {
      renewalState = 'OK'
      renewalHint = 'Sessions balance looks okay.'
    }
  }

  return {
    checkInStatus,
    checkInHint,
    renewalState,
    renewalHint,
    paymentState,
    paymentHint,
    lastSeen,
    lastSeenHint,
  }
}

function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft ${className}`}>{children}</section>
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: SummaryTone }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClasses(tone)}`}>{children}</span>
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon: ReactNode
}) {
  return (
    <Surface className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">{label}</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
          {hint ? <div className="mt-2 text-sm text-[hsl(var(--muted))]">{hint}</div> : null}
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black">
          {icon}
        </span>
      </div>
    </Surface>
  )
}

function QuickLink({
  href,
  label,
  icon,
  external = false,
}: {
  href: string
  label: string
  icon: ReactNode
  external?: boolean
}) {
  const cls =
    'inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-3 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]'

  if (external) {
    return (
      <a href={href} className={cls}>
        {icon}
        {label}
      </a>
    )
  }

  return (
    <Link href={href} className={cls}>
      {icon}
      {label}
    </Link>
  )
}

export default async function MemberDetailPage({ params }: { params: { id: string } }) {
  const me = await getSessionUser()
  const nextPath = `/members/${params.id}`

  if (!me) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  const STAFF: Role[] = ['reception', 'admin', 'super_admin']
  const canViewMembersList = STAFF.includes(me.role)
  const canOpenOtherProfiles = canViewMembersList || me.role === 'coach'
  const canManageSubscriptions = ['admin', 'super_admin'].includes(me.role)
  const canCreateSubscription = STAFF.includes(me.role)
  const canResendInvite = STAFF.includes(me.role)

  const sessionDb = createSupabaseRSC()
  const adminDb = createSupabaseAdminClient()
  const db = canOpenOtherProfiles ? adminDb : sessionDb

  const idIsUuid = isUuid(params.id)

  if (idIsUuid && !canOpenOtherProfiles && me.id !== params.id) {
    return (
      <AccessDeniedPage
        title="Member"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can view other members. Coaches can only open a read-only member profile from the home lookup."
        allowed="coach (read-only members only), reception, admin, super_admin"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  const { data: profile } = await db
    .from('profiles')
    .select('user_id, member_id, email, first_name, last_name, phone, role, qr_code, created_at, date_of_birth')
    .eq(idIsUuid ? 'user_id' : 'member_id', params.id)
    .maybeSingle<ProfileRow>()

  if (!profile) return notFound()

  const isSelf = me.id === profile.user_id
  const canDeleteUser = me.role === 'super_admin' && !isSelf
  const isCoachViewingOtherMember = me.role === 'coach' && !isSelf
  const receptionDeskView = me.role === 'reception' && !isSelf

  if (!canOpenOtherProfiles && !isSelf) {
    return (
      <AccessDeniedPage
        title="Member"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can view other members. Coaches can only open a read-only member profile from the home lookup."
        allowed="coach (read-only members only), reception, admin, super_admin"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  if (isCoachViewingOtherMember && profile.role !== 'member') {
    return (
      <AccessDeniedPage
        title="Member"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Coach access is limited to read-only member profiles only."
        allowed="member profiles only"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  const coachSafeView = isCoachViewingOtherMember

  const { data: subsData } = await db
    .from('subscriptions')
    .select('id, plan, subscription_type, status, start_date, end_date, frozen_from, frozen_until, sessions_total, sessions_used, amount, amount_due, payment_method, paid_at')
    .eq('member_id', profile.user_id)
    .order('paid_at', { ascending: false })
    .limit(500)

  const subs = (subsData ?? []) as SubscriptionRow[]
  const today = cairoToday()

  const hasActiveSubscription = subs.some((s) => {
    const status = String(s.status ?? '').toLowerCase()
    if (status !== 'active') return false

    const type = (s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) as 'time' | 'sessions'
    if (type === 'sessions') {
      const total = Number(s.sessions_total ?? 0)
      const used = Number(s.sessions_used ?? 0)
      return Math.max(total - used, 0) > 0
    }

    if (s.end_date && s.end_date < today) return false
    return true
  })

  const subscribeDisabledReason = hasActiveSubscription
    ? 'This member already has an active subscription. Please expire or update it first.'
    : undefined

  const activeTimeEnds = subs
    .filter((s) => {
      const status = String(s.status ?? '').toLowerCase()
      if (status !== 'active') return false
      if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'time') return false
      const end = s.end_date
      if (!end) return false
      return today <= end
    })
    .map((s) => s.end_date as string)

  const maxActiveTimeEnd = activeTimeEnds.length ? activeTimeEnds.sort().slice(-1)[0] : null
  const renewStartDate = maxActiveTimeEnd ? addDays(maxActiveTimeEnd, 1) : today
  const defaultRenewPlan: Plan =
    (subs.find((s) => String(s.status ?? '').toLowerCase() === 'active' && s.plan !== 'sessions')?.plan as Plan) ?? '1m'

  const canViewAttendance = canViewMembersList || coachSafeView
  let attendance: AttendanceRow[] = []

  if (canViewAttendance) {
    const from = addDays(today, -30)
    const { data } = await db
      .from('attendance')
      .select('id, date, valid, from_sessions, subscription_id')
      .eq('member_id', profile.user_id)
      .gte('date', from)
      .lte('date', today)
      .order('date', { ascending: false })
      .limit(1000)

    attendance = (data ?? []) as AttendanceRow[]
  }

  const subPlanById = new Map<string, Plan | null>(subs.map((s) => [s.id, s.plan]))

  const hasAnyCurrentPlanNow = subs.some((s) => {
  const state = getSubscriptionDisplayState(s, today)
  const rawStatus = String(s.status ?? '').toLowerCase()
  if (rawStatus !== 'active') return false

  if (state.type === 'time') {
    if (state.expired) return false
    return true
  }

  return (state.remaining ?? 0) > 0
})

  const alerts: Array<{ kind: SummaryTone; text: string }> = []
  for (const s of subs) {
    const rawStatus = String(s.status ?? '').toLowerCase()
    if (rawStatus !== 'active') continue

    const state = getSubscriptionDisplayState(s, today)

    if (state.type === 'time') {
      if (state.frozen) {
        alerts.push({ kind: 'warning', text: `${humanPlan(s.plan)} is frozen until ${fmtDate(s.frozen_until)}` })
        continue
      }

      if (state.left !== null && state.left <= 7 && state.left >= 0) {
        alerts.push({ kind: 'warning', text: `${humanPlan(s.plan)} expires in ${state.left} day(s)` })
      }

      if (state.expired && !hasAnyCurrentPlanNow) {
        alerts.push({ kind: 'danger', text: `${humanPlan(s.plan)} is expired.` })
      }

      continue
    }

    const remaining = state.remaining ?? 0
    if (remaining <= 2) {
      alerts.push({
        kind: remaining === 0 ? 'danger' : 'warning',
        text: `Sessions plan has ${remaining} session(s) left.`,
      })
    }
  }

  const summary = buildMembershipSummary(profile.role, isSelf, subs, today)
  const outstandingTotal = subs.reduce((sum, s) => sum + Math.max(Number(s.amount_due ?? 0), 0), 0)
  const coachTrainingUseful = coachSafeView ? buildCoachTrainingUseful(subs, attendance, today) : null
  const receptionDeskUseful = receptionDeskView ? buildReceptionDeskUseful(subs, attendance, today, outstandingTotal) : null
  const latestPayment = subs.find((s) => !!s.paid_at)?.paid_at ?? null
  const recentAttendanceValid = attendance.filter((a) => a.valid).length
  const lastAttendance = attendance[0]?.date ?? null
  const fullName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || '—'
  const age = ageYears(profile.date_of_birth)
  const viewedRole = profile.role ?? 'member'
  const showSubscriptionActions = canCreateSubscription && viewedRole === 'member' && !coachSafeView

  const subtitle = coachSafeView
    ? 'Read-only coach view with only safe member information.'
    : receptionDeskView
      ? 'Front-desk member view focused on renewal, due, contact and check-in readiness.'
      : isSelf
        ? viewedRole === 'member'
          ? 'Your profile, QR code and membership details.'
          : 'Your profile, QR code and staff access overview.'
        : 'Fast member overview built for field usage on mobile and tablet.'

  const right = canViewMembersList ? (
    <Link
      href="/members"
      className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]"
    >
      <ArrowLeft size={16} />
      Back to list
    </Link>
  ) : coachSafeView ? (
    <Link
      href="/"
      className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]"
    >
      <ArrowLeft size={16} />
      Back home
    </Link>
  ) : undefined

  return (
    <main>
      <PageHeader
        title={coachSafeView ? 'Member overview' : receptionDeskView ? 'Reception member detail' : isSelf ? 'My profile' : 'Member detail'}
        subtitle={subtitle}
        right={right}
      />

      <Section className="space-y-5">
        <Surface className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <TinyBadge tone={summary.tone}>{summary.label}</TinyBadge>
              <TinyBadge>{humanRole(viewedRole)}</TinyBadge>
              {profile.member_id ? <TinyBadge>Member ID: {profile.member_id}</TinyBadge> : null}
              {typeof age === 'number' ? <TinyBadge>{age < 17 ? `Kid · ${age}y` : `Adult · ${age}y`}</TinyBadge> : null}
              {coachSafeView ? <TinyBadge tone="success">Coach read-only view</TinyBadge> : null}
              {receptionDeskView ? <TinyBadge tone="success">Reception desk view</TinyBadge> : null}
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{fullName}</h1>
              <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))] sm:text-base">
                {coachSafeView
                  ? 'Only training-useful information is shown here. No private contact data, finance data or member QR is displayed.'
                  : receptionDeskView
                    ? 'This view is optimized for front-desk usage: contact, due, renewal, check-in readiness and fast actions.'
                    : isSelf
                      ? 'Everything important is grouped here for quick reading on mobile.'
                      : 'Identity, subscription status, QR code and operational info grouped in one clear mobile-first page.'}
              </p>
            </div>
          </div>
        </Surface>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Membership"
            value={summary.title}
            hint={summary.hint}
            icon={<ShieldCheck size={18} strokeWidth={2.1} />}
          />

          {coachSafeView ? (
            <>
              <SummaryCard
                label="Attendance · 30 days"
                value={recentAttendanceValid}
                hint={lastAttendance ? `Last check-in ${fmtDate(lastAttendance)}` : 'No recent attendance.'}
                icon={<ScanLine size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Joined"
                value={fmtDate(profile.created_at)}
                hint={typeof age === 'number' ? `${age < 17 ? 'Kid' : 'Adult'} member` : 'Member record'}
                icon={<CalendarDays size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Coach access"
                value="Read-only"
                hint="Private contact and financial data are hidden in this view."
                icon={<UserRound size={18} strokeWidth={2.1} />}
              />
            </>
          ) : receptionDeskView ? (
            <>
              <SummaryCard
                label="Outstanding due"
                value={outstandingTotal > 0 ? fmtMoneyEGP(outstandingTotal) : 'No due'}
                hint={outstandingTotal > 0 ? 'Collect or follow up at the desk.' : 'Nothing due at the moment.'}
                icon={<Wallet size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Last payment"
                value={latestPayment ? fmtDate(latestPayment) : '—'}
                hint="Most recent recorded payment date."
                icon={<CreditCard size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Last check-in"
                value={lastAttendance ? fmtDate(lastAttendance) : '—'}
                hint={lastAttendance ? `${recentAttendanceValid} valid check-in(s) in last 30 days` : 'No recent attendance.'}
                icon={<ScanLine size={18} strokeWidth={2.1} />}
              />
            </>
          ) : (
            <>
              <SummaryCard
                label="Outstanding due"
                value={outstandingTotal > 0 ? fmtMoneyEGP(outstandingTotal) : 'No due'}
                hint={outstandingTotal > 0 ? 'Unpaid balance on subscriptions.' : 'Nothing due at the moment.'}
                icon={<Wallet size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label={canViewAttendance ? 'Attendance · 30 days' : 'Last payment'}
                value={canViewAttendance ? recentAttendanceValid : latestPayment ? fmtDate(latestPayment) : '—'}
                hint={canViewAttendance ? (lastAttendance ? `Last check-in ${fmtDate(lastAttendance)}` : 'No recent attendance.') : 'Latest recorded payment date.'}
                icon={canViewAttendance ? <ScanLine size={18} strokeWidth={2.1} /> : <CreditCard size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Joined"
                value={fmtDate(profile.created_at)}
                hint={profile.email ?? profile.phone ?? 'No extra contact info.'}
                icon={<CalendarDays size={18} strokeWidth={2.1} />}
              />
            </>
          )}
        </div>

        {receptionDeskView && receptionDeskUseful ? (
          <Surface className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <ScanLine size={18} className="text-black" />
              <h2 className="text-base font-semibold tracking-tight">Reception desk summary</h2>
            </div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              The most useful front-desk information at a glance.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Check-in status"
                value={receptionDeskUseful.checkInStatus}
                hint={receptionDeskUseful.checkInHint}
                icon={<ScanLine size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Renewal state"
                value={receptionDeskUseful.renewalState}
                hint={receptionDeskUseful.renewalHint}
                icon={<CalendarDays size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Payment state"
                value={receptionDeskUseful.paymentState}
                hint={receptionDeskUseful.paymentHint}
                icon={<Wallet size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Last seen"
                value={receptionDeskUseful.lastSeen}
                hint={receptionDeskUseful.lastSeenHint}
                icon={<UserRound size={18} strokeWidth={2.1} />}
              />
            </div>
          </Surface>
        ) : null}

        {coachSafeView && coachTrainingUseful ? (
          <Surface className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-black" />
              <h2 className="text-base font-semibold tracking-tight">Training useful</h2>
            </div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Quick coach-only reading for what matters around the mat.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Membership now"
                value={coachTrainingUseful.membershipNow}
                hint={coachTrainingUseful.membershipHint}
                icon={<ShieldCheck size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Sessions left"
                value={coachTrainingUseful.sessionsNow}
                hint={coachTrainingUseful.sessionsHint}
                icon={<CalendarDays size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Last check-in"
                value={coachTrainingUseful.lastCheckIn}
                hint={coachTrainingUseful.lastCheckInHint}
                icon={<ScanLine size={18} strokeWidth={2.1} />}
              />
              <SummaryCard
                label="Attention point"
                value={coachTrainingUseful.attentionPoint}
                hint={coachTrainingUseful.attentionHint}
                icon={<AlertCircle size={18} strokeWidth={2.1} />}
              />
            </div>
          </Surface>
        ) : null}

        {(showSubscriptionActions || canResendInvite || receptionDeskView) ? (
          <Surface className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold tracking-tight">
                  {receptionDeskView ? 'Reception quick actions' : 'Quick actions'}
                </div>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  {receptionDeskView
                    ? 'Keep the most common desk actions visible and fast on mobile.'
                    : 'Keep high-frequency actions visible without opening extra screens.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {receptionDeskView && profile.phone ? (
                  <QuickLink href={`tel:${profile.phone}`} label="Call member" icon={<Phone size={16} />} external />
                ) : null}
                {receptionDeskView && profile.email ? (
                  <QuickLink href={`mailto:${profile.email}`} label="Email member" icon={<Mail size={16} />} external />
                ) : null}
                {receptionDeskView ? (
                  <QuickLink href="/scan" label="Open scan" icon={<ScanLine size={16} />} />
                ) : null}

                {showSubscriptionActions ? (
                  <>
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

                    {maxActiveTimeEnd ? (
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
                  </>
                ) : null}

                {canResendInvite ? <ResendInviteButton userId={profile.user_id} email={profile.email} /> : null}
                {canDeleteUser ? (
                  <DeleteUserButton userId={profile.user_id} email={profile.email} memberId={profile.member_id} />
                ) : null}
              </div>
            </div>
          </Surface>
        ) : null}

        {alerts.length > 0 ? (
          <Surface className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="text-black" />
              <h2 className="text-base font-semibold tracking-tight">Alerts</h2>
            </div>
            <div className="mt-4 grid gap-2">
              {alerts.map((a, i) => (
                <div key={`${a.text}-${i}`} className={`rounded-2xl border px-3 py-2 text-sm font-medium ${toneClasses(a.kind)}`}>
                  {a.text}
                </div>
              ))}
            </div>
          </Surface>
        ) : null}

        <div className={`grid gap-4 ${coachSafeView ? '' : 'xl:grid-cols-[1.15fr_0.85fr]'}`}>
          <Surface className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <UserRound size={18} className="text-black" />
              <h2 className="text-base font-semibold tracking-tight">Identity</h2>
            </div>

            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Name</span>
                <span className="text-right font-medium">{fullName}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Member ID</span>
                <code className="text-right text-xs font-semibold">{profile.member_id?.trim() || '—'}</code>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Role</span>
                <span className="text-right font-medium">{humanRole(viewedRole)}</span>
              </div>

              {!coachSafeView ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Email</span>
                    <span className="min-w-0 text-right font-medium break-words whitespace-normal">{profile.email ?? '—'}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Phone</span>
                    <span className="min-w-0 text-right font-medium break-words whitespace-normal">{profile.phone ?? '—'}</span>
                  </div>
                </>
              ) : null}

              <div className="flex items-start justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Joined</span>
                <span className="text-right font-medium">{fmtDate(profile.created_at)}</span>
              </div>

              {!coachSafeView ? (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Date of birth</span>
                  <span className="text-right font-medium">{profile.date_of_birth ? fmtDate(profile.date_of_birth) : '—'}</span>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Age</span>
                  <span className="text-right font-medium">{typeof age === 'number' ? `${age} years` : '—'}</span>
                </div>
              )}
            </div>
          </Surface>

          {!coachSafeView ? (
            <Surface className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <QrCode size={18} className="text-black" />
                <h2 className="text-base font-semibold tracking-tight">QR code</h2>
              </div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">Show this code at reception for attendance scanning.</p>

              <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                {profile.qr_code ? (
                  <div className="text-center">
                    <QrImage value={profile.qr_code} size={180} />
                    <div className="mt-3 text-xs text-[hsl(var(--muted))]">Ready for kiosk or front-desk scan.</div>
                  </div>
                ) : (
                  <div className="text-sm text-[hsl(var(--muted))]">No QR code.</div>
                )}
              </div>
            </Surface>
          ) : null}
        </div>

        <Surface className="p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Subscriptions</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                {coachSafeView
                  ? 'Only training-useful subscription status is visible here.'
                  : receptionDeskView
                    ? 'Clean front-desk reading of status now, dues and payment details.'
                    : 'Status now, billing and quick actions grouped in one clean card view.'}
              </p>
            </div>
            <TinyBadge>{subs.length} record(s)</TinyBadge>
          </div>

          {subs.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
              No subscriptions yet.
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {subs.map((s) => {
                const state = getSubscriptionDisplayState(s, today)
                const isSessions = state.isSessions
                const remaining = state.remaining ?? 0
                const left = state.left
                const frozen = state.frozen
                const due = Math.max(Number(s.amount_due ?? 0), 0)
                const paid = Math.max(Number(s.amount ?? 0), 0)
                const total = paid + due

                const statusNow = isSessions
                  ? remaining > 0
                    ? `${remaining} session(s) left`
                    : 'No sessions left'
                  : frozen
                    ? `Frozen until ${fmtDate(s.frozen_until)}`
                    : left === null
                      ? 'Time membership active'
                      : left < 0
                        ? `Expired ${Math.abs(left)} day(s) ago`
                        : left === 0
                          ? 'Ends today'
                          : `${left} day(s) left`

                const coverage = isSessions
                  ? `${s.sessions_used ?? 0}/${s.sessions_total ?? 0} used`
                  : `${fmtDate(s.start_date)} → ${fmtDate(s.end_date)}`

                const billingNow = coachSafeView
                  ? null
                  : total > 0
                    ? `Paid ${fmtMoneyEGP(paid)} of ${fmtMoneyEGP(total)}`
                    : 'No billing recorded'

                return (
                  <div key={s.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                    <div className="flex flex-wrap items-center gap-2">
                      <TinyBadge>{humanPlan(s.plan)}</TinyBadge>
                      <TinyBadge tone={state.statusTone}>{state.displayStatus}</TinyBadge>
                      {left !== null && left >= 0 && !isSessions && !frozen ? (
                        <TinyBadge tone={left <= 7 ? 'warning' : 'success'}>{left} day(s) left</TinyBadge>
                      ) : null}
                      {frozen ? <TinyBadge tone="warning">Frozen until {fmtDate(s.frozen_until)}</TinyBadge> : null}
                      {isSessions ? <TinyBadge tone={remaining <= 2 ? 'warning' : 'success'}>{remaining} left</TinyBadge> : null}
                      {!coachSafeView && due > 0 ? <TinyBadge tone="warning">Due {fmtMoneyEGP(due)}</TinyBadge> : null}
                    </div>

                    <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-white/70 px-4 py-3">
                      <div className={`grid gap-3 text-sm ${coachSafeView ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Status now</div>
                          <div className="mt-1 font-medium">{statusNow}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Coverage</div>
                          <div className="mt-1 font-medium">{coverage}</div>
                        </div>
                        {!coachSafeView ? (
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Billing now</div>
                            <div className="mt-1 font-medium">{billingNow}</div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={`mt-4 grid gap-3 text-sm ${coachSafeView ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Start</div>
                        <div className="mt-1 font-medium">{fmtDate(s.start_date)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">End</div>
                        <div className="mt-1 font-medium">{isSessions ? '—' : fmtDate(s.end_date)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Sessions</div>
                        <div className="mt-1 font-medium">{isSessions ? `${s.sessions_used ?? 0}/${s.sessions_total ?? 0} used` : '—'}</div>
                      </div>

                      {!coachSafeView ? (
                        <>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Paid</div>
                            <div className="mt-1 font-medium">{fmtMoneyEGP(paid)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Payment method</div>
                            <div className="mt-1 font-medium">{humanPayment(s.payment_method)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Paid at</div>
                            <div className="mt-1 font-medium">{fmtDate(s.paid_at)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Outstanding due</div>
                            <div className="mt-1 font-medium">{due > 0 ? fmtMoneyEGP(due) : 'No due'}</div>
                          </div>
                        </>
                      ) : null}
                    </div>

                    {!coachSafeView && canManageSubscriptions && viewedRole === 'member' ? (
                      <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
                        <SubscriptionManageRowActions sub={s} />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Surface>

        {canViewAttendance ? (
          <Surface className="p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Attendance · last 30 days</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">Recent check-ins shown in compact cards for phone and tablet.</p>
              </div>
              <TinyBadge>{attendance.length} record(s)</TinyBadge>
            </div>

            {attendance.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                No attendance in the last 30 days.
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {attendance.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                    <div className="flex flex-wrap items-center gap-2">
                      <TinyBadge tone={a.valid ? 'success' : 'danger'}>{a.valid ? 'Valid' : 'Invalid'}</TinyBadge>
                      <TinyBadge>{a.from_sessions ? 'From sessions' : 'From time plan'}</TinyBadge>
                    </div>

                    <div className={`mt-4 grid gap-3 text-sm ${coachSafeView ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Date</div>
                        <div className="mt-1 font-medium">{fmtDate(a.date)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Plan</div>
                        <div className="mt-1 font-medium">{a.subscription_id ? humanPlan(subPlanById.get(a.subscription_id) ?? null) : '—'}</div>
                      </div>
                      {!coachSafeView ? (
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Source</div>
                          <div className="mt-1 font-medium">{a.from_sessions ? 'Sessions balance' : 'Time membership'}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Surface>
        ) : null}
      </Section>
    </main>
  )
}