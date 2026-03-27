// src/app/admin/crm/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import { Table } from '@/components/ui/Table'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { addDays, cairoToday, clampInt, diffDays, CAIRO_TZ } from '@/lib/cairoDate'
import { canAccessCrm, canManageNotifications } from '@/lib/rbac'

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
  status: string
  plan: string
  sessions_total: number | null
  frozen_until: string | null
  amount?: number | string | null
  amount_due?: number | string | null
  payment_method?: string | null
  paid_at?: string | null
  profiles?: ProfileLite | null
}

type RawSubscriptionRow = Omit<SubscriptionRow, 'profiles'> & {
  profiles?: ProfileLite | ProfileLite[] | null
}

function normalizeSubscriptionRow(row: RawSubscriptionRow): SubscriptionRow {
  const profile = Array.isArray(row.profiles) ? (row.profiles[0] ?? null) : (row.profiles ?? null)
  return {
    ...row,
    profiles: profile,
  }
}

type AttendanceRow = {
  member_id: string
  date: string
  valid: boolean | null
  scanned_at: string | null
}

type Segment = 'action' | 'all' | 'expiring' | 'due' | 'no_attendance' | 'inactive'

type QueueItem = {
  memberId: string
  name: string
  email: string | null
  phone: string | null
  memberCode: string | null
  subscription: SubscriptionRow
  dueAmount: number
  daysLeft: number | null
  lastValidAttendanceDate: string | null
  lastAttendanceDate: string | null
  validAttendance30d: number
  validAttendance7d: number
  noAttendance14d: boolean
  inactive30d: boolean
  priority: number
  reasons: Array<{ label: string; tone: 'neutral' | 'warning' | 'danger' | 'success' }>
  isActionNeeded: boolean
}

const PER_PAGE = 50

function isSegment(v: unknown): v is Segment {
  return v === 'action' || v === 'all' || v === 'expiring' || v === 'due' || v === 'no_attendance' || v === 'inactive'
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    sp.set(k, v)
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

function fmtMoneyEGP(v: unknown) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0 EGP'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function fmtDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
      new Date(`${dateStr}T00:00:00Z`),
    )
  } catch {
    return dateStr
  }
}

function humanPlan(plan: string, sessionsTotal?: number | null) {
  if (plan === 'sessions') {
    const n = Number.isFinite(Number(sessionsTotal)) ? Number(sessionsTotal) : null
    return n ? `${n} sessions` : 'Sessions package'
  }
  if (!plan) return 'Membership'
  return plan.replace(/_/g, ' ').toUpperCase()
}

function humanPayment(v?: string | null) {
  switch (String(v ?? '').toLowerCase()) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'InstaPay'
    case 'card':
      return 'Card'
    case 'visa':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return v ? String(v) : '—'
  }
}

function displayName(p?: ProfileLite | null) {
  const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim()
  return name || p?.email || p?.member_id || 'Member'
}

function isFrozenNow(s: Pick<SubscriptionRow, 'frozen_until'>, today: string) {
  return !!s.frozen_until && s.frozen_until >= today
}

function isCurrentMembership(s: Pick<SubscriptionRow, 'status' | 'end_date' | 'frozen_until'>, today: string) {
  if (isFrozenNow(s, today)) return s.status === 'active' || s.status === 'paused'
  if (s.status !== 'active') return false
  return !s.end_date || s.end_date >= today
}

function statusLabel(s: SubscriptionRow, today: string) {
  const frozen = isFrozenNow(s, today)
  if (frozen) return 'Frozen'
  if (isCurrentMembership(s, today)) return 'Active'
  if (s.status === 'expired') return 'Expired'
  if (s.status === 'paused') return 'Paused'
  if (s.status === 'cancelled') return 'Cancelled'
  if (s.status === 'active' && !!s.end_date && s.end_date < today) return 'Expired'
  return s.status ? s.status[0].toUpperCase() + s.status.slice(1) : 'Membership'
}

function statusTone(s: SubscriptionRow, today: string): 'neutral' | 'warning' | 'danger' | 'success' {
  const frozen = isFrozenNow(s, today)
  if (frozen) return 'warning'
  if (isCurrentMembership(s, today)) return 'success'
  if (s.status === 'expired' || s.status === 'cancelled' || (s.status === 'active' && !!s.end_date && s.end_date < today)) return 'danger'
  if (s.status === 'paused') return 'warning'
  return 'neutral'
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

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-[hsl(var(--muted))]">{hint}</div>
    </div>
  )
}

