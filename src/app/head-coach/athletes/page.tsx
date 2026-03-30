import type { ReactNode } from 'react'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { Table } from '@/components/ui/Table'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser, type Role } from '@/lib/session'
import { canAccessHeadCoachAthletes, roleLabel } from '@/lib/rbac'
import {
  ATHLETE_PROGRAM_OPTIONS,
  ATHLETE_SCOPE_ROLES,
  ATHLETE_SPECIALTY_OPTIONS,
  ageLabel,
  athleteAgeGroup,
  attendanceBand,
  beltLabel,
  kimonoEligibility,
  programLabel,
  promotionRadar,
  specialtyLabel,
  type AthleteProgramLevel,
  type AthletePromotionStatus,
  type AthleteSpecialty,
} from '@/lib/athleteProgress'
import { addDays, cairoToday } from '@/lib/cairoDate'

type SearchParams = Record<string, string | string[] | undefined>

type RosterRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  role: Role | null
  date_of_birth: string | null
  created_at: string | null
  program_level: AthleteProgramLevel | null
  stripes: number | null
  specialty: AthleteSpecialty | null
  reference_coach_user_id: string | null
  athlete_notes: string | null
  athlete_profile_updated_at: string | null
  current_belt_code: string | null
  last_promoted_at: string | null
  competition_count: number | null
  podium_count: number | null
  latest_competition_name: string | null
  latest_competition_date: string | null
  latest_result: string | null
}

type AttendanceRow = {
  member_id: string
  date: string
  valid: boolean | null
  status: string | null
}

type CoachRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}

type EnrichedAthlete = RosterRow & {
  name: string
  age: number | null
  age_group: 'kids' | 'adults' | 'unknown'
  attendance_30d: number
  attendance_90d: number
  attendance_180d: number
  last_attended_at: string | null
  reference_coach_name: string | null
  kimono_eligible: boolean
  kimono_label: string
  kimono_hint: string
  promotion_status: AthletePromotionStatus
  promotion_label: string
  promotion_hint: string
  attendance_band_key: 'high' | 'steady' | 'low'
  attendance_band_label: string
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (Number.isNaN(dt.getTime())) return dateStr
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(dt)
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

function fullName(row: Pick<RosterRow, 'first_name' | 'last_name' | 'email'>) {
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.email || 'Unnamed athlete'
}

function readParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function lowerText(value?: string | null) {
  return String(value ?? '').trim().toLowerCase()
}

function promotionTone(status: AthletePromotionStatus) {
  switch (status) {
    case 'due':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    case 'eligible_review':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'blocked':
      return 'border-slate-200 bg-slate-100 text-slate-700'
    case 'not_ready':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
  }
}

function attendanceTone(key: EnrichedAthlete['attendance_band_key']) {
  switch (key) {
    case 'high':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'steady':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    default:
      return 'border-rose-200 bg-rose-50 text-rose-700'
  }
}

function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
}

function buildHref(base: URLSearchParams, updates: Record<string, string | null | undefined>) {
  const next = new URLSearchParams(base)
  for (const [key, value] of Object.entries(updates)) {
    if (!value) next.delete(key)
    else next.set(key, value)
  }
  const qs = next.toString()
  return qs ? `/head-coach/athletes?${qs}` : '/head-coach/athletes'
}

