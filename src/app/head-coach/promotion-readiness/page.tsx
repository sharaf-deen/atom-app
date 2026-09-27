import type { ReactNode } from 'react'
import Link from 'next/link'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/PageHeader'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  BELT_PROMOTION_TARGET_ROLES,
  fullName,
  normalizeStripes,
  type BeltPromotionRosterRow,
} from '@/lib/beltPromotionEvents'
import {
  ageGroupFromDate,
  attendanceBand,
  fmtDate,
  nextBeltForAgeGroup,
  promotionRadar,
  reviewQueueState,
  titleCase,
  type PromotionRadar,
  type ReviewQueueState,
} from '@/lib/headCoachAthletes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SearchParams = Record<string, string | string[] | undefined>

type ReadinessFilters = {
  focus: 'review_now' | 'upcoming' | 'blocked' | 'deferred' | 'all'
  q: string
  audience: string
  program: string
  belt: string
  attendance: string
  signal: string
  sort: 'priority' | 'due' | 'attendance' | 'name'
  page: string
}

type ReadinessRosterRow = BeltPromotionRosterRow & {
  attendance_30d: number | null
  attendance_180d: number | null
  last_attended_at: string | null
  competition_count: number | null
  podium_count: number | null
  latest_competition_date: string | null
  latest_competition_name: string | null
  latest_result: string | null
}

type ReviewActionRow = {
  member_user_id: string
  review_lane: string
  recommendation_status: string
  action_status: 'pending' | 'reviewed' | 'deferred' | 'approved' | 'hold'
  action_date: string
  snoozed_until: string | null
  notes: string | null
  created_at: string | null
}

type ReadinessRow = ReadinessRosterRow & {
  name: string
  age_group: 'kids' | 'adults' | 'unknown'
  effective_belt: string | null
  implicit_white: boolean
  radar: PromotionRadar
  queue: ReviewQueueState
  latest_review: ReviewActionRow | null
  attendance_band: ReturnType<typeof attendanceBand>
  suggestion_label: string
  priority_score: number
  days_to_due: number | null
  upcoming_90d: boolean
}

const PAGE_SIZE = 24

function pick(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function parsePage(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.trunc(parsed)
}

function buildHref(
  filters: Partial<ReadinessFilters>,
  updates: Partial<Record<keyof ReadinessFilters, string | number | null | undefined>> = {},
) {
  const values = { ...filters, ...updates }
  const qs = new URLSearchParams()

  for (const [key, raw] of Object.entries(values)) {
    if (raw === null || raw === undefined) continue
    const value = String(raw).trim()
    if (!value) continue
    if (key === 'focus' && value === 'review_now') continue
    if (key === 'sort' && value === 'priority') continue
    if (key === 'page' && value === '1') continue
    qs.set(key, value)
  }

  const query = qs.toString()
  return query ? `/head-coach/promotion-readiness?${query}` : '/head-coach/promotion-readiness'
}

function effectiveBelt(row: ReadinessRosterRow) {
  const explicit = String(row.current_belt ?? '').trim().toLowerCase()
  if (explicit) return explicit
  return normalizeStripes(row.stripes) > 0 ? 'white' : null
}

function daysUntil(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const due = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(due)) return null
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((due - todayUtc) / 86400000)
}

function suggestionLabel(row: ReadinessRosterRow, belt: string | null, radar: PromotionRadar) {
  const stripes = normalizeStripes(row.stripes)

  if (radar.status === 'blocked') return 'Resolve blocker before promotion review'

  if (row.program_level === 'beginner' && radar.status === 'due') {
    return stripes < 2 ? 'Review White Belt · 2 stripes' : 'Review move to Intermediate'
  }

  if (row.program_level === 'intermediate' && radar.status === 'due') {
    if (stripes >= 4) {
      const nextBelt = nextBeltForAgeGroup(belt, ageGroupFromDate(row.date_of_birth))
      return nextBelt ? `Review ${titleCase(nextBelt)} Belt` : 'Review next belt'
    }
    return `Review Stripe ${Math.min(4, stripes + 1)}`
  }

  if (radar.status === 'review') return 'Head Coach review required'
  if (radar.dueDate) return `Next checkpoint ${fmtDate(radar.dueDate)}`
  return 'Continue monitoring'
}

