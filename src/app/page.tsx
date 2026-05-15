// src/app/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import type React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'
import { canAccessScan, hasLifetimeGymAccess, isMemberLikeRole } from '@/lib/rbac'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import { addDays, cairoToday, diffDays } from '@/lib/cairoDate'
import HomeNotificationsTile from '@/components/HomeNotificationsTile'
import QrImage from '@/components/QrImage'
import HomeMemberLookup from '@/components/home/HomeMemberLookup'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Gift,
  House,
  IdCard,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Receipt,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  UserCog,
  UserRoundSearch,
  Users,
  Wallet,
} from 'lucide-react'

type SessionUser = {
  id: string
  email: string | null
  role: Role
  first_name?: string | null
  last_name?: string | null
  id_photo_path?: string | null
  member_id?: string | null
  qr_code?: string | null
}

type ProfileLite = {
  member_id: string | null
  qr_code: string | null
  id_photo_path: string | null
  date_of_birth: string | null
  created_at: string | null
}

type TrainingProfileLite = {
  program_level: string | null
}

type SubscriptionLite = {
  id: string
  plan: '1m' | '3m' | '6m' | '12m' | 'sessions' | null
  subscription_type: 'time' | 'sessions' | null
  status: 'active' | 'expired' | 'canceled' | 'paused' | string | null
  start_date: string | null
  end_date: string | null
  frozen_from: string | null
  frozen_until: string | null
  sessions_total: number | null
  sessions_used: number | null
  amount_due: number | null
  paid_at: string | null
}

type MembershipSnapshot = {
  tone: 'success' | 'warning' | 'neutral'
  eyebrow: string
  title: string
  meta: string
  extra?: string | null
}

type OpsKpis = {
  activeCount: number
  expiring7Count: number
  scansToday: number
  outstandingCount: number
  outstandingTotal: number
}

type HealthLite = {
  status: string | null
  createdAt: string | null
}

type TodayScheduleSession = {
  section: 'kids' | 'adults' | 'other'
  time: string
  text: string
}

type ScheduleAudience = 'adult' | 'kids_3_5' | 'kids_6_9' | 'kids_10_14' | 'kids_unknown' | 'unknown'
type ProgramLevelLite = 'beginner' | 'intermediate' | 'advanced' | 'competitor'

type PriorityTone = 'success' | 'warning' | 'danger' | 'neutral'

type PriorityItem = {
  href: string
  eyebrow: string
  title: string
  desc?: string
  icon: IconType
  tone: PriorityTone
}

type IconType = React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>

type QuickAction = {
  href: string
  label: string
  desc?: string
  icon: IconType
}


function humanizeRole(role: string) {
  const s = role.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = d.length === 10 ? new Date(`${d}T00:00:00Z`) : new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(dt)
}

function fmtMoneyEGP(v: number) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0 EGP'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function humanPlan(p?: SubscriptionLite['plan']) {
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
      return 'Membership'
    default:
      return 'Membership'
  }
}

function isFrozenNow(sub: Pick<SubscriptionLite, 'subscription_type' | 'frozen_from' | 'frozen_until'>, today: string) {
  const st = (sub.subscription_type ?? 'time') as 'time' | 'sessions'
  if (st !== 'time') return false
  const until = sub.frozen_until
  if (!until) return false
  const from = sub.frozen_from
  return from ? today >= from && today < until : today < until
}

function buildMembershipSnapshot(role: Role, subs: SubscriptionLite[], today: string): MembershipSnapshot {
  if (hasLifetimeGymAccess(role)) {
    return {
      tone: 'success',
      eyebrow: 'Always active access',
      title: 'Role-based access',
      meta: 'Your access is active in the gym without a standard renewal flow.',
      extra: null,
    }
  }

  const activeTime = subs.find((s) => {
    if (s.status !== 'active') return false
    if ((s.subscription_type ?? 'time') !== 'time') return false
    if (!s.end_date || s.end_date < today) return false
    if (isFrozenNow(s, today)) return false
    return true
  })

  if (activeTime) {
    const daysLeft = activeTime.end_date ? diffDays(today, activeTime.end_date) : null
    const due = Number(activeTime.amount_due ?? 0)
    return {
      tone: daysLeft !== null && daysLeft <= 7 ? 'warning' : 'success',
      eyebrow: daysLeft !== null && daysLeft <= 7 ? 'Needs attention soon' : 'Active membership',
      title: humanPlan(activeTime.plan),
      meta:
        daysLeft === null
          ? 'Membership active'
          : daysLeft === 0
            ? 'Ends today'
            : `${daysLeft} day(s) left · ends ${fmtDate(activeTime.end_date)}`,
      extra: due > 0 ? `Amount due: ${fmtMoneyEGP(due)}` : null,
    }
  }

  const activeSessions = subs.find((s) => {
    if (s.status !== 'active') return false
    if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'sessions') return false
    const remaining = Math.max(Number(s.sessions_total ?? 0) - Number(s.sessions_used ?? 0), 0)
    return remaining > 0
  })

  if (activeSessions) {
    const remaining = Math.max(Number(activeSessions.sessions_total ?? 0) - Number(activeSessions.sessions_used ?? 0), 0)
    const total = Number(activeSessions.sessions_total ?? 0)
    const due = Number(activeSessions.amount_due ?? 0)
    return {
      tone: remaining <= 2 ? 'warning' : 'success',
      eyebrow: remaining <= 2 ? 'Low sessions left' : 'Sessions active',
      title: `${remaining} session(s) left`,
      meta: `${Math.max(total - remaining, 0)}/${total} used`,
      extra: due > 0 ? `Amount due: ${fmtMoneyEGP(due)}` : null,
    }
  }

  const latest = subs[0]
  if (latest) {
    return {
      tone: 'neutral',
      eyebrow: 'No active membership',
      title: humanPlan(latest.plan),
      meta: latest.end_date ? `Last ended ${fmtDate(latest.end_date)}` : `Last update ${fmtDate(latest.paid_at)}`,
      extra: Number(latest.amount_due ?? 0) > 0 ? `Amount due: ${fmtMoneyEGP(Number(latest.amount_due ?? 0))}` : null,
    }
  }

  return {
    tone: 'neutral',
    eyebrow: 'No subscription yet',
    title: 'Membership not started',
    meta: 'Contact reception to create or renew a subscription.',
    extra: null,
  }
}