function subscriptionRank(s: SubscriptionRow, today: string) {
  const due = Math.max(Number(s.amount_due ?? 0), 0)
  const daysLeft = s.end_date ? diffDays(today, s.end_date) : 999
  let score = 0
  if (isCurrentMembership(s, today)) score += 1000
  else if (s.status === 'active') score += 200
  else if (due > 0) score += 100
  if (isFrozenNow(s, today)) score -= 20
  score += Math.min(due, 5000) / 100
  score += Math.max(0, 15 - Math.abs(daysLeft))
  return score
}

function chooseMemberSubscription(rows: SubscriptionRow[], today: string) {
  if (!rows.length) return undefined

  const deduped = Array.from(new Map(rows.map((row) => [row.id, row] as const)).values())
  const currentRows = deduped.filter((row) => isCurrentMembership(row, today))
  const pool = currentRows.length ? currentRows : deduped

  let best = pool[0]
  for (const row of pool.slice(1)) {
    if (subscriptionRank(row, today) > subscriptionRank(best, today)) best = row
  }
  return best
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

function segmentMatches(item: QueueItem, segment: Segment) {
  if (segment === 'all') return true
  if (segment === 'action') return item.isActionNeeded
  if (segment === 'expiring') return item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 7
  if (segment === 'due') return item.dueAmount > 0
  if (segment === 'no_attendance') return item.noAttendance14d
  if (segment === 'inactive') return item.inactive30d
  return true
}

function compareQueue(a: QueueItem, b: QueueItem) {
  return (
    b.priority - a.priority ||
    b.dueAmount - a.dueAmount ||
    (a.daysLeft ?? 999) - (b.daysLeft ?? 999) ||
    (a.name || '').localeCompare(b.name || '')
  )
}

export default async function AdminCrmPage({
  searchParams,
}: {
  searchParams?: { segment?: string; q?: string; page?: string }
}) {
  const me = await getSessionUserCached()
  const nextPath = '/admin/crm'
  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  if (!canAccessCrm(me.role)) {
    return (
      <Forbidden
        pageTitle="CRM"
        subtitle="Front desk follow-up queue."
        nextPath={nextPath}
        allowed="reception, admin, super_admin"
        signedInAs={me.email}
        actions={[{ href: '/', label: 'Go Home' }, { href: '/members', label: 'Members' }]}
      />
    )
  }

  const segment: Segment = isSegment(searchParams?.segment) ? (searchParams?.segment as Segment) : 'action'
  const q = (searchParams?.q ?? '').trim()
  const page = clampInt(Number(searchParams?.page ?? 1), 1, 9999)

  const today = cairoToday()
  const next7 = addDays(today, 7)
  const since14 = addDays(today, -14)
  const since30 = addDays(today, -30)

  let loadError: string | null = null
  let queue: QueueItem[] = []

  try {
    const admin = getSupabaseAdminClientCached()

    const [activeRes, dueRes] = await Promise.all([
      admin
        .from('subscriptions')
        .select(
          'id, member_id, end_date, status, plan, sessions_total, frozen_until, amount, amount_due, payment_method, paid_at, profiles:member_id(first_name,last_name,email,phone,member_id)',
        )
        .eq('status', 'active')
        .not('member_id', 'is', null)
        .limit(3000),
      admin
        .from('subscriptions')
        .select(
          'id, member_id, end_date, status, plan, sessions_total, frozen_until, amount, amount_due, payment_method, paid_at, profiles:member_id(first_name,last_name,email,phone,member_id)',
        )
        .gt('amount_due', 0)
        .not('member_id', 'is', null)
        .limit(3000),
    ])

    if (activeRes.error) throw new Error(activeRes.error.message)
    if (dueRes.error) throw new Error(dueRes.error.message)

    const rowsByMember = new Map<string, SubscriptionRow[]>()
    const allRows = [
      ...(((activeRes.data ?? []) as RawSubscriptionRow[]) ?? []),
      ...(((dueRes.data ?? []) as RawSubscriptionRow[]) ?? []),
    ].map(normalizeSubscriptionRow)

    for (const row of allRows) {
      if (!row?.member_id) continue
      const current = rowsByMember.get(row.member_id) ?? []
      current.push(row)
      rowsByMember.set(row.member_id, current)
    }

    const subsByMember = new Map<string, SubscriptionRow>()
    for (const [memberId, rows] of rowsByMember) {
      const chosen = chooseMemberSubscription(rows, today)
      if (chosen) subsByMember.set(memberId, chosen)
    }

    const attendanceRows = await getAttendanceRows([...subsByMember.keys()], since30)
    const attendanceByMember = new Map<
      string,
      { lastAttendanceDate: string | null; lastValidAttendanceDate: string | null; valid30d: number; valid7d: number }
    >()

    for (const row of attendanceRows) {
      const cur = attendanceByMember.get(row.member_id) ?? {
        lastAttendanceDate: null,
        lastValidAttendanceDate: null,
        valid30d: 0,
        valid7d: 0,
      }
      if (!cur.lastAttendanceDate || row.date > cur.lastAttendanceDate) cur.lastAttendanceDate = row.date
      if (row.valid) {
        cur.valid30d += 1
        if (row.date >= addDays(today, -7)) cur.valid7d += 1
        if (!cur.lastValidAttendanceDate || row.date > cur.lastValidAttendanceDate) cur.lastValidAttendanceDate = row.date
      }
      attendanceByMember.set(row.member_id, cur)
    }

    queue = [...subsByMember.values()].map((sub) => {
      const att = attendanceByMember.get(sub.member_id) ?? {
        lastAttendanceDate: null,
        lastValidAttendanceDate: null,
        valid30d: 0,
        valid7d: 0,
      }
      const dueAmount = Math.max(Number(sub.amount_due ?? 0), 0)
      const daysLeft = sub.end_date ? diffDays(today, sub.end_date) : null
      const noAttendance14d = sub.status === 'active' && (!att.lastValidAttendanceDate || att.lastValidAttendanceDate < since14)
      const inactive30d = sub.status === 'active' && (!att.lastValidAttendanceDate || att.lastValidAttendanceDate < since30)

      const reasons: QueueItem['reasons'] = []
      let priority = 0

      if (dueAmount > 0) {
        reasons.push({ label: dueAmount >= 1000 ? 'High due' : 'Due', tone: dueAmount >= 1000 ? 'danger' : 'warning' })
        priority += dueAmount >= 1000 ? 7 : 5
      }

      if (sub.status === 'active' && daysLeft !== null) {
        if (daysLeft < 0) {
          reasons.push({ label: `Overdue ${Math.abs(daysLeft)}d`, tone: 'danger' })
          priority += 6
        } else if (daysLeft === 0) {
          reasons.push({ label: 'Expires today', tone: 'danger' })
          priority += 5
        } else if (daysLeft <= 3) {
          reasons.push({ label: `Expiring in ${daysLeft}d`, tone: 'warning' })
          priority += 4
        } else if (daysLeft <= 7) {
          reasons.push({ label: `Expiring in ${daysLeft}d`, tone: 'neutral' })
          priority += 2
        }
      }

      if (noAttendance14d) {
        reasons.push({ label: 'No attendance 14d', tone: 'warning' })
        priority += 3
      }
      if (inactive30d) {
        reasons.push({ label: 'Inactive 30d', tone: 'danger' })
        priority += 2
      }
      if (!reasons.length) reasons.push({ label: 'Monitor', tone: 'neutral' })

      return {
        memberId: sub.member_id,
        name: displayName(sub.profiles),
        email: sub.profiles?.email ?? null,
        phone: sub.profiles?.phone ?? null,
        memberCode: sub.profiles?.member_id ?? null,
        subscription: sub,
        dueAmount,
        daysLeft,
        lastValidAttendanceDate: att.lastValidAttendanceDate,
        lastAttendanceDate: att.lastAttendanceDate,
        validAttendance30d: att.valid30d,
        validAttendance7d: att.valid7d,
        noAttendance14d,
        inactive30d,
        priority,
        reasons,
        isActionNeeded:
          dueAmount > 0 ||
          (daysLeft !== null && daysLeft <= 3) ||
          noAttendance14d ||
          (sub.status === 'active' && (!att.lastValidAttendanceDate || att.lastValidAttendanceDate < since30)),
      }
    })
  } catch (e: any) {
    loadError = e?.message ?? String(e)
  }

  let filtered = queue.filter((item) => segmentMatches(item, segment))
  if (q) {
    const qq = q.toLowerCase()
    filtered = filtered.filter((item) => {
      return (
        item.name.toLowerCase().includes(qq) ||
        (item.email ?? '').toLowerCase().includes(qq) ||
        (item.phone ?? '').toLowerCase().includes(qq) ||
        (item.memberCode ?? '').toLowerCase().includes(qq) ||
        item.reasons.some((r) => r.label.toLowerCase().includes(qq))
      )
    })
  }
  filtered.sort(compareQueue)

  const totalVisible = filtered.length
  const start = (page - 1) * PER_PAGE
  const paged = filtered.slice(start, start + PER_PAGE)
  const hasPrev = page > 1
  const hasNext = start + PER_PAGE < filtered.length

  const actionCount = filtered.filter((i) => i.isActionNeeded).length
  const dueCount = filtered.filter((i) => i.dueAmount > 0).length
  const expiringCount = filtered.filter((i) => i.daysLeft !== null && i.daysLeft >= 0 && i.daysLeft <= 7).length

  const subtitle = `Who should be contacted today — Cairo time (${CAIRO_TZ}).`

  const rowData = paged.map((item) => {
    const status = statusLabel(item.subscription, today)
    const statusToneKind = statusTone(item.subscription, today)
    const plan = humanPlan(item.subscription.plan, item.subscription.sessions_total)
    const memberHref = `/members/${item.memberId}`
    const waDigits = normalizeWhatsappPhone(item.phone)
    const callHref = item.phone ? `tel:${item.phone}` : ''
    const mailHref = item.email ? `mailto:${item.email}` : ''

    let nextStep = 'Monitor'
    if (item.dueAmount > 0) nextStep = `Collect ${fmtMoneyEGP(item.dueAmount)}`
    else if (item.daysLeft !== null && item.daysLeft <= 3) nextStep = 'Renew membership'
    else if (item.noAttendance14d) nextStep = 'Follow up attendance'

    let coverage = 'No end date'
    if (item.subscription.frozen_until && item.subscription.frozen_until >= today) {
      coverage = `Frozen until ${fmtDate(item.subscription.frozen_until)}`
    } else if (item.daysLeft !== null) {
      if (item.daysLeft < 0) coverage = `Expired ${Math.abs(item.daysLeft)}d ago`
      else if (item.daysLeft === 0) coverage = 'Expires today'
      else coverage = `Ends in ${item.daysLeft}d`
    }

    const lastSeen = item.lastValidAttendanceDate
      ? `${fmtDate(item.lastValidAttendanceDate)}${item.validAttendance7d > 0 ? ` · ${item.validAttendance7d}/7d` : ''}`
      : 'No valid attendance in 30d'

    return {
      id: item.memberId,
      member: (
        <div className="space-y-1">
          <Link href={memberHref} className="font-semibold underline-offset-2 hover:underline">
            {item.name}
          </Link>
          <div className="text-xs text-[hsl(var(--muted))]">
            {item.memberCode ? `ID ${item.memberCode}` : 'No member code'}
            {item.phone ? ` · ${item.phone}` : ''}
          </div>
        </div>
      ),
      next_step: (
        <div className="space-y-2">
          <div className="font-medium">{nextStep}</div>
          <div className="flex flex-wrap gap-1.5">
            {item.reasons.slice(0, 2).map((reason) => (
              <TinyBadge key={reason.label} tone={reason.tone}>
                {reason.label}
              </TinyBadge>
            ))}
          </div>
        </div>
      ),
      status: (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <TinyBadge tone={statusToneKind}>{status}</TinyBadge>
            <span className="text-sm font-medium">{plan}</span>
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">{coverage}</div>
          <div className="text-xs text-[hsl(var(--muted))]">
            {item.dueAmount > 0 ? `${fmtMoneyEGP(item.dueAmount)} due` : 'No due'}
            {item.subscription.paid_at ? ` · Paid ${fmtDate(item.subscription.paid_at)}` : ''}
          </div>
        </div>
      ),
      last_seen: (
        <div className="space-y-1">
          <div className="font-medium">{lastSeen}</div>
          <div className="text-xs text-[hsl(var(--muted))]">
            {item.lastAttendanceDate ? `Latest record ${fmtDate(item.lastAttendanceDate)}` : 'No attendance record in 30d'}
          </div>
        </div>
      ),
      actions: (
        <div className="flex flex-wrap items-center gap-2 whitespace-normal">
          <Button asChild size="sm" variant="outline" href={memberHref}>
            Open member
          </Button>
          {canManageNotifications(me.role) ? (
            <Button asChild size="sm" variant="ghost" href="/notifications">
              Notify
            </Button>
          ) : null}
          {waDigits ? (
            <a
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80"
            >
              WhatsApp
            </a>
          ) : null}
          {callHref ? (
            <a
              href={callHref}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80"
            >
              Call
            </a>
          ) : null}
          {mailHref ? (
            <a
              href={mailHref}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80"
            >
              Email
            </a>
          ) : null}
        </div>
      ),
    }
  })

  const segmentLabel =
    segment === 'action'
      ? 'Action needed first'
      : segment === 'expiring'
      ? 'Expiring soon'
      : segment === 'due'
      ? 'Outstanding dues'
      : segment === 'no_attendance'
      ? 'No recent attendance'
      : segment === 'inactive'
      ? 'Inactive recently'
      : 'All queue rows'

  return (
    <main>
      <PageHeader
        title="CRM / Follow-up queue"
        subtitle={subtitle}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" href="/members">
              Members
            </Button>
            <Button asChild variant="outline" href="/admin/outstanding-dues">
              Outstanding
            </Button>
            <Button asChild variant="outline" href="/admin/expiring-soon">
              Expiring
            </Button>
          </div>
        }
      />

      <Section className="space-y-4">
        {loadError ? (
          <InlineAlert variant="error" title="Could not load CRM queue">
            {loadError}
          </InlineAlert>
        ) : null}

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <SummaryCard label="Overview" value={String(totalVisible)} hint={segmentLabel} />
          <SummaryCard label="Contact today" value={String(actionCount)} hint="Rows to treat first" />
          <SummaryCard label="High priority" value={`${dueCount} due · ${expiringCount} expiring`} hint={`${today} → ${next7}`} />
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" href="/admin/outstanding-dues">
              Outstanding dues
            </Button>
            <Button asChild variant="outline" href="/admin/expiring-soon">
              Expiring soon
            </Button>
            <Button asChild variant="outline" href="/members">
              Open members
            </Button>
            {canManageNotifications(me.role) ? (
              <Button asChild variant="outline" href="/notifications">
                Notifications
              </Button>
            ) : null}
          </div>
          <form className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end" method="get">
            <Select label="Queue" name="segment" defaultValue={segment}>
              <option value="action">Action needed first</option>
              <option value="all">All rows</option>
              <option value="expiring">Expiring soon</option>
              <option value="due">Outstanding dues</option>
              <option value="no_attendance">No recent attendance</option>
              <option value="inactive">Inactive recently</option>
            </Select>
            <Input label="Search" name="q" defaultValue={q} placeholder="Name, email, phone, member ID" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline">
                Apply
              </Button>
              <Button asChild variant="ghost" href="/admin/crm">
                Reset
              </Button>
            </div>
          </form>
        </div>

        <Table
          keyField="id"
          stickyTopClassName="top-0"
          columns={[
            { key: 'member', header: 'Member' },
            { key: 'next_step', header: 'Next step' },
            { key: 'status', header: 'Status' },
            { key: 'last_seen', header: 'Last seen' },
            { key: 'actions', header: 'Actions' },
          ]}
          rows={rowData}
        />

        {!loadError && !rowData.length ? (
          <InlineAlert variant="info" title="No members in this queue">
            Nothing matches the current CRM filters.
          </InlineAlert>
        ) : null}

        {(hasPrev || hasNext) && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-[hsl(var(--muted))]">
              Page {page}
              {totalVisible ? ` · Showing ${start + 1}-${Math.min(start + PER_PAGE, totalVisible)} of ${totalVisible}` : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="outline"
                href={`/admin/crm${buildQS({ segment, q, page: String(page - 1) })}`}
                className={!hasPrev ? 'pointer-events-none opacity-50' : ''}
              >
                Prev
              </Button>
              <Button
                asChild
                variant="outline"
                href={`/admin/crm${buildQS({ segment, q, page: String(page + 1) })}`}
                className={!hasNext ? 'pointer-events-none opacity-50' : ''}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Section>
    </main>
  )
}
