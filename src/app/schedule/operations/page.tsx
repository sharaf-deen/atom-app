export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Eye,
  LayoutGrid,
  ScanLine,
} from 'lucide-react'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import {
  canAccessCoachMemberIncidents,
  canAccessCoachOversight,
  canAccessCoachStaffAttendance,
  canAccessCoachTrainingLogs,
  canAccessCoachTrainingPrograms,
  canAccessScheduleClassTemplates,
  canAccessScheduleOperations,
  canAccessScheduleTrainingSessions,
  canManageScheduleTrainingSessions,
  roleLabel,
} from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'

type HubCard = {
  title: string
  description: string
  href: string
  icon: LucideIcon
  badge?: string
}

type HubSection = {
  title: string
  description: string
  cards: HubCard[]
}

function OperationCard({ card }: { card: HubCard }) {
  const Icon = card.icon

  return (
    <Link
      href={card.href}
      className="group flex min-h-[148px] flex-col justify-between rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          {card.badge ? (
            <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] font-semibold text-black/70">
              {card.badge}
            </span>
          ) : null}
        </div>

        <div>
          <h3 className="text-base font-semibold tracking-tight text-black">{card.title}</h3>
          <p className="mt-1 text-sm leading-5 text-black/60">{card.description}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-black">
        Open
        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Link>
  )
}

export default async function ScheduleOperationsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/schedule/operations')

  if (!canAccessScheduleOperations(me.role)) {
    return (
      <AccessDeniedPage
        title="Schedule Operations"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This operations hub is available to the ATOM coaching team only."
        allowed="assistant_coach, coach, head_coach, super_admin"
        nextPath="/schedule/operations"
        actions={[{ href: '/schedule', label: 'Open Schedule' }]}
        showBackHome
      />
    )
  }

  const canManageSchedule = canManageScheduleTrainingSessions(me.role)
  const sections: HubSection[] = []

  const todayCards: HubCard[] = []

  if (canAccessScheduleTrainingSessions(me.role)) {
    todayCards.push({
      title: canManageSchedule ? 'Scheduled Sessions' : 'My Assigned Sessions',
      description: canManageSchedule
        ? 'Open upcoming sessions, assignments and class changes.'
        : 'Open the sessions where you are assigned to coach.',
      href: '/schedule/sessions',
      icon: CalendarDays,
      badge: canManageSchedule ? 'Manage' : 'My sessions',
    })
  }

  if (canAccessCoachTrainingLogs(me.role)) {
    todayCards.push({
      title: 'Training Logs',
      description: 'Record what was actually taught after class.',
      href: '/coach-operations/training-logs',
      icon: ClipboardCheck,
      badge: 'Actual',
    })
  }

  if (canAccessCoachStaffAttendance(me.role)) {
    todayCards.push({
      title: 'Staff Attendance',
      description: canManageSchedule
        ? 'Review staff QR attendance and session matching.'
        : 'Check your QR attendance and session match.',
      href: '/coach-operations/staff-attendance',
      icon: ScanLine,
      badge: 'QR',
    })
  }

  if (canAccessCoachMemberIncidents(me.role)) {
    todayCards.push({
      title: 'Member Incidents',
      description: 'Record a behaviour, safety, injury or training incident.',
      href: '/coach-operations/incidents',
      icon: AlertTriangle,
      badge: 'Report',
    })
  }

  if (todayCards.length) {
    sections.push({
      title: 'Run the day',
      description: 'Sessions, logs, attendance and incident reporting.',
      cards: todayCards,
    })
  }

  const planningCards: HubCard[] = []

  if (canAccessScheduleClassTemplates(me.role)) {
    planningCards.push({
      title: 'Class Templates',
      description: 'Maintain the recurring weekly class timetable.',
      href: '/schedule/templates',
      icon: LayoutGrid,
      badge: 'Recurring',
    })
  }

  if (canAccessCoachTrainingPrograms(me.role)) {
    planningCards.push({
      title: 'Training Programs',
      description: canManageSchedule
        ? 'Prepare and publish the technical plan for upcoming classes.'
        : 'Read the technical plan published by the Head Coach.',
      href: '/coach-operations/programs',
      icon: ClipboardList,
      badge: 'Planned',
    })
  }

  if (planningCards.length) {
    sections.push({
      title: 'Plan',
      description: canManageSchedule
        ? 'Prepare the timetable and technical plan before class.'
        : 'Review the technical plan for upcoming classes.',
      cards: planningCards,
    })
  }

  const reviewCards: HubCard[] = [
    {
      title: 'Member Schedule',
      description: 'See the schedule exactly as members see it.',
      href: '/schedule',
      icon: Eye,
      badge: 'Member view',
    },
  ]

  if (canAccessCoachOversight(me.role)) {
    reviewCards.push({
      title: 'Coach Oversight',
      description: 'Review session assignments, QR evidence and completed logs.',
      href: '/coach-operations/oversight',
      icon: Activity,
      badge: 'Oversight',
    })
  }

  sections.push({
    title: 'Review',
    description: 'Check the member view and coaching follow-through.',
    cards: reviewCards,
  })

  return (
    <main>
      <PageHeader
        title="Schedule Operations"
        subtitle="Sessions, logs, attendance, planning and review."
        right={
          <Link
            href="/training-useful"
            className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-semibold text-black shadow-soft transition hover:bg-[hsl(var(--surface-2))]"
          >
            Coach Today
          </Link>
        }
      />

      <Section className="max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 shadow-soft">
          <div className="text-sm text-black/60">
            Signed in as <strong className="text-black">{roleLabel(me.role)}</strong>
          </div>
          <Link
            href="/schedule"
            className="text-sm font-semibold text-black underline underline-offset-4"
          >
            Member schedule
          </Link>
        </div>

        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-black">{section.title}</h2>
              <p className="mt-1 text-sm text-black/60">{section.description}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {section.cards.map((card) => (
                <OperationCard key={`${section.title}-${card.title}`} card={card} />
              ))}
            </div>
          </section>
        ))}

      </Section>
    </main>
  )
}