async function getDisplayName(u: SessionUser): Promise<string> {
  const sessionName = [u.first_name ?? '', u.last_name ?? ''].join(' ').trim()
  if (sessionName) return sessionName

  try {
    const supabase = createSupabaseRSC()
    const { data } = await supabase
      .from('profiles')
      .select('first_name,last_name,email')
      .eq('user_id', u.id)
      .maybeSingle()

    if (data) {
      const fromDb = [data.first_name ?? '', data.last_name ?? ''].join(' ').trim()
      if (fromDb) return fromDb
      if (data.email) return data.email
    }
  } catch {}

  return u.email ?? humanizeRole(u.role)
}

async function getUnreadNotificationsCount(userId: string) {
  const supabase = createSupabaseRSC()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
    .is('deleted_for_user_at', null)

  return count ?? 0
}

async function getSignedAvatar(path?: string | null) {
  if (!path) return ''
  const supabase = createSupabaseRSC()
  const { data } = await supabase.storage.from('id-photos').createSignedUrl(path, 60 * 10)
  return data?.signedUrl || ''
}

async function getProfileLite(userId: string): Promise<ProfileLite | null> {
  const supabase = createSupabaseRSC()
  const { data } = await supabase
    .from('profiles')
    .select('member_id, qr_code, id_photo_path, date_of_birth, created_at')
    .eq('user_id', userId)
    .maybeSingle<ProfileLite>()

  return data ?? null
}

async function getTrainingProfileLite(userId: string): Promise<TrainingProfileLite | null> {
  const supabase = createSupabaseRSC()
  const { data } = await supabase
    .from('member_training_profiles')
    .select('program_level')
    .eq('member_user_id', userId)
    .maybeSingle<TrainingProfileLite>()

  return data ?? null
}

async function getSubscriptionsLite(userId: string): Promise<SubscriptionLite[]> {
  const supabase = createSupabaseRSC()
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'id, plan, subscription_type, status, start_date, end_date, frozen_from, frozen_until, sessions_total, sessions_used, amount_due, paid_at'
    )
    .eq('member_id', userId)
    .order('paid_at', { ascending: false })
    .limit(20)

  return (data ?? []) as SubscriptionLite[]
}

async function getOpsKpis(): Promise<OpsKpis> {
  const supa = createSupabaseRSC()
  const today = cairoToday()
  const next7 = addDays(today, 7)

  const [{ count: activeCount }, { count: expiring7Count }, scansRes] = await Promise.all([
    supa
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('end_date', today)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    supa
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', next7)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    supa.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
  ])

  let outstandingCount = 0
  let outstandingTotal = 0

  try {
    const { data, count } = await supa
      .from('subscriptions')
      .select('amount_due', { count: 'exact' })
      .gt('amount_due', 0)
      .not('member_id', 'is', null)
      .limit(10000)

    outstandingCount = count ?? (data?.length ?? 0)
    outstandingTotal = (data ?? []).reduce((acc, row: any) => acc + Number(row?.amount_due ?? 0), 0)
  } catch {
    // ignore
  }

  return {
    activeCount: activeCount ?? 0,
    expiring7Count: expiring7Count ?? 0,
    scansToday: scansRes?.count ?? 0,
    outstandingCount,
    outstandingTotal,
  }
}


async function getLatestHealthSnapshot(): Promise<HealthLite | null> {
  try {
    const admin = getSupabaseAdminClientCached()
    const { data } = await admin
      .from('system_health_reports')
      .select('overall_status, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ overall_status: string | null; created_at: string | null }>()

    if (!data) return null
    return {
      status: data.overall_status ?? null,
      createdAt: data.created_at ?? null,
    }
  } catch {
    return null
  }
}

const HOME_SCHEDULE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const HOME_SCHEDULE_DAY_SET = new Set<string>(HOME_SCHEDULE_DAYS)

function cairoDayName() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'long' }).format(new Date())
}

function normalizeScheduleDash(line: string) {
  return line.replace(/\s-\s/g, ' – ').replace(/\s—\s/g, ' – ').replace(/\s–\s/g, ' – ')
}

