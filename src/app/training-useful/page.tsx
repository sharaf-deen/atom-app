// src/app/training-useful/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import type React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  IdCard,
  ScanLine,
  ShieldCheck,
  UserRoundSearch,
  Users,
} from 'lucide-react'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'
import {
  canAccessCoachMemberIncidents,
  canAccessCoachStaffAttendance,
  canAccessCoachTrainingLogs,
  canAccessCoachCurriculum,
  canAccessScheduleOperations,
  canAccessScheduleTrainingSessions,
  canAccessTrainingUseful,
} from '@/lib/rbac'
import HomeMemberLookup from '@/components/home/HomeMemberLookup'
import HomeNotificationsTile from '@/components/HomeNotificationsTile'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import QrImage from '@/components/QrImage'

type ProfileLite = {
  qr_code: string | null
  member_id: string | null
}

type QuickLink = {
  href: string
  label: string
  desc: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
}

type SessionLite = {
  id: string
  session_date: string
  start_time: string
  end_time: string | null
  name_snapshot: string
  level_snapshot: string
  activity_type_snapshot: string
  mat_snapshot: string | null
  status: string
}

function Surface({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <section className={`rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft ${className}`}>{children}</section>
}

function roleLabel(role: Role) {
  switch (role) {
    case 'coach':
      return 'Coach'
    case 'assistant_coach':
      return 'Assistant coach'
    case 'head_coach':
      return 'Head coach'
    case 'admin':
      return 'Admin preview'
    case 'super_admin':
      return 'Super admin preview'
    default:
      return 'Staff'
  }
}

function cairoDateIso() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function formatSessionDate(dateIso: string, today: string) {
  if (dateIso === today) return 'Today'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'Africa/Cairo',
    }).format(new Date(`${dateIso}T12:00:00Z`))
  } catch {
    return dateIso
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  return value.slice(0, 5)
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

async function getProfileLite(userId: string): Promise<ProfileLite | null> {
  const supabase = createSupabaseRSC()
  const { data } = await supabase
    .from('profiles')
    .select('qr_code, member_id')
    .eq('user_id', userId)
    .maybeSingle<ProfileLite>()

  return data ?? null
}

async function getCoachSessions(userId: string, role: Role) {
  const coachingRole = role === 'assistant_coach' || role === 'coach' || role === 'head_coach' || role === 'super_admin'
  if (!coachingRole || !canAccessScheduleTrainingSessions(role)) return [] as SessionLite[]

  const today = cairoDateIso()
  const through = addDays(today, 6)
  const supabase = createSupabaseRSC()

  const { data: sessionRows, error } = await supabase
    .from('schedule_training_sessions')
    .select('id,session_date,start_time,end_time,name_snapshot,level_snapshot,activity_type_snapshot,mat_snapshot,status')
    .gte('session_date', today)
    .lte('session_date', through)
    .neq('status', 'cancelled')
    .order('session_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(80)

  if (error || !sessionRows?.length) return [] as SessionLite[]

  let sessions = sessionRows as SessionLite[]

  if (role === 'assistant_coach' || role === 'coach') {
    const ids = sessions.map((row) => row.id)
    const { data: assignments, error: assignmentError } = await supabase
      .from('schedule_session_coach_assignments')
      .select('training_session_id')
      .eq('is_active', true)
      .eq('staff_user_id', userId)
      .in('training_session_id', ids)

    if (assignmentError) return [] as SessionLite[]
    const assignedIds = new Set((assignments ?? []).map((row: any) => String(row.training_session_id)))
    sessions = sessions.filter((row) => assignedIds.has(row.id))
  }

  return sessions.slice(0, 5)
}

function todayActions(role: Role): QuickLink[] {
  const links: QuickLink[] = []

  if (canAccessScheduleTrainingSessions(role)) {
    links.push({
      href: '/schedule/sessions',
      label: role === 'head_coach' || role === 'super_admin' ? 'Sessions' : 'My sessions',
      desc: role === 'head_coach' || role === 'super_admin'
        ? 'Open upcoming dated sessions and coaching assignments.'
        : 'Open the sessions where you are assigned.',
      icon: CalendarDays,
    })
  }

  if (canAccessCoachTrainingLogs(role)) {
    links.push({
      href: '/coach-operations/training-logs',
      label: 'Training log',
      desc: 'Record what was actually taught after the session.',
      icon: ClipboardCheck,
    })
  }

  if (canAccessCoachStaffAttendance(role)) {
    links.push({
      href: '/coach-operations/staff-attendance',
      label: 'Staff attendance',
      desc: 'Check your QR attendance and session match.',
      icon: ScanLine,
    })
  }

  if (canAccessCoachMemberIncidents(role)) {
    links.push({
      href: '/coach-operations/incidents',
      label: 'Report incident',
      desc: 'Record a behaviour, safety, injury or training incident.',
      icon: Activity,
    })
  }

  return links
}

function secondaryActions(role: Role): QuickLink[] {
  const links: QuickLink[] = []

  if (canAccessScheduleOperations(role)) {
    links.push({
      href: '/schedule/operations',
      label: 'Schedule operations',
      desc: 'Open the complete coaching-session workspace.',
      icon: CalendarDays,
    })
  }

  if (canAccessCoachCurriculum(role)) {
    links.push({
      href: '/coach-operations/curriculum',
      label: 'Training curriculum',
      desc: 'Find techniques, situations and coaching references.',
      icon: BookOpen,
    })
  }

  if (role === 'head_coach') {
    links.push(
      {
        href: '/head-coach/athletes',
        label: 'Athletes',
        desc: 'Progress, promotions and competition tracking.',
        icon: Users,
      },
      {
        href: '/head-coach/private-coaching',
        label: 'Private coaching',
        desc: 'Bookings, requests, availability and session follow-up.',
        icon: UserRoundSearch,
      },
    )
  }

  return links
}

export default async function TrainingUsefulPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/training-useful')
  if (!canAccessTrainingUseful(user.role)) redirect('/')

  const [profile, unreadCount, upcomingSessions] = await Promise.all([
    getProfileLite(user.id),
    getUnreadNotificationsCount(user.id),
    getCoachSessions(user.id, user.role),
  ])

  const qrCode = user.qr_code ?? profile?.qr_code ?? null
  const today = cairoDateIso()
  const coachingRole = user.role === 'assistant_coach' || user.role === 'coach' || user.role === 'head_coach'
  const primaryActions = todayActions(user.role)
  const moreActions = secondaryActions(user.role)

  return (
    <main>
      <PageHeader
        title="Coach Today"
        subtitle="Your sessions, training log, attendance and coaching actions for today."
        right={
          canAccessScheduleOperations(user.role)
            ? <Button asChild href="/schedule/operations" variant="outline">Full operations</Button>
            : <Button asChild href="/schedule" variant="outline">Open schedule</Button>
        }
      />

      <Section className="space-y-5">
        <Surface className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{roleLabel(user.role)}</Badge>
                {coachingRole ? (
                  <Badge className="bg-[hsl(var(--bg))] text-[hsl(var(--muted))]">Today first</Badge>
                ) : null}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                {upcomingSessions.length
                  ? upcomingSessions[0].session_date === today
                    ? 'Your coaching day is ready'
                    : 'Next coaching sessions'
                  : coachingRole
                    ? 'No assigned session in the next 7 days'
                    : 'Coach workspace preview'}
              </h2>
              <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                Start with the session, then complete the training log and check staff attendance.
              </p>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-md">
              <Link
                href="/notifications"
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 transition hover:bg-white"
              >
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <Bell size={15} />
                  Staff updates
                </div>
                <div className="mt-2 text-lg font-semibold tracking-tight">
                  {unreadCount > 0 ? `${unreadCount} unread` : 'Up to date'}
                </div>
              </Link>

              <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                    <ShieldCheck size={15} />
                    Staff QR
                  </div>
                  <div className="mt-2 text-lg font-semibold tracking-tight">{qrCode ? 'Ready' : 'Not available'}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{qrCode ? 'Tap to show QR' : 'Open profile to check your account'}</div>
                </summary>
                <div className="mt-4 flex flex-col items-center gap-3 border-t border-[hsl(var(--border))] pt-4">
                  {qrCode ? <QrImage value={qrCode} size={145} /> : null}
                  <Button asChild href="/profile" size="sm" variant="outline">
                    <span><IdCard size={15} /> Open profile</span>
                  </Button>
                </div>
              </details>
            </div>
          </div>
        </Surface>

        {coachingRole ? (
          <Surface className="p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Sessions</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  {user.role === 'head_coach'
                    ? 'Upcoming academy coaching sessions for the next 7 days.'
                    : 'Your assigned sessions for the next 7 days.'}
                </p>
              </div>
              <Button asChild href="/schedule/sessions" size="sm" variant="outline">Open all sessions</Button>
            </div>

            {upcomingSessions.length ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {upcomingSessions.map((session) => (
                  <Link
                    key={session.id}
                    href="/schedule/sessions"
                    className="group rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 transition hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                          {formatSessionDate(session.session_date, today)} · {formatTime(session.start_time)}
                          {session.end_time ? `–${formatTime(session.end_time)}` : ''}
                        </div>
                        <div className="mt-1 font-semibold tracking-tight">{session.name_snapshot}</div>
                        <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                          {session.level_snapshot || 'All levels'}
                          {session.mat_snapshot ? ` · ${session.mat_snapshot}` : ''}
                        </div>
                      </div>
                      <ArrowRight size={17} className="mt-1 shrink-0 transition group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center text-sm text-[hsl(var(--muted))]">
                No coaching session is showing for this role in the next 7 days.
              </div>
            )}
          </Surface>
        ) : null}

        {primaryActions.length ? (
          <Surface className="p-5 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Do next</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">The coaching actions used around today’s sessions.</p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {primaryActions.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tracking-tight">{item.label}</div>
                      <p className="mt-1 text-sm text-[hsl(var(--muted))]">{item.desc}</p>
                    </div>
                    <item.icon size={18} className="mt-0.5 shrink-0 text-black" />
                  </div>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium">
                    Open
                    <ArrowRight size={15} />
                  </div>
                </Link>
              ))}
            </div>
          </Surface>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Surface className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">More coaching tools</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {moreActions.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 transition hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{item.label}</div>
                      <div className="mt-1 text-sm text-[hsl(var(--muted))]">{item.desc}</div>
                    </div>
                    <item.icon size={17} className="mt-0.5 shrink-0" />
                  </div>
                </Link>
              ))}
              {!moreActions.length ? (
                <Link href="/schedule" className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                  <div className="text-sm font-semibold">Schedule</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">Open the member schedule view.</div>
                </Link>
              ) : null}
            </div>
          </Surface>

          <HomeNotificationsTile
            href="/notifications"
            label="Staff updates"
            desc="Open the full staff inbox."
            initialCount={unreadCount}
          />
        </div>

        {(user.role === 'coach' || user.role === 'head_coach') ? (
          <HomeMemberLookup
            title="Quick member lookup"
            subtitle="Read-only. Search by name or member ID when you need help on the mat."
            canOpenProfile
            showSensitiveFields={false}
          />
        ) : null}
      </Section>
    </main>
  )
}