function priorityScore(row: {
  radar: PromotionRadar
  queue: ReviewQueueState
  attendance90d: number
  daysToDue: number | null
  hasReferenceCoach: boolean
}) {
  let score = 0

  if (row.queue.key === 'action_now') score += 300
  else if (row.queue.key === 'deferred') score += 80
  else if (row.queue.key === 'logged') score += 30

  if (row.radar.status === 'due') score += 160
  else if (row.radar.status === 'review') score += 110
  else if (row.radar.status === 'blocked') score += 60

  if (row.daysToDue !== null && row.daysToDue >= 0 && row.daysToDue <= 90) {
    score += 90 - row.daysToDue
  }

  score += Math.min(40, Math.max(0, row.attendance90d))
  if (row.hasReferenceCoach) score += 10

  return score
}

function toneClass(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-black/10 bg-white text-[hsl(var(--muted))]'
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(tone)}`}>
      {children}
    </span>
  )
}

function signalTone(status: PromotionRadar['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'due') return 'success'
  if (status === 'review') return 'warning'
  if (status === 'blocked') return 'danger'
  return 'neutral'
}

function queueTone(key: ReviewQueueState['key']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (key === 'action_now') return 'warning'
  if (key === 'logged') return 'success'
  if (key === 'deferred') return 'neutral'
  return 'neutral'
}

function focusMatches(row: ReadinessRow, focus: ReadinessFilters['focus']) {
  if (focus === 'all') return true
  if (focus === 'review_now') {
    return row.queue.key === 'action_now' && (row.radar.status === 'due' || row.radar.status === 'review')
  }
  if (focus === 'upcoming') return row.upcoming_90d
  if (focus === 'blocked') return row.radar.status === 'blocked' || row.radar.lane === 'profile_incomplete'
  if (focus === 'deferred') return row.queue.key === 'deferred'
  return true
}

function rowMatches(row: ReadinessRow, filters: ReadinessFilters) {
  if (!focusMatches(row, filters.focus)) return false

  const query = filters.q.trim().toLowerCase()
  if (query) {
    const haystack = [
      row.name,
      row.member_id ?? '',
      row.email ?? '',
      row.reference_coach_name ?? '',
    ]
      .join(' ')
      .toLowerCase()

    if (!query.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term))) return false
  }

  if (filters.audience && row.age_group !== filters.audience) return false
  if (filters.program && (row.program_level ?? '') !== filters.program) return false
  if (filters.belt) {
    if (filters.belt === 'none') {
      if (row.effective_belt) return false
    } else if ((row.effective_belt ?? '') !== filters.belt) {
      return false
    }
  }
  if (filters.attendance && row.attendance_band.key !== filters.attendance) return false
  if (filters.signal && row.radar.status !== filters.signal) return false

  return true
}

function sortRows(rows: ReadinessRow[], sort: ReadinessFilters['sort']) {
  return [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)

    if (sort === 'attendance') {
      const diff = Number(b.attendance_90d ?? 0) - Number(a.attendance_90d ?? 0)
      return diff || a.name.localeCompare(b.name)
    }

    if (sort === 'due') {
      const aDays = a.days_to_due ?? 99999
      const bDays = b.days_to_due ?? 99999
      return aDays - bDays || b.priority_score - a.priority_score || a.name.localeCompare(b.name)
    }

    return b.priority_score - a.priority_score || a.name.localeCompare(b.name)
  })
}

function dueText(row: ReadinessRow) {
  if (!row.radar.dueDate) return 'Coach-led review'
  if (row.days_to_due === null) return fmtDate(row.radar.dueDate)
  if (row.days_to_due < 0) return `${fmtDate(row.radar.dueDate)} · ${Math.abs(row.days_to_due)}d overdue`
  if (row.days_to_due === 0) return `${fmtDate(row.radar.dueDate)} · today`
  return `${fmtDate(row.radar.dueDate)} · in ${row.days_to_due}d`
}

export default async function PromotionReadinessPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const me = await getSessionUserCached()
  const signedInAs = me?.full_name || me?.email || null

  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    return (
      <AccessDeniedPage
        title="Promotion Readiness"
        subtitle="Access restricted."
        signedInAs={signedInAs}
        message="Only the Head Coach and Super Admin can review promotion readiness."
        allowed="Allowed roles: Head Coach, Super Admin"
        nextPath="/head-coach/promotion-readiness"
      />
    )
  }

  const rawFocus = pick(searchParams?.focus)
  const rawSort = pick(searchParams?.sort)
  const filters: ReadinessFilters = {
    focus: ['review_now', 'upcoming', 'blocked', 'deferred', 'all'].includes(rawFocus)
      ? (rawFocus as ReadinessFilters['focus'])
      : 'review_now',
    q: pick(searchParams?.q),
    audience: pick(searchParams?.audience),
    program: pick(searchParams?.program),
    belt: pick(searchParams?.belt),
    attendance: pick(searchParams?.attendance),
    signal: pick(searchParams?.signal),
    sort: ['priority', 'due', 'attendance', 'name'].includes(rawSort)
      ? (rawSort as ReadinessFilters['sort'])
      : 'priority',
    page: pick(searchParams?.page) || '1',
  }

  const admin = getSupabaseAdminClientCached()
  const [rosterRes, reviewRes] = await Promise.all([
    admin
      .from('head_coach_athlete_roster')
      .select('*')
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true })
      .limit(5000)
      .returns<ReadinessRosterRow[]>(),
    admin
      .from('head_coach_latest_review_action')
      .select('member_user_id, review_lane, recommendation_status, action_status, action_date, snoozed_until, notes, created_at')
      .returns<ReviewActionRow[]>(),
  ])

  if (rosterRes.error) throw new Error(rosterRes.error.message)
  if (reviewRes.error) throw new Error(reviewRes.error.message)

  const latestReviewMap = new Map(
    (reviewRes.data ?? []).map((row) => [row.member_user_id, row]),
  )

  const roster = (rosterRes.data ?? [])
    .filter((row) => !!row.role && BELT_PROMOTION_TARGET_ROLES.includes(row.role))
    .map<ReadinessRow>((row) => {
      const belt = effectiveBelt(row)
      const ageGroup = ageGroupFromDate(row.date_of_birth)
      const radar = promotionRadar({
        program: row.program_level,
        currentBelt: belt,
        stripes: row.stripes,
        specialty: row.specialty,
        ageGroup,
        baselineDate: row.current_belt_promoted_at ?? row.profile_created_at,
        attendance90d: Number(row.attendance_90d ?? 0),
      })
      const latestReview = latestReviewMap.get(row.user_id) ?? null
      const queue = reviewQueueState({ promotion: radar, latestAction: latestReview })
      const daysToDue = daysUntil(radar.dueDate)
      const upcoming90d =
        radar.status === 'watch' &&
        daysToDue !== null &&
        daysToDue >= 0 &&
        daysToDue <= 90

      return {
        ...row,
        name: fullName(row.first_name, row.last_name, row.email),
        age_group: ageGroup,
        effective_belt: belt,
        implicit_white: !row.current_belt && belt === 'white',
        radar,
        queue,
        latest_review: latestReview,
        attendance_band: attendanceBand(Number(row.attendance_90d ?? 0)),
        suggestion_label: suggestionLabel(row, belt, radar),
        days_to_due: daysToDue,
        upcoming_90d: upcoming90d,
        priority_score: priorityScore({
          radar,
          queue,
          attendance90d: Number(row.attendance_90d ?? 0),
          daysToDue,
          hasReferenceCoach: Boolean(row.reference_coach_user_id),
        }),
      }
    })

  const reviewNowCount = roster.filter(
    (row) => row.queue.key === 'action_now' && (row.radar.status === 'due' || row.radar.status === 'review'),
  ).length
  const upcomingCount = roster.filter((row) => row.upcoming_90d).length
  const blockedCount = roster.filter(
    (row) => row.radar.status === 'blocked' || row.radar.lane === 'profile_incomplete',
  ).length
  const deferredCount = roster.filter((row) => row.queue.key === 'deferred').length

  const filtered = sortRows(roster.filter((row) => rowMatches(row, filters)), filters.sort)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(parsePage(filters.page), totalPages)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const focusCards: Array<{
    key: ReadinessFilters['focus']
    label: string
    count: number
    help: string
    tone: 'neutral' | 'success' | 'warning' | 'danger'
  }> = [
    { key: 'review_now', label: 'Review now', count: reviewNowCount, help: 'Due or coach review', tone: 'success' },
    { key: 'upcoming', label: 'Next 90 days', count: upcomingCount, help: 'Upcoming checkpoints', tone: 'warning' },
    { key: 'blocked', label: 'Blocked / incomplete', count: blockedCount, help: 'Resolve before review', tone: 'danger' },
    { key: 'deferred', label: 'Deferred', count: deferredCount, help: 'Manual deferrals', tone: 'neutral' },
    { key: 'all', label: 'All athletes', count: roster.length, help: 'Full promotion roster', tone: 'neutral' },
  ]

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Promotion Readiness"
        subtitle="Decision-support dashboard for the next belt promotion review. Signals never replace Head Coach evaluation."
        right={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/head-coach/promotion-desk"
              className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white"
            >
              Promotion Desk
            </Link>
            <Link
              href="/head-coach/belt-promotions"
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
            >
              Full event workflow
            </Link>
          </div>
        }
      />

      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="font-semibold">Readiness signal, not automatic eligibility.</div>
        <p className="mt-1 text-xs leading-5 text-amber-900">
          Attendance, time in cycle, program, belt/stripes, coach setup and competition data are review signals only.
          Belt and stripe promotions still require Head Coach evaluation of technical progress, behavior, consistency and overall readiness.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {focusCards.map((card) => {
          const selected = filters.focus === card.key
          return (
            <Link
              key={card.key}
              href={buildHref(filters, { focus: card.key, page: 1 })}
              className={`rounded-3xl border p-4 shadow-soft transition ${
                selected ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white hover:bg-black/[0.025]'
              }`}
            >
              <div className={`text-xs font-medium uppercase tracking-wide ${selected ? 'text-white/70' : 'text-[hsl(var(--muted))]'}`}>
                {card.label}
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">{card.count}</div>
              <div className={`mt-1 text-xs ${selected ? 'text-white/70' : 'text-[hsl(var(--muted))]'}`}>{card.help}</div>
            </Link>
          )
        })}
      </section>

      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
          <input type="hidden" name="focus" value={filters.focus} />
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Name, Member ID, email, coach"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm xl:col-span-2"
          />
          <select name="audience" defaultValue={filters.audience} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
            <option value="">All ages</option>
            <option value="kids">Kids</option>
            <option value="adults">Adults</option>
            <option value="unknown">Age unknown</option>
          </select>
          <select name="program" defaultValue={filters.program} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
            <option value="">All programs</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="competitor">Competitor</option>
          </select>
          <select name="belt" defaultValue={filters.belt} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
            <option value="">All belts</option>
            <option value="white">White</option>
            <option value="grey">Grey</option>
            <option value="yellow">Yellow</option>
            <option value="orange">Orange</option>
            <option value="green">Green</option>
            <option value="blue">Blue</option>
            <option value="purple">Purple</option>
            <option value="brown">Brown</option>
            <option value="black">Black</option>
            <option value="none">No belt data</option>
          </select>
          <select name="attendance" defaultValue={filters.attendance} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
            <option value="">All attendance</option>
            <option value="high">High</option>
            <option value="steady">Steady</option>
            <option value="low">Low</option>
          </select>
          <select name="signal" defaultValue={filters.signal} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
            <option value="">All signals</option>
            <option value="due">Due</option>
            <option value="review">Review</option>
            <option value="watch">Watch</option>
            <option value="blocked">Blocked</option>
          </select>
          <select name="sort" defaultValue={filters.sort} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
            <option value="priority">Priority</option>
            <option value="due">Due date</option>
            <option value="attendance">Attendance 90d</option>
            <option value="name">Name</option>
          </select>
          <div className="flex gap-2 md:col-span-2 xl:col-span-8">
            <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">
              Apply filters
            </button>
            <Link href="/head-coach/promotion-readiness" className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold">
              Reset
            </Link>
            <span className="ml-auto self-center text-xs text-[hsl(var(--muted))]">
              {filtered.length} result{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {pageRows.length ? pageRows.map((row) => (
          <article key={row.user_id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">{row.name}</h2>
                  <Badge tone={signalTone(row.radar.status)}>{titleCase(row.radar.status)}</Badge>
                  <Badge tone={queueTone(row.queue.key)}>{row.queue.label}</Badge>
                </div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                  {row.member_id || 'No Member ID'} · {titleCase(row.age_group)} · {titleCase(row.program_level ?? 'program pending')}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-sm font-bold">
                  {row.effective_belt ? titleCase(row.effective_belt) : 'No belt data'} · {normalizeStripes(row.stripes)} stripe{normalizeStripes(row.stripes) === 1 ? '' : 's'}
                </div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                  {row.current_belt_promoted_at
                    ? `Since ${fmtDate(row.current_belt_promoted_at)}`
                    : row.implicit_white
                      ? 'Implicit White Belt baseline'
                      : 'No belt promotion date'}
                </div>
              </div>
            </div>

            <div className={`mt-4 rounded-2xl border p-4 ${toneClass(signalTone(row.radar.status))}`}>
              <div className="text-xs font-semibold uppercase tracking-wide">{row.suggestion_label}</div>
              <div className="mt-2 text-sm font-semibold">{row.radar.label}</div>
              <p className="mt-1 text-xs leading-5">{row.radar.reason}</p>
              <div className="mt-2 text-xs"><span className="font-semibold">Next action:</span> {row.radar.nextAction}</div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl bg-black/[0.025] p-3">
                <div className="text-[11px] text-[hsl(var(--muted))]">Attendance 30d</div>
                <div className="mt-1 text-lg font-bold">{Number(row.attendance_30d ?? 0)}</div>
              </div>
              <div className="rounded-2xl bg-black/[0.025] p-3">
                <div className="text-[11px] text-[hsl(var(--muted))]">Attendance 90d</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-lg font-bold">{Number(row.attendance_90d ?? 0)}</span>
                  <Badge tone={row.attendance_band.tone}>{row.attendance_band.label}</Badge>
                </div>
              </div>
              <div className="rounded-2xl bg-black/[0.025] p-3">
                <div className="text-[11px] text-[hsl(var(--muted))]">Attendance 180d</div>
                <div className="mt-1 text-lg font-bold">{Number(row.attendance_180d ?? 0)}</div>
              </div>
              <div className="rounded-2xl bg-black/[0.025] p-3">
                <div className="text-[11px] text-[hsl(var(--muted))]">Cycle checkpoint</div>
                <div className="mt-1 text-xs font-semibold leading-5">{dueText(row)}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-2xl border border-black/10 p-3">
                <div className="font-semibold">Coach evidence</div>
                <div className="mt-1 text-[hsl(var(--muted))]">
                  Reference coach: {row.reference_coach_name || 'Not assigned'}
                </div>
                <div className="mt-1 text-[hsl(var(--muted))]">
                  Coach note: {String(row.coach_note ?? '').trim() ? 'Available' : 'Missing'}
                </div>
              </div>
              <div className="rounded-2xl border border-black/10 p-3">
                <div className="font-semibold">Activity evidence</div>
                <div className="mt-1 text-[hsl(var(--muted))]">
                  Last attendance: {fmtDate(row.last_attended_at)}
                </div>
                <div className="mt-1 text-[hsl(var(--muted))]">
                  Competitions: {Number(row.competition_count ?? 0)} · Podiums: {Number(row.podium_count ?? 0)}
                </div>
              </div>
            </div>

            {row.latest_review ? (
              <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.015] p-3 text-xs">
                <span className="font-semibold">Latest manual review:</span>{' '}
                {titleCase(row.latest_review.action_status)} · {fmtDate(row.latest_review.action_date)}
                {row.latest_review.snoozed_until ? ` · deferred until ${fmtDate(row.latest_review.snoozed_until)}` : ''}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/members/${row.user_id}`}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
              >
                Open profile
              </Link>
              {row.radar.status !== 'blocked' ? (
                <Link
                  href={`/head-coach/promotion-desk?member=${encodeURIComponent(row.user_id)}&q=${encodeURIComponent(row.member_id || row.name)}`}
                  className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white"
                >
                  Open in Promotion Desk
                </Link>
              ) : null}
              <Link
                href="/head-coach/belt-promotions"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
              >
                Promotion events
              </Link>
            </div>
          </article>
        )) : (
          <div className="xl:col-span-2 rounded-3xl border border-dashed border-black/10 bg-white p-10 text-center">
            <div className="font-semibold">No athletes match these filters.</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">Change the focus or reset the filters.</div>
          </div>
        )}
      </section>

      {totalPages > 1 ? (
        <section className="flex items-center justify-between rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="text-sm text-[hsl(var(--muted))]">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-2">
            {currentPage > 1 ? (
              <Link
                href={buildHref(filters, { page: currentPage - 1 })}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold"
              >
                Previous
              </Link>
            ) : null}
            {currentPage < totalPages ? (
              <Link
                href={buildHref(filters, { page: currentPage + 1 })}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold"
              >
                Next
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  )
}