function splitHomeScheduleSessions(line: string): Array<{ time: string; text: string }> {
  const s = normalizeScheduleDash(line)
  const rx = /(\d{1,2}:\d{2}\s*(?:AM|PM))\s*–\s*/gi
  const matches = Array.from(s.matchAll(rx))

  if (matches.length <= 1) {
    const one = s.match(/^\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*–\s*(.*)$/i)
    if (!one) return []
    return [{ time: one[1].trim(), text: (one[2] || '').trim() }]
  }

  const out: Array<{ time: string; text: string }> = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const time = (m[1] || '').trim()
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? s.length) : s.length
    const sessionText = s.slice(start, end).trim()
    if (time && sessionText) out.push({ time, text: sessionText })
  }
  return out
}

function extractTodaySchedule(content: string, dayName: string): TodayScheduleSession[] {
  const marker = 'Weekly Schedule by Day'
  const idx = content.indexOf(marker)
  if (idx < 0) return []

  const lines = content
    .slice(idx + marker.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  let inCurrentDay = false
  let section: TodayScheduleSession['section'] = 'other'
  const sessions: TodayScheduleSession[] = []

  for (const raw of lines) {
    const line = normalizeScheduleDash(raw)

    if (HOME_SCHEDULE_DAY_SET.has(line)) {
      if (inCurrentDay) break
      inCurrentDay = line === dayName
      section = 'other'
      continue
    }

    if (!inCurrentDay) continue

    if (line === 'Kids & Teens') {
      section = 'kids'
      continue
    }
    if (line === 'Adults') {
      section = 'adults'
      continue
    }

    const split = splitHomeScheduleSessions(line)
    if (split.length) {
      for (const item of split) {
        sessions.push({ section, time: item.time, text: item.text })
      }
      continue
    }

    sessions.push({ section: 'other', time: '', text: line })
  }

  return sessions
}

async function getTodaySchedule(): Promise<{ dayName: string; sessions: TodayScheduleSession[] } | null> {
  try {
    const supabase = createSupabaseRSC()
    const { data } = await supabase.from('app_schedule').select('content').eq('key', 'main').maybeSingle<{ content: string | null }>()
    const content = data?.content?.trim()
    if (!content) return null
    const dayName = cairoDayName()
    return { dayName, sessions: extractTodaySchedule(content, dayName) }
  } catch {
    return null
  }
}


function normalizeProgramLevel(value?: string | null): ProgramLevelLite | null {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'beginner' || v === 'intermediate' || v === 'advanced' || v === 'competitor') return v
  return null
}

