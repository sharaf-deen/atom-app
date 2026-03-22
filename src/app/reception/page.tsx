// src/app/reception/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import type React from 'react'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import Button from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { addDays, cairoToday, diffDays, CAIRO_TZ } from '@/lib/cairoDate'
import { canAccessReceptionDesk, canManageNotifications } from '@/lib/rbac'
import { CalendarDays, IdCard, MessageSquare, Phone, ScanLine, Wallet } from 'lucide-react'

type SearchParams = Record<string, string | string[] | undefined>

type ProfileLite = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  member_id: string | null
}

type SubscriptionRow = {
  id: string
  member_id: string
  end_date: string | null
  status: string | null
  plan: string | null
  sessions_total: number | null
  frozen_until: string | null
  amount: number | string | null
  amount_due: number | string | null
  payment_method: string | null
  paid_at: string | null
  profiles?: ProfileLite | null
}

type RawSubscriptionRow = Omit<SubscriptionRow, 'profiles'> & {
  profiles?: ProfileLite | ProfileLite[] | null
}

type AttendanceRow = {
  member_id: string
  date: string
  valid: boolean | null
  scanned_at: string | null
}

type Focus = 'now' | 'renewals' | 'dues' | 'no_attendance' | 'all'

type QueueItem = {
  memberId: string
  memberCode: string | null
  name: string
  email: string | null
  phone: string | null
  subscription: SubscriptionRow
  dueAmount: number
  daysLeft: number | null
  lastValidAttendanceDate: string | null
  validAttendance7d: number
  validAttendance30d: number
  noAttendance14d: boolean
  inactive30d: boolean
  reasons: Array<{ label: string; tone: 'neutral' | 'warning' | 'danger' | 'success' }>
  priority: number
  nextStep: string
}

const PER_PAGE = 40

function firstParam(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

function isFocus(v: unknown): v is Focus {
  return v === 'now' || v === 'renewals' || v === 'dues' || v === 'no_attendance' || v === 'all'
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue
    sp.set(key, value)
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
      new Date(`${value}T00:00:00Z`),
    )
  } catch {
    return value
  }
}

function fmtMoneyEGP(value: unknown) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0 EGP'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function humanPlan(plan: string | null | undefined, sessionsTotal?: number | null) {
  if (plan === 'sessions') {
    const n = Number(sessionsTotal ?? 0)
    return n > 0 ? `${n} sessions` : 'Sessions package'
  }
  if (!plan) return 'Membership'
  return plan.replace(/_/g, ' ').toUpperCase()
}

function displayName(profile?: ProfileLite | null) {
  const name = [profile?.first_name ?? '', profile?.last_name ?? ''].join(' ').trim()
  return name || profile?.email || profile?.member_id || 'Member'
}

function normalizeSubscriptionRow(row: RawSubscriptionRow): SubscriptionRow {
  return {
    ...row,
    profiles: Array.isArray(row.profiles) ? (row.profiles[0] ?? null) : (row.profiles ?? null),
  }
}

function statusLabel(s: SubscriptionRow, today: string) {
  const frozen = !!s.frozen_until && s.frozen_until >= today
  if (frozen) return 'Frozen'
  if (s.status === 'active') return 'Active'
  if (s.status === 'expired') return 'Expired'
  if (s.status === 'paused') return 'Paused'
  if (s.status === 'cancelled') return 'Cancelled'
  return s.status ? `${s.status.charAt(0).toUpperCase()}${s.status.slice(1)}` : 'Membership'
}