export default async function HeadCoachAthletesPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUser()
  if (!me) {
    return <Forbidden pageTitle="Head Coach · Athletes" subtitle="Sign in required." nextPath="/head-coach/athletes" message="Please sign in first." showBackHome={false} />
  }

  if (!canAccessHeadCoachAthletes(me.role)) {
    return (
      <Forbidden
        pageTitle="Head Coach · Athletes"
        subtitle="Athlete dashboard access is restricted."
        signedInAs={me.email}
        nextPath="/head-coach/athletes"
        allowed="head_coach, super_admin"
        message="Only Head Coach and Super Admin can open the athlete dashboard."
        actions={[{ href: '/training-useful', label: 'Training Useful' }]}
      />
    )
  }

  const q = readParam(searchParams ?? {}, 'q').trim()
  const roleFilter = readParam(searchParams ?? {}, 'role').trim()
  const programFilter = readParam(searchParams ?? {}, 'program').trim()
  const specialtyFilter = readParam(searchParams ?? {}, 'specialty').trim()
  const promotionFilter = readParam(searchParams ?? {}, 'promotion').trim()
  const attendanceFilter = readParam(searchParams ?? {}, 'attendance').trim()
  const focus = readParam(searchParams ?? {}, 'focus').trim()

  const admin = createSupabaseAdminClient()
  const { data: rosterData, error: rosterError } = await admin
    .from('head_coach_athlete_roster')
    .select('*')
    .returns<RosterRow[]>()

  const roster = rosterData ?? []
  const athleteIds = roster.map((row) => row.user_id)
  const attendanceFrom = addDays(cairoToday(), -179)

  const [attendanceRes, coachRes] = await Promise.all([
    athleteIds.length
      ? admin
          .from('attendance')
          .select('member_id, date, valid, status')
          .in('member_id', athleteIds)
          .gte('date', attendanceFrom)
          .returns<AttendanceRow[]>()
      : Promise.resolve({ data: [] as AttendanceRow[] }),
    admin
      .from('profiles')
      .select('user_id, first_name, last_name')
      .in('role', ['coach', 'assistant_coach', 'head_coach'])
      .returns<CoachRow[]>(),
  ])

  const attendanceRows = (attendanceRes as { data?: AttendanceRow[] } | null)?.data ?? []
  const coachRows = coachRes.data ?? []
  const coachMap = new Map(coachRows.map((row) => [row.user_id, `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unnamed coach']))

  const today = cairoToday()
  const cutoff30 = addDays(today, -29)
  const cutoff90 = addDays(today, -89)
  const cutoff180 = addDays(today, -179)

  const attendanceMap = new Map<string, { attendance_30d: number; attendance_90d: number; attendance_180d: number; last_attended_at: string | null }>()
  for (const row of attendanceRows) {
    const ok = row.valid === true || lowerText(row.status) === 'ok'
    if (!ok) continue
    const entry = attendanceMap.get(row.member_id) ?? { attendance_30d: 0, attendance_90d: 0, attendance_180d: 0, last_attended_at: null }
    if (row.date >= cutoff180) entry.attendance_180d += 1
    if (row.date >= cutoff90) entry.attendance_90d += 1
    if (row.date >= cutoff30) entry.attendance_30d += 1
    if (!entry.last_attended_at || row.date > entry.last_attended_at) entry.last_attended_at = row.date
    attendanceMap.set(row.member_id, entry)
  }

  const enriched: EnrichedAthlete[] = roster
    .map((row) => {
      const age = ageYears(row.date_of_birth)
      const attendance = attendanceMap.get(row.user_id) ?? { attendance_30d: 0, attendance_90d: 0, attendance_180d: 0, last_attended_at: null }
      const band = attendanceBand(attendance.attendance_90d)
      const kimono = kimonoEligibility({ age, specialty: row.specialty ?? null })
      const radar = promotionRadar({
        program: row.program_level ?? null,
        age,
        specialty: row.specialty ?? null,
        currentBelt: row.current_belt_code ?? null,
        stripes: row.stripes ?? 0,
        baselineDate: row.last_promoted_at ?? row.created_at ?? null,
        attendance90d: attendance.attendance_90d,
        competitionCount: row.competition_count ?? 0,
        today,
      })

      return {
        ...row,
        name: fullName(row),
        age,
        age_group: athleteAgeGroup(age),
        attendance_30d: attendance.attendance_30d,
        attendance_90d: attendance.attendance_90d,
        attendance_180d: attendance.attendance_180d,
        last_attended_at: attendance.last_attended_at,
        reference_coach_name: row.reference_coach_user_id ? coachMap.get(row.reference_coach_user_id) ?? null : null,
        kimono_eligible: kimono.eligible,
        kimono_label: kimono.label,
        kimono_hint: kimono.hint,
        promotion_status: radar.status,
        promotion_label: radar.label,
        promotion_hint: radar.hint,
        attendance_band_key: band.key,
        attendance_band_label: band.label,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const filtered = enriched.filter((row) => {
    if (roleFilter && row.role !== roleFilter) return false
    if (programFilter && row.program_level !== programFilter) return false
    if (specialtyFilter && row.specialty !== specialtyFilter) return false
    if (promotionFilter && row.promotion_status !== promotionFilter) return false
    if (attendanceFilter && row.attendance_band_key !== attendanceFilter) return false
    if (q) {
      const haystack = [row.name, row.member_id, row.role, row.program_level, row.current_belt_code, row.reference_coach_name]
        .map((value) => lowerText(value))
        .join(' ')
      if (!haystack.includes(lowerText(q))) return false
    }
    return true
  })

  const focusAthlete = filtered.find((row) => row.user_id === focus) ?? filtered[0] ?? null
  const missingTrainingCount = filtered.filter((row) => !row.program_level).length
  const dueCount = filtered.filter((row) => row.promotion_status === 'due').length
  const reviewCount = filtered.filter((row) => row.promotion_status === 'eligible_review').length
  const blockedCount = filtered.filter((row) => row.promotion_status === 'blocked').length
  const lowAttendanceCount = filtered.filter((row) => row.attendance_band_key === 'low').length
  const competitorCount = filtered.filter((row) => row.program_level === 'competitor').length

  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  if (roleFilter) baseParams.set('role', roleFilter)
  if (programFilter) baseParams.set('program', programFilter)
  if (specialtyFilter) baseParams.set('specialty', specialtyFilter)
  if (promotionFilter) baseParams.set('promotion', promotionFilter)
  if (attendanceFilter) baseParams.set('attendance', attendanceFilter)
  if (focus) baseParams.set('focus', focus)

  const tableRows = filtered.map((row) => ({
    id: row.user_id,
    athlete: (
      <div className="min-w-0">
        <div className="font-medium text-black">{row.name}</div>
        <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">{row.member_id ?? 'No member ID'} · {ageLabel(row.age)}</div>
      </div>
    ),
    role: <Badge className="border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]">{roleLabel(row.role)}</Badge>,
    program: (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black">{programLabel(row.program_level)}</Badge>
        <Badge className="border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]">{row.stripes ?? 0} stripe(s)</Badge>
      </div>
    ),
    belt: (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black">{beltLabel(row.current_belt_code)}</Badge>
        <Badge className={`border ${row.kimono_eligible ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>{row.kimono_label}</Badge>
      </div>
    ),
    specialty: <span className="text-sm">{specialtyLabel(row.specialty)}</span>,
    attendance: (
      <div className="space-y-1 text-sm">
        <div className="font-medium text-black">30d {row.attendance_30d} · 90d {row.attendance_90d}</div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[hsl(var(--muted))]">
          <Badge className={`border ${attendanceTone(row.attendance_band_key)}`}>{row.attendance_band_label}</Badge>
          <span>Last {fmtDate(row.last_attended_at)}</span>
        </div>
      </div>
    ),
    competition: (
      <div className="space-y-1 text-sm">
        <div className="font-medium text-black">{row.competition_count ?? 0} result(s) · {row.podium_count ?? 0} podium(s)</div>
        <div className="text-[11px] text-[hsl(var(--muted))]">{row.latest_competition_name ? `${row.latest_competition_name} · ${fmtDate(row.latest_competition_date)}` : 'No competition record'}</div>
      </div>
    ),
    promotion: (
      <div className="space-y-1 text-sm">
        <Badge className={`border ${promotionTone(row.promotion_status)}`}>{row.promotion_label}</Badge>
        <div className="max-w-[260px] whitespace-normal text-[11px] text-[hsl(var(--muted))]">{row.promotion_hint}</div>
      </div>
    ),
    actions: (
      <div className="flex flex-wrap gap-2">
        <Button asChild href={buildHref(baseParams, { focus: row.user_id })} variant="outline" size="sm">
          <span>Focus</span>
        </Button>
        <Button asChild href={`/members/${row.user_id}`} variant="outline" size="sm">
          <span>Profile</span>
        </Button>
      </div>
    ),
  }))

  return (
    <main>
      <PageHeader
        title="Head Coach · Athletes"
        subtitle="Program, belt, attendance, competition, and promotion signals in one fast dashboard."
        right={(
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" href="/training-useful"><span>Training Useful</span></Button>
            <Button asChild variant="outline" href="/"><span>Home</span></Button>
          </div>
        )}
      />

      <Section className="space-y-4">
        {rosterError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Failed to load athlete dashboard: {rosterError.message}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Athletes</div><div className="mt-2 text-2xl font-semibold tracking-tight">{filtered.length}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">Filtered roster</div></div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Promotion due</div><div className="mt-2 text-2xl font-semibold tracking-tight">{dueCount}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">Immediate review queue</div></div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Review soon</div><div className="mt-2 text-2xl font-semibold tracking-tight">{reviewCount}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">Eligible review hints</div></div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Blocked</div><div className="mt-2 text-2xl font-semibold tracking-tight">{blockedCount}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">Missing Gi eligibility</div></div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Low attendance</div><div className="mt-2 text-2xl font-semibold tracking-tight">{lowAttendanceCount}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">90-day low volume</div></div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Competitors</div><div className="mt-2 text-2xl font-semibold tracking-tight">{competitorCount}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">Current competitor program</div></div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <form className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))]" method="get">
            <Input name="q" defaultValue={q} placeholder="Search athlete, member ID, coach..." />
            <Select name="role" defaultValue={roleFilter || ''}>
              <option value="">All roles</option>
              {ATHLETE_SCOPE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </Select>
            <Select name="program" defaultValue={programFilter || ''}>
              <option value="">All programs</option>
              {ATHLETE_PROGRAM_OPTIONS.map((option) => <option key={option} value={option}>{programLabel(option)}</option>)}
            </Select>
            <Select name="specialty" defaultValue={specialtyFilter || ''}>
              <option value="">All specialties</option>
              {ATHLETE_SPECIALTY_OPTIONS.map((option) => <option key={option} value={option}>{specialtyLabel(option)}</option>)}
            </Select>
            <Select name="promotion" defaultValue={promotionFilter || ''}>
              <option value="">All promotion states</option>
              <option value="due">Due</option>
              <option value="eligible_review">Eligible review</option>
              <option value="blocked">Blocked</option>
              <option value="not_ready">On track</option>
              <option value="unknown">Unknown</option>
            </Select>
            <Select name="attendance" defaultValue={attendanceFilter || ''}>
              <option value="">All attendance bands</option>
              <option value="high">High</option>
              <option value="steady">Steady</option>
              <option value="low">Low</option>
            </Select>
            <div className="flex flex-wrap gap-2 lg:col-span-6">
              <Button type="submit" variant="outline"><span>Apply filters</span></Button>
              <Button asChild variant="ghost" href="/head-coach/athletes"><span>Reset</span></Button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))] shadow-soft">
          <div className="font-medium text-black">Foundation notes</div>
          <div className="mt-1">
            Missing athlete setup: <span className="font-medium text-black">{missingTrainingCount}</span> · Promotion timing currently uses the latest recorded belt promotion date, or the profile creation date when no belt history exists.
          </div>
        </div>

        <Table
          columns={[
            { key: 'athlete', header: 'Athlete', thClassName: 'min-w-[200px]' },
            { key: 'role', header: 'Role', thClassName: 'w-28', tdClassName: 'whitespace-normal' },
            { key: 'program', header: 'Program', thClassName: 'min-w-[160px]', tdClassName: 'whitespace-normal' },
            { key: 'belt', header: 'Belt / Gi', thClassName: 'min-w-[160px]', tdClassName: 'whitespace-normal' },
            { key: 'specialty', header: 'Specialty', hideOnMobile: true },
            { key: 'attendance', header: 'Attendance', thClassName: 'min-w-[170px]', tdClassName: 'whitespace-normal' },
            { key: 'competition', header: 'Competition', hideOnMobile: true, thClassName: 'min-w-[170px]', tdClassName: 'whitespace-normal' },
            { key: 'promotion', header: 'Promotion radar', thClassName: 'min-w-[220px]', tdClassName: 'whitespace-normal' },
            { key: 'actions', header: 'Actions', thClassName: 'w-36', tdClassName: 'whitespace-normal' },
          ]}
          rows={tableRows as any[]}
          keyField="id"
          stickyTopClassName="top-0"
        />

        {focusAthlete ? (
          <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black">{roleLabel(focusAthlete.role)}</Badge>
                  <Badge className="border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]">{ageLabel(focusAthlete.age)}</Badge>
                  <Badge className={`border ${promotionTone(focusAthlete.promotion_status)}`}>{focusAthlete.promotion_label}</Badge>
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-tight">{focusAthlete.name}</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">{focusAthlete.member_id ?? 'No member ID'} · {programLabel(focusAthlete.program_level)} · {beltLabel(focusAthlete.current_belt_code)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" href={`/members/${focusAthlete.user_id}`}><span>Open member file</span></Button>
                <Button asChild variant="outline" href={buildHref(baseParams, { focus: null })}><span>Clear focus</span></Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Training profile</div>
                <div className="mt-2 text-lg font-semibold tracking-tight">{programLabel(focusAthlete.program_level)}</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">{specialtyLabel(focusAthlete.specialty)} · {focusAthlete.stripes ?? 0} stripe(s)</div>
                <div className="mt-2 text-xs text-[hsl(var(--muted))]">Reference coach: {focusAthlete.reference_coach_name ?? 'Not set'}</div>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Attendance</div>
                <div className="mt-2 text-lg font-semibold tracking-tight">30d {focusAthlete.attendance_30d} · 90d {focusAthlete.attendance_90d}</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">180d {focusAthlete.attendance_180d} · Last {fmtDate(focusAthlete.last_attended_at)}</div>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Competition</div>
                <div className="mt-2 text-lg font-semibold tracking-tight">{focusAthlete.competition_count ?? 0} result(s)</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">{focusAthlete.latest_competition_name ? `${focusAthlete.latest_competition_name} · ${fmtDate(focusAthlete.latest_competition_date)}` : 'No competition result yet.'}</div>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Promotion radar</div>
                <div className="mt-2 text-lg font-semibold tracking-tight">{focusAthlete.promotion_label}</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">{focusAthlete.promotion_hint}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-sm font-semibold tracking-tight">Coach notes</div>
                <p className="mt-2 text-sm text-[hsl(var(--muted))]">{focusAthlete.athlete_notes?.trim() || 'No athlete note saved yet.'}</p>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-sm font-semibold tracking-tight">Current data basis</div>
                <ul className="mt-2 space-y-1 text-sm text-[hsl(var(--muted))]">
                  <li>Kimono rule: {focusAthlete.kimono_hint}</li>
                  <li>Timing basis: {fmtDate(focusAthlete.last_promoted_at ?? focusAthlete.created_at)}</li>
                  <li>Profile updated: {fmtDate(focusAthlete.athlete_profile_updated_at)}</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
