export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Eye,
  FileText,
  LayoutGrid,
  ScanLine,
  Settings2,
} from 'lucide-react'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import {
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
        ? 'Run dated classes, coach assignments, planned programs and one-off exceptions.'
        : 'See the dated sessions where you are assigned as Primary or Assistant Coach.',
      href: '/schedule/sessions',
      icon: CalendarDays,
      badge: canManageSchedule ? 'Manage' : 'My sessions',
    })
  }

  if (canAccessCoachTrainingLogs(me.role)) {
    todayCards.push({
      title: 'Training Logs',
      description: 'Record what was actually taught and link the log to the real dated session.',
      href: '/coach-operations/training-logs',
      icon: ClipboardCheck,
      badge: 'Actual',
    })
  }

  if (canAccessCoachStaffAttendance(me.role)) {
    todayCards.push({
      title: 'Staff Attendance',
      description: canManageSchedule
        ? 'Review coaching QR check-ins and their linked scheduled sessions.'
        : 'Review your own staff QR check-ins and matched scheduled sessions.',
      href: '/coach-operations/staff-attendance',
      icon: ScanLine,
      badge: 'QR',
    })
  }

  if (todayCards.length) {
    sections.push({
      title: 'Run the day',
      description: 'The operational tools used around real dated training sessions.',
      cards: todayCards,
    })
  }

  const planningCards: HubCard[] = []

  if (canAccessScheduleClassTemplates(me.role)) {
    planningCards.push({
      title: 'Class Templates',
      description: 'Maintain the recurring weekly timetable that generates dated sessions.',
      href: '/schedule/templates',
      icon: LayoutGrid,
      badge: 'Recurring',
    })
  }

  if (canAccessCoachTrainingPrograms(me.role)) {
    planningCards.push({
      title: 'Training Programs',
      description: canManageSchedule
        ? 'Prepare and publish the technical plan that can be assigned to dated sessions.'
        : 'Read the published technical program shared by the Head Coach.',
      href: '/coach-operations/programs',
      icon: ClipboardList,
      badge: 'Planned',
    })
  }

  if (planningCards.length) {
    sections.push({
      title: 'Plan',
      description: canManageSchedule
        ? 'Maintain the recurring timetable and the technical program before classes happen.'
        : 'Review the technical plan prepared for the coaching team.',
      cards: planningCards,
    })
  }

  const reviewCards: HubCard[] = [
    {
      title: 'Member Schedule',
      description: 'Open the same dated Schedule experience that members use.',
      href: '/schedule',
      icon: Eye,
      badge: 'Member view',
    },
  ]

  if (canAccessCoachOversight(me.role)) {
    reviewCards.push({
      title: 'Coach Oversight',
      description: 'Review factual session obligations, QR evidence, timing deltas and Training Logs.',
      href: '/coach-operations/oversight',
      icon: Activity,
      badge: 'Oversight',
    })
  }

  sections.push({
    title: 'Review',
    description: 'Check what members see and, when permitted, review factual coaching evidence.',
    cards: reviewCards,
  })

  return (
    <main>
      <PageHeader
        title="Schedule Operations"
        subtitle="One role-aware home for ATOM's structured Schedule and coaching-session workflow."
      />

      <Section className="max-w-6xl space-y-6">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-black">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                Your operations workspace
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-black/60">
                You are signed in as <strong className="text-black">{roleLabel(me.role)}</strong>. This page only shows the tools your role can access; the existing route-level permissions remain unchanged.
              </p>
            </div>

            <Link
              href="/schedule"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-soft transition hover:bg-[hsl(var(--surface-2))]"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Open member Schedule
            </Link>
          </div>
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

        {canManageSchedule ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
            <strong>Structured Schedule 2A–2H:</strong> Class Templates generate dated sessions; Scheduled Sessions centralize coach assignments, planned programs and exceptions; Staff Attendance links QR evidence; Training Logs capture actual teaching; Coach Oversight reviews the resulting factual history.
          </div>
        ) : (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
            Your workspace focuses on assigned sessions, published programs, actual Training Logs and your own Staff Attendance. Schedule-management and global oversight actions remain restricted to Head Coach / Super Admin.
          </div>
        )}
      </Section>
    </main>
  )
}