function toneClasses(kind: 'neutral' | 'warning' | 'danger' | 'success') {
  if (kind === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (kind === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (kind === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClasses(tone)}`}>
      {children}
    </span>
  )
}

function SummaryCard({ label, value, hint, href }: { label: string; value: string; hint: string; href?: string }) {
  const content = (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-[hsl(var(--muted))]">{hint}</div>
    </div>
  )

  if (!href) return content
  return (
    <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {content}
    </Link>
  )
}

function ActionTile({ href, title, desc, icon: Icon }: { href: string; title: string; desc: string; icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }> }) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">{desc}</p>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black transition group-hover:translate-x-0.5">
          <Icon size={18} strokeWidth={2.1} />
        </span>
      </div>
    </Link>
  )
}

function normalizeWhatsappPhone(phone: string | null | undefined) {
  if (!phone) return null
  const raw = phone.trim()
  if (!raw) return null
  const compact = raw.replace(/[^\d+]/g, '')
  let digits = compact
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = `20${digits.slice(1)}`
  return digits.length >= 10 ? digits : null
}

function subscriptionRank(s: SubscriptionRow, today: string) {
  const due = Math.max(Number(s.amount_due ?? 0), 0)
  const daysLeft = s.end_date ? diffDays(today, s.end_date) : 999
  let score = 0
  if (s.status === 'active') score += 100
  if (!!s.frozen_until && s.frozen_until >= today) score -= 20
  score += Math.min(due, 5000) / 100
  score += Math.max(0, 15 - Math.abs(daysLeft))
  return score
}

function chooseSubscription(current: SubscriptionRow | undefined, incoming: SubscriptionRow, today: string) {
  if (!current) return incoming
  return subscriptionRank(incoming, today) > subscriptionRank(current, today) ? incoming : current
}

async function getAttendanceRows(memberIds: string[], sinceDate: string) {
  if (!memberIds.length) return [] as AttendanceRow[]
  const admin = getSupabaseAdminClientCached()
  const out: AttendanceRow[] = []
  for (let i = 0; i < memberIds.length; i += 200) {
    const chunk = memberIds.slice(i, i + 200)
    const { data } = await admin
      .from('attendance')
      .select('member_id,date,valid,scanned_at')
      .in('member_id', chunk)
      .gte('date', sinceDate)
      .order('date', { ascending: false })
      .order('scanned_at', { ascending: false })
      .limit(5000)
    out.push(...(((data ?? []) as AttendanceRow[]) ?? []))
  }
  return out
}

function focusMatches(item: QueueItem, focus: Focus) {
  if (focus === 'all') return true
  if (focus === 'now') return item.priority >= 80 || item.dueAmount > 0 || ((item.daysLeft ?? 999) <= 3)
  if (focus === 'renewals') return item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 7
  if (focus === 'dues') return item.dueAmount > 0
  if (focus === 'no_attendance') return item.noAttendance14d
  return true
}

function compareQueue(a: QueueItem, b: QueueItem) {
  return b.priority - a.priority || b.dueAmount - a.dueAmount || (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.name.localeCompare(b.name)
}

function focusLabel(focus: Focus) {
  if (focus === 'now') return 'Action now'
  if (focus === 'renewals') return 'Renewals'
  if (focus === 'dues') return 'Dues'
  if (focus === 'no_attendance') return 'Follow-up'
  return 'All rows'
}

export default async function ReceptionPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/reception')

  if (!canAccessReceptionDesk(me.role)) {
    return (
      <Forbidden
        pageTitle="Reception"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only reception, admin and super admin can access the front desk command center."
        allowed="reception, admin, super_admin"
        nextPath="/reception"
        actions={[{ href: '/', label: 'Go Home' }, { href: '/members', label: 'Members' }]}
        showBackHome
      />
    )
  }

  const focus = isFocus(firstParam(searchParams?.focus)) ? (firstParam(searchParams?.focus) as Focus) : 'now'
  const q = (firstParam(searchParams?.q) ?? '').trim().toLowerCase()
  const page = Math.max(1, Number(firstParam(searchParams?.page) ?? '1') || 1)

  const today = cairoToday()
  const next7 = addDays(today, 7)
  const since7 = addDays(today, -7)
  const since14 = addDays(today, -14)
  const since30 = addDays(today, -30)
  const admin = getSupabaseAdminClientCached()

  const [activeRes, dueRes, scansTodayRes, expiringCountRes] = await Promise.all([
    admin
      .from('subscriptions')
      .select('id,member_id,end_date,status,plan,sessions_total,frozen_until,amount,amount_due,payment_method,paid_at,profiles:member_id(first_name,last_name,email,phone,member_id)')
      .eq('status', 'active')
      .not('member_id', 'is', null)
      .order('paid_at', { ascending: false })
      .limit(500),
    admin
      .from('subscriptions')
      .select('id,member_id,end_date,status,plan,sessions_total,frozen_until,amount,amount_due,payment_method,paid_at,profiles:member_id(first_name,last_name,email,phone,member_id)')
      .gt('amount_due', 0)
      .not('member_id', 'is', null)
      .order('amount_due', { ascending: false })
      .limit(500),
    admin.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', next7)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
  ])

  const subsByMember = new Map<string, SubscriptionRow>()
  const activeRows = ((activeRes.data ?? []) as RawSubscriptionRow[]).map(normalizeSubscriptionRow)
  const dueRows = ((dueRes.data ?? []) as RawSubscriptionRow[]).map(normalizeSubscriptionRow)

  for (const row of [...activeRows, ...dueRows]) {
    if (!row?.member_id) continue
    subsByMember.set(row.member_id, chooseSubscription(subsByMember.get(row.member_id), row, today))
  }

  const memberIds = [...subsByMember.keys()]
  const attendanceRows = await getAttendanceRows(memberIds, since30)
  const attendanceByMember = new Map<string, AttendanceRow[]>()
  for (const row of attendanceRows) {
    if (!row?.member_id) continue
    const arr = attendanceByMember.get(row.member_id) ?? []
    arr.push(row)
    attendanceByMember.set(row.member_id, arr)
  }

  const queue: QueueItem[] = memberIds
    .map((memberId) => {
      const subscription = subsByMember.get(memberId)
      if (!subscription) return null
      const profile = subscription.profiles ?? null
      const dueAmount = Math.max(Number(subscription.amount_due ?? 0), 0)
      const daysLeft = subscription.end_date ? diffDays(today, subscription.end_date) : null
      const attendance = attendanceByMember.get(memberId) ?? []
      const validAttendance = attendance.filter((row) => row.valid)
      const lastValidAttendanceDate = validAttendance[0]?.date ?? null
      const validAttendance7d = validAttendance.filter((row) => row.date >= since7).length
      const validAttendance30d = validAttendance.length
      const noAttendance14d = !validAttendance.some((row) => row.date >= since14)
      const inactive30d = validAttendance30d === 0
      const reasons: QueueItem['reasons'] = []
      let priority = 0

      if (dueAmount > 0) {
        reasons.push({ label: `Due ${fmtMoneyEGP(dueAmount)}`, tone: dueAmount >= 1000 ? 'danger' : 'warning' })
        priority += 140 + Math.min(dueAmount, 5000) / 100
      }

      if (daysLeft !== null) {
        if (daysLeft < 0) {
          reasons.push({ label: 'Expired', tone: 'danger' })
          priority += 120
        } else if (daysLeft === 0) {
          reasons.push({ label: 'Ends today', tone: 'danger' })
          priority += 110
        } else if (daysLeft <= 3) {
          reasons.push({ label: `${daysLeft} day(s) left`, tone: 'warning' })
          priority += 90 - daysLeft
        } else if (daysLeft <= 7) {
          reasons.push({ label: 'Renew soon', tone: 'warning' })
          priority += 55
        }
      }

      if (noAttendance14d) {
        reasons.push({ label: 'No attendance in 14d', tone: 'warning' })
        priority += 35
      }

      if (inactive30d) {
        reasons.push({ label: 'No valid attendance in 30d', tone: 'neutral' })
        priority += 20
      }

      if (!reasons.length) reasons.push({ label: statusLabel(subscription, today), tone: 'success' })

      const nextStep =
        dueAmount > 0
          ? 'Settle due first'
          : daysLeft !== null && daysLeft <= 7
            ? 'Renew now'
            : noAttendance14d
              ? 'Follow up'
              : 'Open member'

      return {
        memberId,
        memberCode: profile?.member_id ?? null,
        name: displayName(profile),
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        subscription,
        dueAmount,
        daysLeft,
        lastValidAttendanceDate,
        validAttendance7d,
        validAttendance30d,
        noAttendance14d,
        inactive30d,
        reasons,
        priority,
        nextStep,
      } satisfies QueueItem
    })
    .filter(Boolean) as QueueItem[]

  const filtered = queue
    .filter((item) => focusMatches(item, focus))
    .filter((item) => {
      if (!q) return true
      const hay = [item.name, item.email ?? '', item.phone ?? '', item.memberCode ?? ''].join(' ').toLowerCase()
      return hay.includes(q)
    })
    .sort(compareQueue)

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PER_PAGE
  const visible = filtered.slice(start, start + PER_PAGE)

  const urgentCount = queue.filter((item) => item.priority >= 80 || item.dueAmount > 0 || ((item.daysLeft ?? 999) <= 3)).length
  const dueCount = queue.filter((item) => item.dueAmount > 0).length
  const noAttendanceCount = queue.filter((item) => item.noAttendance14d).length
  const queueValue = fmtMoneyEGP(queue.reduce((sum, item) => sum + item.dueAmount, 0))

  const rows = visible.map((item) => {
    const whatsapp = normalizeWhatsappPhone(item.phone)
    const memberHref = `/members/${item.memberId}`
    const notifyHref = canManageNotifications(me.role)
      ? `/notifications${buildQS({ memberId: item.memberId })}`
      : '/notifications'

    return {
      id: item.memberId,
      member: (
        <div className="min-w-0">
          <div className="font-medium text-black">{item.name}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{item.memberCode || item.email || 'No member code yet'}</div>
        </div>
      ),
      why_now: (
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-1">
            {item.reasons.map((reason) => (
              <TinyBadge key={`${item.memberId}-${reason.label}`} tone={reason.tone}>
                {reason.label}
              </TinyBadge>
            ))}
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">{item.nextStep}</div>
        </div>
      ),
      coverage: (
        <div className="min-w-0">
          <div className="font-medium text-black">{humanPlan(item.subscription.plan, item.subscription.sessions_total)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {statusLabel(item.subscription, today)}
            {item.daysLeft !== null ? ` · ${item.daysLeft < 0 ? 'Expired' : `${item.daysLeft} day(s) left`}` : ''}
          </div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{item.dueAmount > 0 ? `Due ${fmtMoneyEGP(item.dueAmount)}` : 'No due balance'}</div>
        </div>
      ),
      last_seen: (
        <div className="min-w-0">
          <div className="font-medium text-black">{item.lastValidAttendanceDate ? fmtDate(item.lastValidAttendanceDate) : 'No recent valid attendance'}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{item.validAttendance7d} valid · 7d • {item.validAttendance30d} valid · 30d</div>
        </div>
      ),
      actions: (
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild size="sm" variant={item.dueAmount > 0 || ((item.daysLeft ?? 999) <= 7) ? 'solid' : 'outline'} href={memberHref}>
            {item.dueAmount > 0 ? 'Settle due' : (item.daysLeft ?? 999) <= 7 ? 'Renew' : 'Open member'}
          </Button>
          {canManageNotifications(me.role) ? (
            <Button asChild size="sm" variant="outline" href={notifyHref}>
              Notify
            </Button>
          ) : null}
          {whatsapp ? (
            <Button asChild size="sm" variant="outline" href={`https://wa.me/${whatsapp}`}>
              WhatsApp
            </Button>
          ) : null}
          {item.phone ? (
            <Button asChild size="sm" variant="ghost" href={`tel:${item.phone}`}>
              Call
            </Button>
          ) : null}
        </div>
      ),
    }
  })

  return (
    <main>
      <PageHeader
        title="Front desk"
        subtitle={`Reception workflow — Cairo time (${CAIRO_TZ}). Keep only the next useful action visible.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" href="/scan">
              Scan
            </Button>
            <Button asChild variant="outline" href="/kiosk">
              Create member
            </Button>
          </div>
        }
      />

      <Section className="space-y-4">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Scans today" value={String(scansTodayRes.count ?? 0)} hint="Entrance flow already recorded today." href="/scan" />
          <SummaryCard label="Action now" value={String(urgentCount)} hint="Dues, urgent renewals and desk-first cases." href={buildQS({ focus: 'now' })} />
          <SummaryCard label="Expiring in 7d" value={String(expiringCountRes.count ?? 0)} hint="Members likely to need renewal attention soon." href="/admin/expiring-soon" />
          <SummaryCard label="Outstanding dues" value={queueValue} hint={`${dueCount} members currently have money due.`} href="/admin/outstanding-dues" />
        </div>
      </Section>

      <Section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ActionTile href="/scan" title="Scan" desc="Fast entrance validation and attendance." icon={ScanLine} />
          <ActionTile href="/admin/expiring-soon" title="Renewals" desc="Open memberships ending soon and close renewals fast." icon={CalendarDays} />
          <ActionTile href="/admin/outstanding-dues" title="Outstanding dues" desc="Go straight to payment collection and due follow-up." icon={Wallet} />
          <ActionTile href="/admin/crm" title="CRM queue" desc="Open the live contact queue when the desk slows down." icon={MessageSquare} />
          <ActionTile href="/kiosk" title="Create member" desc="Start a new member or membership flow from the desk." icon={IdCard} />
          <ActionTile href="/schedule" title="Schedule" desc="Keep today’s class times one tap away." icon={CalendarDays} />
        </div>
      </Section>

      <Section className="space-y-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-semibold tracking-tight">Action queue</div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Start with <span className="font-medium text-black">Action now</span>. Then switch to <span className="font-medium text-black">Renewals</span>, <span className="font-medium text-black">Dues</span> or <span className="font-medium text-black">Follow-up</span> when the desk needs a narrower queue.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {([
                ['now', 'Action now'],
                ['renewals', 'Renewals'],
                ['dues', 'Dues'],
                ['no_attendance', 'Follow-up'],
                ['all', 'All rows'],
              ] as Array<[Focus, string]>).map(([value, label]) => {
                const active = focus === value
                return (
                  <Link
                    key={value}
                    href={buildQS({ focus: value, q: q || undefined })}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black'}`}
                  >
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="hidden" name="focus" value={focus} />
              <div className="flex-1">
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Search name, email, phone or member ID"
                  className="h-11 w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
              {q ? (
                <Button asChild variant="ghost" href={buildQS({ focus })}>
                  Reset
                </Button>
              ) : null}
            </form>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Current queue</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">{focusLabel(focus)}</div>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Visible now</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">{total}</div>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Follow-up</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">{noAttendanceCount}</div>
              </div>
            </div>
          </div>
        </div>

        <Table
          stickyTopClassName="top-0"
          keyField="id"
          columns={[
            { key: 'member', header: 'Member' },
            { key: 'why_now', header: 'Why now', tdClassName: 'whitespace-normal' },
            { key: 'coverage', header: 'Membership', tdClassName: 'whitespace-normal' },
            { key: 'last_seen', header: 'Last seen', tdClassName: 'whitespace-normal' },
            { key: 'actions', header: '', thClassName: 'w-[1%]', tdClassName: 'whitespace-normal' },
          ]}
          rows={rows}
        />

        {totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="text-[hsl(var(--muted))]">Showing {start + 1}-{Math.min(start + PER_PAGE, total)} of {total}</div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" href={buildQS({ focus, q: q || undefined, page: safePage > 1 ? String(safePage - 1) : '1' })}>
                Previous
              </Button>
              <Button asChild variant="outline" size="sm" href={buildQS({ focus, q: q || undefined, page: safePage < totalPages ? String(safePage + 1) : String(totalPages) })}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