function ageYearsForSchedule(dateOfBirth?: string | null) {
  if (!dateOfBirth) return null
  const dob = new Date(`${dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getUTCFullYear() - dob.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth()
  const dayDiff = today.getUTCDate() - dob.getUTCDate()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1
  return age >= 0 ? age : null
}

function inferScheduleAudience(role: Role, dateOfBirth?: string | null): ScheduleAudience {
  const age = ageYearsForSchedule(dateOfBirth)
  if (typeof age === 'number') {
    if (age >= 15) return 'adult'
    if (age >= 10) return 'kids_10_14'
    if (age >= 6) return 'kids_6_9'
    if (age >= 3) return 'kids_3_5'
    return 'kids_unknown'
  }

  if (role === 'coach' || role === 'assistant_coach' || role === 'head_coach') return 'adult'
  return 'unknown'
}

function isCompetitionSession(text: string) {
  const value = text.toLowerCase()
  return value.includes('competition') || value.includes('competitor') || value.includes('group a') || value.includes('group b')
}

function matchesKidsAgeBand(text: string, audience: Exclude<ScheduleAudience, 'adult' | 'unknown'>) {
  const value = text.toLowerCase()
  if (audience === 'kids_unknown') return true
  if (audience === 'kids_3_5') return value.includes('3–5') || value.includes('3-5') || value.includes('baby')
  if (audience === 'kids_6_9') return value.includes('6–9') || value.includes('6-9')
  if (audience === 'kids_10_14') return value.includes('10–14') || value.includes('10-14') || value.includes('teen')
  return false
}

function matchesProgram(text: string, program: ProgramLevelLite) {
  const value = text.toLowerCase()
  if (program === 'beginner') return value.includes('beginner')
  if (program === 'intermediate') return value.includes('intermediate')
  if (program === 'advanced') return value.includes('advanced')
  return isCompetitionSession(value)
}

function filterTodayScheduleForProfile(
  sessions: TodayScheduleSession[],
  audience: ScheduleAudience,
  program: ProgramLevelLite | null,
): TodayScheduleSession[] {
  const base = sessions.filter((session) => session.section !== 'other')

  if (!program) {
    if (audience === 'adult') return base.filter((session) => session.section === 'adults')
    if (audience.startsWith('kids_')) return base.filter((session) => session.section === 'kids')
    return base
  }

  if (audience === 'adult') {
    return base.filter((session) => session.section === 'adults' && matchesProgram(session.text, program))
  }

  if (
    audience === 'kids_3_5' ||
    audience === 'kids_6_9' ||
    audience === 'kids_10_14' ||
    audience === 'kids_unknown'
  ) {
    return base.filter((session) => {
      if (session.section !== 'kids') return false
      if (program === 'competitor') return isCompetitionSession(session.text)
      return matchesKidsAgeBand(session.text, audience) && matchesProgram(session.text, program)
    })
  }

  return base.filter((session) => matchesProgram(session.text, program))
}

function priorityToneClasses(tone: PriorityTone) {
  if (tone === 'success') {
    return {
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      iconWrap: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    }
  }
  if (tone === 'warning') {
    return {
      badge: 'border-amber-200 bg-amber-50 text-amber-800',
      iconWrap: 'border-amber-200 bg-amber-50 text-amber-800',
    }
  }
  if (tone === 'danger') {
    return {
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      iconWrap: 'border-rose-200 bg-rose-50 text-rose-700',
    }
  }
  return {
    badge: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]',
    iconWrap: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black',
  }
}

function PriorityCard({ href, eyebrow, title, desc: _desc, icon: Icon, tone }: PriorityItem) {
  const styles = priorityToneClasses(tone)

  return (
    <Link
      href={href}
      className="group block rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles.badge}`}>{eyebrow}</div>
          <div className="mt-3 text-sm font-semibold tracking-tight sm:text-base">{title}</div>
        </div>
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${styles.iconWrap}`}>
          <Icon size={18} strokeWidth={2.1} />
        </span>
      </div>
    </Link>
  )
}

function PriorityGrid({ title, subtitle, items }: { title: string; subtitle?: string; items: PriorityItem[] }) {
  return (
    <Surface className="p-4 sm:p-5">
      <SectionTitle title={title} subtitle={subtitle} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <PriorityCard key={`${item.href}-${item.title}`} {...item} />
        ))}
      </div>
    </Surface>
  )
}

function buildMemberPriorities(snapshot: MembershipSnapshot, unreadCount: number, hasQr: boolean): PriorityItem[] {
  const accessReady = snapshot.tone === 'success'
  const accessTone: PriorityTone = accessReady ? 'success' : snapshot.tone === 'warning' ? 'warning' : 'danger'

  return [
    {
      href: '/profile',
      eyebrow: 'Your access today',
      title: accessReady ? 'Membership ready' : 'Check your membership',
      desc: snapshot.meta,
      icon: accessReady ? ShieldCheck : AlertTriangle,
      tone: accessTone,
    },
    {
      href: '/profile',
      eyebrow: 'QR readiness',
      title: hasQr ? 'QR code ready' : 'QR missing',
      desc: hasQr ? 'Show your QR code at reception for fast entry.' : 'Open your profile to confirm your QR code is available.',
      icon: IdCard,
      tone: hasQr ? 'success' : 'warning',
    },
    {
      href: '/notifications',
      eyebrow: 'Inbox today',
      title: unreadCount > 0 ? `${unreadCount} unread update(s)` : 'Inbox up to date',
      desc: unreadCount > 0 ? 'Open your notifications before your next visit.' : 'No unread updates right now.',
      icon: Bell,
      tone: unreadCount > 0 ? 'warning' : 'neutral',
    },
    {
      href: '/schedule',
      eyebrow: 'Useful next step',
      title: 'Check today’s schedule',
      desc: 'Open the latest class times before you head to the gym.',
      icon: CalendarDays,
      tone: 'neutral',
    },
  ]
}

function buildStaffPriorities(role: 'coach' | 'assistant_coach' | 'head_coach', unreadCount: number, hasQr: boolean): PriorityItem[] {
  return [
    {
      href: '/profile',
      eyebrow: 'Your access today',
      title: hasQr ? 'QR ready for entry' : 'Open profile first',
      desc: hasQr ? 'Your staff QR code is ready for daily access.' : 'Open your profile and confirm your QR code before heading to class.',
      icon: hasQr ? ShieldCheck : IdCard,
      tone: hasQr ? 'success' : 'warning',
    },
    {
      href: '/notifications',
      eyebrow: 'Staff updates',
      title: unreadCount > 0 ? `${unreadCount} unread update(s)` : 'Inbox up to date',
      desc: unreadCount > 0 ? 'Check your latest staff instructions and notices.' : 'No unread staff update right now.',
      icon: Bell,
      tone: unreadCount > 0 ? 'warning' : 'neutral',
    },
    {
      href: role === 'assistant_coach' ? '/schedule' : '/members',
      eyebrow: role === 'assistant_coach' ? 'Training useful' : 'Lookup today',
      title: role === 'assistant_coach' ? 'Open the schedule' : 'Open member lookup',
      desc:
        role === 'assistant_coach'
          ? 'Keep the day moving with fast access to your schedule and staff shortcuts.'
          : 'Search a member quickly with read-only access when you need to help on the mat.',
      icon: role === 'assistant_coach' ? CalendarDays : UserRoundSearch,
      tone: 'neutral',
    },
    {
      href: '/packages-and-promos',
      eyebrow: 'Useful shortcut',
      title: 'Open current offers',
      desc: 'Keep the current promos close when members ask for quick information.',
      icon: Gift,
      tone: 'neutral',
    },
  ]
}

function buildReceptionPriorities(ops: OpsKpis): PriorityItem[] {
  return [
    {
      href: '/scan',
      eyebrow: 'Entrance flow',
      title: ops.scansToday > 0 ? `${ops.scansToday} scan(s) today` : 'Open scan now',
      desc: ops.scansToday > 0 ? 'Keep the entrance moving with the scan and kiosk flow.' : 'No scan recorded yet today. Start with the scanner.',
      icon: ScanLine,
      tone: ops.scansToday > 0 ? 'success' : 'warning',
    },
    {
      href: '/admin/expiring-soon',
      eyebrow: 'Renewals',
      title: ops.expiring7Count > 0 ? `${ops.expiring7Count} member(s) expiring soon` : 'No urgent renewal queue',
      desc: ops.expiring7Count > 0 ? 'Review renewals first before the queue grows.' : 'The current renewal queue looks calm.',
      icon: Clock3,
      tone: ops.expiring7Count > 0 ? 'warning' : 'neutral',
    },
    {
      href: '/admin/outstanding-dues',
      eyebrow: 'Money to collect',
      title: ops.outstandingCount > 0 ? `${ops.outstandingCount} member(s) with dues` : 'No outstanding due right now',
      desc: ops.outstandingCount > 0 ? `${fmtMoneyEGP(ops.outstandingTotal)} still open across member balances.` : 'Outstanding balances are currently clear.',
      icon: Wallet,
      tone: ops.outstandingCount > 0 ? 'danger' : 'neutral',
    },
    {
      href: '/admin/crm',
      eyebrow: 'Follow-up queue',
      title: 'Open today’s CRM queue',
      desc: 'Use the live queue for WhatsApp, calls, email and member follow-up.',
      icon: MessageSquare,
      tone: 'neutral',
    },
  ]
}

function buildAdminPriorities(ops: OpsKpis, health: HealthLite | null, role: 'admin' | 'super_admin'): PriorityItem[] {
  const healthStatus = (health?.status ?? '').toLowerCase()
  const healthTone: PriorityTone = healthStatus === 'critical' ? 'danger' : healthStatus === 'warning' ? 'warning' : healthStatus === 'healthy' ? 'success' : 'neutral'
  const healthTitle = healthStatus ? `${healthStatus.charAt(0).toUpperCase()}${healthStatus.slice(1)} health status` : 'Health monitor not run yet'
  const healthDesc = health?.createdAt
    ? `Latest stored report: ${fmtDate(health.createdAt)}. Open Health Monitor for details.`
    : 'Run Health Monitor or open the latest report details.'

  const items: PriorityItem[] = [
    {
      href: '/admin/crm',
      eyebrow: 'Operations today',
      title: 'Open the follow-up queue',
      desc: 'Review expiring members, dues and no-attendance cases in one live queue.',
      icon: MessageSquare,
      tone: ops.expiring7Count > 0 || ops.outstandingCount > 0 ? 'warning' : 'neutral',
    },
    {
      href: '/admin/health-monitor',
      eyebrow: 'System health',
      title: healthTitle,
      desc: healthDesc,
      icon: healthTone === 'success' ? ShieldCheck : ShieldAlert,
      tone: healthTone,
    },
    {
      href: '/admin/payments',
      eyebrow: 'Finance today',
      title: ops.outstandingCount > 0 ? `${fmtMoneyEGP(ops.outstandingTotal)} outstanding` : 'Finance looks clear',
      desc: ops.outstandingCount > 0 ? 'Move quickly into payments, dues and cash review.' : 'Open payments and cash report when you need the detailed view.',
      icon: CreditCard,
      tone: ops.outstandingCount > 0 ? 'warning' : 'neutral',
    },
    {
      href: '/admin/personal-funds',
      eyebrow: role === 'super_admin' ? 'Control' : 'Review',
      title: 'Open personal funds',
      desc: 'Review partner advances, reimbursements and related proof quickly.',
      icon: Wallet,
      tone: 'neutral',
    },
    {
      href: '/admin/external-income',
      eyebrow: 'Other income',
      title: 'Track bar and store sales',
      desc: 'Log extra income outside subscriptions with note and attachment.',
      icon: Wallet,
      tone: 'neutral',
    },
  ]

  return items
}

function toneClasses(tone: 'success' | 'warning' | 'neutral') {
  if (tone === 'success') {
    return {
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      accent: 'text-emerald-700',
    }
  }

  if (tone === 'warning') {
    return {
      badge: 'border-amber-200 bg-amber-50 text-amber-800',
      accent: 'text-amber-800',
    }
  }

  return {
    badge: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]',
    accent: 'text-black',
  }
}

function Surface({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <section className={`rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft ${className}`}>{children}</section>
}

function SectionTitle({ title, subtitle: _subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
    </div>
  )
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">
      {humanizeRole(role)}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  hint: _hint,
  href,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  href?: string
}) {
  const inner = (
    <Surface className="p-4 sm:p-5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </Surface>
  )

  if (!href) return inner
  return (
    <Link href={href} className="block rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {inner}
    </Link>
  )
}

function ActionCard({ href, label, desc: _desc, icon: Icon }: QuickAction) {
  return (
    <Link
      href={href}
      className="group block rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">{label}</div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] transition group-hover:translate-x-0.5">
          <Icon size={18} strokeWidth={2.1} className="text-black" />
        </span>
      </div>
    </Link>
  )
}

function HeroCard({
  displayName,
  role,
  avatarUrl,
  memberId,
  joinedAt,
}: {
  displayName: string
  role: Role
  avatarUrl?: string
  memberId?: string | null
  joinedAt?: string | null
}) {
  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={role} />
            {memberId ? (
              <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">
                Member ID: {memberId}
              </span>
            ) : null}
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Welcome, {displayName}</h1>

          {joinedAt ? (
            <div className="mt-3 text-xs text-[hsl(var(--muted))]">Joined {fmtDate(joinedAt)}</div>
          ) : null}
        </div>

        {avatarUrl ? (
          <div className="relative h-24 w-24 overflow-hidden rounded-full border border-[hsl(var(--border))] bg-white ring-1 ring-[hsl(var(--border))] shadow-soft sm:h-28 sm:w-28 lg:h-32 lg:w-32">
            <Image src={avatarUrl} alt="Profile photo" fill className="object-cover" />
          </div>
        ) : null}
      </div>
    </Surface>
  )
}

function MembershipCard({ snapshot }: { snapshot: MembershipSnapshot }) {
  const tone = toneClasses(snapshot.tone)

  return (
    <Surface className="p-4 sm:p-5">
      <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}>{snapshot.eyebrow}</div>
      <div className={`mt-3 text-xl font-semibold tracking-tight ${tone.accent}`}>{snapshot.title}</div>
      <p className="mt-2 text-sm text-[hsl(var(--muted))]">{snapshot.meta}</p>
      {snapshot.extra ? <p className="mt-2 text-sm font-medium text-black">{snapshot.extra}</p> : null}
      <div className="mt-4 flex items-center gap-2 text-sm font-medium">
        <Link href="/profile" className="inline-flex items-center gap-1 hover:underline">
          Open profile
          <ArrowRight size={15} />
        </Link>
      </div>
    </Surface>
  )
}

function StaffAccessCard({ role }: { role: 'coach' | 'assistant_coach' | 'head_coach' }) {
  return (
    <Surface className="p-4 sm:p-5">
      <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
        Staff access
      </div>
      <div className="mt-3 text-xl font-semibold tracking-tight text-emerald-700">Always active</div>
      <p className="mt-2 text-sm text-[hsl(var(--muted))]">
        {role === 'coach'
          ? 'Your coach access is designed for daily training operations.'
          : role === 'head_coach'
            ? 'Your head coach access is designed for daily training operations.'
            : 'Your assistant coach access is designed for daily training operations.'}
      </p>
      <div className="mt-4 flex items-center gap-2 text-sm font-medium">
        <Link href="/profile" className="inline-flex items-center gap-1 hover:underline">
          Open profile
          <ArrowRight size={15} />
        </Link>
      </div>
    </Surface>
  )
}

async function QrCard({ qrCode }: { qrCode?: string | null }) {
  return (
    <Surface className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-tight">My QR code</div>
        </div>
        <IdCard size={18} className="mt-0.5 text-black" />
      </div>

      <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
        {qrCode ? (
          <div className="text-center">
            <QrImage value={qrCode} size={132} />
          </div>
        ) : (
          <div className="text-sm text-[hsl(var(--muted))]">No QR code available.</div>
        )}
      </div>
    </Surface>
  )
}

function TodayScheduleSection({ dayName, sessions }: { dayName: string; sessions: TodayScheduleSession[] }) {
  return (
    <Surface className="p-4 sm:p-5">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">Today’s schedule</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">{dayName}</div>
          </div>
          <span className="inline-flex h-10 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 text-sm font-semibold text-black transition group-open:bg-black group-open:text-white">
            Show
          </span>
        </summary>

        <div className="mt-4 space-y-3">
          {sessions.length ? (
            <div className="space-y-2">
              {sessions.map((item, index) => (
                <div key={`${index}-${item.time || item.text}`} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2.5 text-sm text-black">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.time ? (
                      <span className="rounded-full bg-black px-2.5 py-1 text-[11px] font-semibold text-white">{item.time}</span>
                    ) : null}
                    <span>{item.text}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
              No matching class today.
            </div>
          )}

          <div>
            <Link
              href="/schedule"
              className="inline-flex items-center gap-1 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-[hsl(var(--bg))]"
            >
              View schedule
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </details>
    </Surface>
  )
}

function QuickActions({ title, subtitle: _subtitle, items }: { title: string; subtitle?: string; items: QuickAction[] }) {
  return (
    <Surface className="p-4 sm:p-5">
      <SectionTitle title={title} subtitle={_subtitle} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <ActionCard key={item.href} {...item} />
        ))}
      </div>
    </Surface>
  )
}


function HomeScanShortcut() {
  return (
    <Surface className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">Scan access</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Open the scanner fast</h2>
        </div>
        <Link
          href="/scan"
          className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:opacity-90"
        >
          Open scan
        </Link>
      </div>
    </Surface>
  )
}


function HomeLogoutShortcut() {
  return (
    <Surface className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">Session</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Sign out from Home</h2>
        </div>
        <Link
          href="/logout"
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-semibold text-black shadow-soft transition hover:bg-[hsl(var(--surface-2))]"
        >
          <LogOut size={16} />
          Logout
        </Link>
      </div>
    </Surface>
  )
}


function memberActions(): QuickAction[] {
  return [
    { href: '/profile', label: 'My profile', desc: 'Identity, subscription details and QR code.', icon: IdCard },
    { href: '/store', label: 'Store', desc: 'Browse available products and equipment.', icon: ShoppingBag },
    { href: '/notifications?thread=admin', label: 'Contact admin', desc: 'Message the ATOM team.', icon: UserCog },
  ]
}

function coachActions(): QuickAction[] {
  return [
    { href: '/profile', label: 'My profile', desc: 'Identity, QR code and personal info.', icon: IdCard },
    { href: '/schedule', label: 'Schedule', desc: 'Open the latest class schedule.', icon: CalendarDays },
    { href: '/notifications', label: 'Notifications', desc: 'Read the latest staff updates.', icon: Bell },
    { href: '/packages-and-promos', label: 'Packages & promos', desc: 'Quick access to current offers.', icon: Gift },
  ]
}

function receptionActions(): QuickAction[] {
  return [
    { href: '/scan', label: 'Scan', desc: 'Fast attendance and QR validation.', icon: ScanLine },
    { href: '/kiosk', label: 'Create member', desc: 'Open the front-desk member creation flow.', icon: IdCard },
    { href: '/members', label: 'Members', desc: 'Search and manage members quickly.', icon: Users },
    { href: '/admin/crm', label: 'CRM queue', desc: 'Work through follow-ups and contact priorities.', icon: MessageSquare },
    { href: '/schedule', label: 'Schedule', desc: 'Check class times on the desk.', icon: CalendarDays },
    { href: '/notifications', label: 'Notifications', desc: 'Read operational updates.', icon: Bell },
    { href: '/packages-and-promos', label: 'Packages & promos', desc: 'Use offers at the desk when needed.', icon: Gift },
  ]
}

function adminActions(role: 'admin' | 'super_admin'): QuickAction[] {
  const base: QuickAction[] = [
    { href: '/admin', label: 'Dashboard', desc: 'Operational KPIs and admin overview.', icon: LayoutDashboard },
    { href: '/admin/crm', label: 'CRM queue', desc: 'Review follow-ups and daily contact priorities.', icon: MessageSquare },
    { href: '/scan', label: 'Scan', desc: 'QR check-in and validation flow.', icon: ScanLine },
    { href: '/members', label: 'Members', desc: 'Open the members workspace.', icon: Users },
    { href: '/admin/payments', label: 'Payments', desc: 'Track subscription payments.', icon: CreditCard },
    { href: '/admin/cash-report', label: 'Cash report', desc: 'Review daily payment summaries.', icon: Wallet },
    { href: '/expenses', label: 'Expenses', desc: 'Open expenses and categories.', icon: Receipt },
    { href: '/admin/personal-funds', label: 'Personal funds', desc: 'Review advances, reimbursements and proof.', icon: Wallet },
    { href: '/admin/external-income', label: 'Other income', desc: 'Track money coming from bar, store or other sources.', icon: Wallet },
    { href: '/admin/health-monitor', label: 'Health Monitor', desc: 'Open the latest health status and reports.', icon: ShieldCheck },
    { href: '/admin/outstanding-dues', label: 'Outstanding dues', desc: 'Focus on unpaid balances.', icon: Wallet },
    { href: '/admin/expiring-soon', label: 'Expiring soon', desc: 'Review urgent renewals.', icon: Bell },
  ]

  if (role === 'super_admin') {
    base.splice(8, 0, { href: '/admin/store/dashboard', label: 'Store admin', desc: 'Open the store dashboard and operations hub.', icon: LayoutDashboard })
    base.push({ href: '/admin/permissions-audit', label: 'Permissions audit', desc: 'Review who can access what.', icon: UserCog })
  }

  return base
}

export default async function HomePage() {
  const user = (await getSessionUser()) as SessionUser | null

  if (!user) {
    return (
      <main className="min-h-[calc(100vh-3rem)] bg-[hsl(var(--bg))] text-black">
        <section className="mx-auto max-w-6xl px-4 py-8">
          <Surface className="p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to ATOM</h1>
            <p className="mt-2 max-w-xl text-sm text-[hsl(var(--muted))] sm:text-base">
              Sign in to access your role dashboard, QR code, subscriptions and daily operations.
            </p>
            <div className="mt-5">
              <Link
                href="/login"
                className="inline-flex items-center rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white shadow-soft"
              >
                Sign in
              </Link>
            </div>
          </Surface>
        </section>
      </main>
    )
  }

  const displayName = await getDisplayName(user)
  const showHomeTodaySchedule = isMemberLikeRole(user.role) || user.role === 'coach' || user.role === 'assistant_coach' || user.role === 'head_coach'
  const [profile, unreadNotificationsCount, trainingProfile, homeTodaySchedule] = await Promise.all([
    getProfileLite(user.id),
    getUnreadNotificationsCount(user.id),
    showHomeTodaySchedule ? getTrainingProfileLite(user.id) : Promise.resolve(null),
    showHomeTodaySchedule ? getTodaySchedule() : Promise.resolve(null),
  ])

  const homeScheduleAudience = inferScheduleAudience(user.role, profile?.date_of_birth ?? null)
  const homeScheduleProgram = normalizeProgramLevel(trainingProfile?.program_level ?? null)
  const filteredHomeTodaySchedule = homeTodaySchedule
    ? {
        dayName: homeTodaySchedule.dayName,
        sessions: filterTodayScheduleForProfile(homeTodaySchedule.sessions, homeScheduleAudience, homeScheduleProgram),
      }
    : null

  const avatarPath = user.id_photo_path ?? profile?.id_photo_path ?? null
  const avatarUrl = ['member', 'champion', 'vip', 'coach', 'assistant_coach', 'head_coach'].includes(user.role) ? await getSignedAvatar(avatarPath) : ''
  const memberId = user.member_id ?? profile?.member_id ?? null
  const qrCode = user.qr_code ?? profile?.qr_code ?? null

  let memberSnapshot: MembershipSnapshot | null = null
  let opsKpis: OpsKpis | null = null
  let healthSnapshot: HealthLite | null = null

  if (isMemberLikeRole(user.role) || hasLifetimeGymAccess(user.role)) {
    const subs = await getSubscriptionsLite(user.id)
    memberSnapshot = buildMembershipSnapshot(user.role, subs, cairoToday())
  }

  if (['reception', 'admin', 'super_admin'].includes(user.role)) {
    opsKpis = await getOpsKpis()
  }

  if (user.role === 'admin' || user.role === 'super_admin') {
    healthSnapshot = await getLatestHealthSnapshot()
  }

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[hsl(var(--bg))] text-black">
      <section className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:py-8">
        <HeroCard
          displayName={displayName}
          role={user.role}
          avatarUrl={avatarUrl || undefined}
          memberId={memberId}
          joinedAt={profile?.created_at ?? null}
        />

        {user.role === 'scan_terminal' ? <HomeLogoutShortcut /> : null}

        {canAccessScan(user.role) ? <HomeScanShortcut /> : null}

        {isMemberLikeRole(user.role) ? (
          <>
            {filteredHomeTodaySchedule ? <TodayScheduleSection dayName={filteredHomeTodaySchedule.dayName} sessions={filteredHomeTodaySchedule.sessions} /> : null}

            <PriorityGrid
              title="Your access today"
              subtitle="The essentials only. Open what matters next."
              items={buildMemberPriorities(memberSnapshot!, unreadNotificationsCount, Boolean(qrCode))}
            />

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <MembershipCard snapshot={memberSnapshot!} />
              <QrCard qrCode={qrCode} />
            </div>

            <QuickActions
              title="Quick actions"
              subtitle="Keep the next step simple."
              items={memberActions()}
            />
          </>
        ) : null}

        {(user.role === 'coach' || user.role === 'assistant_coach' || user.role === 'head_coach') ? (
          <>
            {filteredHomeTodaySchedule ? <TodayScheduleSection dayName={filteredHomeTodaySchedule.dayName} sessions={filteredHomeTodaySchedule.sessions} /> : null}

            <PriorityGrid
              title="Training useful today"
              subtitle="Useful only, with less repetition."
              items={buildStaffPriorities(user.role, unreadNotificationsCount, Boolean(qrCode))}
            />

            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <QrCard qrCode={qrCode} />
              <QuickActions
                title="Coach shortcuts"
                subtitle="The most useful staff actions first."
                items={coachActions().slice(0, 3)}
              />
            </div>

            {(user.role === 'coach' || user.role === 'head_coach') ? (
              <HomeMemberLookup
                title="Quick member lookup"
                subtitle="Coach access is read-only. Search fast when you need help on the mat."
                canOpenProfile
                showSensitiveFields={false}
              />
            ) : null}
          </>
        ) : null}

        {user.role === 'reception' ? (
          <>
            <PriorityGrid
              title="Today’s priorities"
              subtitle="Overview first, then your next desk action."
              items={buildReceptionPriorities(opsKpis!)}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <SummaryCard label="Scans today" value={opsKpis?.scansToday ?? 0} hint={`Attendance · ${cairoToday()}`} href="/scan" />
              <SummaryCard label="Expiring soon" value={opsKpis?.expiring7Count ?? 0} hint="Members to renew soon." href="/admin/expiring-soon" />
              <SummaryCard label="Outstanding dues" value={opsKpis?.outstandingCount ?? 0} hint={fmtMoneyEGP(opsKpis?.outstandingTotal ?? 0)} href="/admin/outstanding-dues" />
            </div>

            <QuickActions
              title="Quick actions"
              subtitle="The desk tools used most often."
              items={receptionActions().slice(0, 5)}
            />

            <HomeMemberLookup
              title="Member lookup"
              subtitle="Open a member fast when the desk needs action."
              canOpenProfile
            />
          </>
        ) : null}

        {(user.role === 'admin' || user.role === 'super_admin') ? (
          <>
            <PriorityGrid
              title="Operations today"
              subtitle="Priorities first, then your main admin tools."
              items={buildAdminPriorities(opsKpis!, healthSnapshot, user.role)}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <SummaryCard label="Expiring soon" value={opsKpis?.expiring7Count ?? 0} hint="Renewals needing attention." href="/admin/expiring-soon" />
              <SummaryCard label="Outstanding total" value={fmtMoneyEGP(opsKpis?.outstandingTotal ?? 0)} hint={`${opsKpis?.outstandingCount ?? 0} member(s) with dues`} href="/admin/outstanding-dues" />
              <SummaryCard label="Scans today" value={opsKpis?.scansToday ?? 0} hint={`Kiosk attendance · ${cairoToday()}`} href="/admin/scan-audit" />
            </div>

            <QuickActions
              title="Admin shortcuts"
              subtitle="Keep the main operations close."
              items={adminActions(user.role).slice(0, user.role === 'super_admin' ? 7 : 6)}
            />

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <HomeMemberLookup
                title="Member lookup"
                subtitle="Search and open member pages without leaving the dashboard."
                canOpenProfile
              />
              <div className="space-y-4">
                <HomeNotificationsTile
                  href="/notifications"
                  label="Notifications"
                  desc="Unread operational updates, without extra dashboard noise."
                  initialCount={unreadNotificationsCount}
                />
                <SummaryCard
                  label="Full admin view"
                  value="Open admin dashboard"
                  hint="Reporting, exports and extended operational controls."
                  href="/admin"
                />
              </div>
            </div>
          </>
        ) : null}
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-1 text-xs text-[hsl(var(--muted))]">
        © {new Date().getFullYear()} ATOM Jiu-Jitsu
      </footer>
    </main>
  )
}
