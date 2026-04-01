import type { ReactNode } from 'react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/PageHeader'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import type { Role } from '@/lib/session'
import {
  PROGRAM_OPTIONS,
  SPECIALTY_OPTIONS,
  ageGroupFromDate,
  ageYears,
  attendanceBand,
  beltTrackForAgeGroup,
  fmtDate,
  fullName,
  isKimonoEligible,
  promotionRadar,
  titleCase,
  type AthleteAgeGroup,
  type AthleteSpecialty,
  type ProgramLevel,
} from '@/lib/headCoachAthletes'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

type DashboardFilters = {
  q: string
  role: string
  program: string
  belt: string
  specialty: string
  promotion: string
  attendance: string
  age_group: string
  kimono: string
  checklist: string
  sort: string
  focus: string
  page: string
}

type HeadCoachRosterRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  role: Role | null
  date_of_birth: string | null
  profile_created_at: string | null
  program_level: ProgramLevel | null
  stripes: number | null
  specialty: AthleteSpecialty | null
  coach_note: string | null
  reference_coach_user_id: string | null
  reference_coach_name: string | null
  attendance_30d: number | null
  attendance_90d: number | null
  attendance_180d: number | null
  last_attended_at: string | null
  current_belt: string | null
  current_belt_promoted_at: string | null
  competition_count: number | null
  podium_count: number | null
  latest_competition_date: string | null
  latest_competition_name: string | null
  latest_result: string | null
}

type CompetitionResult = 'gold' | 'silver' | 'bronze' | 'other'

type CompetitionRow = {
  id: string
  member_user_id: string
  competition_name: string
  competition_date: string
  division: string | null
  category: string | null
  result: CompetitionResult
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

type ProgressEventRow = {
  id: string
  member_user_id: string
  event_type: 'profile_update' | 'program_change' | 'stripe_award' | 'belt_promotion' | 'competition_result' | 'note'
  effective_date: string
  previous_program_level: string | null
  next_program_level: string | null
  previous_belt_code: string | null
  next_belt_code: string | null
  previous_stripes: number | null
  next_stripes: number | null
  notes: string | null
  created_at: string | null
}

type CoachOption = {
  user_id: string
  first_name: string | null
  last_name: string | null
  role: Role | null
}

type EnrichedAthlete = HeadCoachRosterRow & {
  name: string
  age: number | null
  age_group: AthleteAgeGroup
  attendance_band: ReturnType<typeof attendanceBand>
  kimono_eligible: boolean
  promotion: ReturnType<typeof promotionRadar>
  due_soon: boolean
  priority_score: number
  profile_checklist: {
    items: string[]
    label: string
  }
}

const TARGET_ROLES: Role[] = ['member', 'coach', 'assistant_coach', 'vip', 'champion']
const REFERENCE_COACH_ROLES: Role[] = ['assistant_coach', 'coach', 'head_coach']
const COMPETITION_RESULTS: CompetitionResult[] = ['gold', 'silver', 'bronze', 'other']
const ATHLETES_PER_PAGE = 10

function pick(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function buildAthletesHref(filters: Partial<DashboardFilters>, updates: Record<string, string | number | null | undefined> = {}) {
  const qs = new URLSearchParams()
  for (const [key, raw] of Object.entries({ ...filters, ...updates })) {
    if (raw === null || raw === undefined) continue
    const value = String(raw).trim()
    if (!value) continue
    qs.set(key, value)
  }
  const query = qs.toString()
  return query ? `/head-coach/athletes?${query}` : '/head-coach/athletes'
}

function parsePage(value?: string | null) {
  const parsed = Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.trunc(parsed)
}

function normalizeProgram(value?: string | null): ProgramLevel | null {
  if (!value) return null
  const lowered = value.trim().toLowerCase()
  return PROGRAM_OPTIONS.includes(lowered as ProgramLevel) ? (lowered as ProgramLevel) : null
}

function normalizeSpecialty(value?: string | null): AthleteSpecialty | null {
  if (!value) return null
  const lowered = value.trim().toLowerCase()
  return SPECIALTY_OPTIONS.includes(lowered as AthleteSpecialty) ? (lowered as AthleteSpecialty) : null
}

function normalizeCompetitionResult(value?: string | null): CompetitionResult | null {
  if (!value) return null
  const lowered = value.trim().toLowerCase()
  return COMPETITION_RESULTS.includes(lowered as CompetitionResult) ? (lowered as CompetitionResult) : null
}

function sanitizeNote(value: FormDataEntryValue | null) {
  return String(value ?? '').trim().slice(0, 2000) || null
}

function toStripes(value: FormDataEntryValue | null) {
  const raw = Number(String(value ?? '').trim())
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(4, Math.trunc(raw)))
}

async function requireHeadCoachAccess(nextPath: string) {
  const me = await getSessionUserCached()
  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) redirect(nextPath)
  return me
}

async function saveAthleteProfileAction(formData: FormData) {
  'use server'

  const nextPath = String(formData.get('nextPath') || '/head-coach/athletes')
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  const programLevel = normalizeProgram(String(formData.get('program_level') || ''))
  const specialty = normalizeSpecialty(String(formData.get('specialty') || ''))
  const stripes = toStripes(formData.get('stripes'))
  const referenceCoachUserIdRaw = String(formData.get('reference_coach_user_id') || '').trim()
  const referenceCoachUserId = referenceCoachUserIdRaw || null
  const coachNote = sanitizeNote(formData.get('notes'))

  if (!memberUserId) redirect(nextPath)
  const me = await requireHeadCoachAccess(nextPath)
  const admin = getSupabaseAdminClientCached()

  const existing = await admin
    .from('member_training_profiles')
    .select('member_user_id, program_level, stripes, specialty, reference_coach_user_id')
    .eq('member_user_id', memberUserId)
    .maybeSingle<{ member_user_id: string; program_level: string | null; stripes: number | null; specialty: string | null; reference_coach_user_id: string | null }>()

  if (existing.error) throw new Error(existing.error.message)

  const upsert = await admin
    .from('member_training_profiles')
    .upsert(
      {
        member_user_id: memberUserId,
        program_level: programLevel,
        stripes,
        specialty,
        reference_coach_user_id: referenceCoachUserId,
        notes: coachNote,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )

  if (upsert.error) throw new Error(upsert.error.message)

  const event = await admin.from('member_athlete_progress_events').insert({
    id: crypto.randomUUID(),
    member_user_id: memberUserId,
    event_type: 'profile_update',
    effective_date: new Date().toISOString().slice(0, 10),
    previous_program_level: existing.data?.program_level ?? null,
    next_program_level: programLevel,
    previous_stripes: existing.data?.stripes ?? null,
    next_stripes: stripes,
    notes: coachNote,
    created_by: me.id,
  })
  if (event.error) throw new Error(event.error.message)

  revalidatePath('/head-coach/athletes')
  revalidatePath('/members/[id]')
  redirect(nextPath)
}

async function moveProgramAction(formData: FormData) {
  'use server'

  const nextPath = String(formData.get('nextPath') || '/head-coach/athletes')
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  const nextProgram = normalizeProgram(String(formData.get('next_program_level') || ''))
  const effectiveDate = String(formData.get('effective_date') || '').trim() || new Date().toISOString().slice(0, 10)
  const notes = sanitizeNote(formData.get('notes'))
  if (!memberUserId || !nextProgram) redirect(nextPath)

  const me = await requireHeadCoachAccess(nextPath)
  const admin = getSupabaseAdminClientCached()
  const current = await admin
    .from('member_training_profiles')
    .select('program_level, stripes, specialty, reference_coach_user_id, notes')
    .eq('member_user_id', memberUserId)
    .maybeSingle<{ program_level: string | null; stripes: number | null; specialty: string | null; reference_coach_user_id: string | null; notes: string | null }>()

  if (current.error) throw new Error(current.error.message)

  const upsert = await admin
    .from('member_training_profiles')
    .upsert(
      {
        member_user_id: memberUserId,
        program_level: nextProgram,
        stripes: current.data?.stripes ?? 0,
        specialty: current.data?.specialty ?? null,
        reference_coach_user_id: current.data?.reference_coach_user_id ?? null,
        notes: current.data?.notes ?? null,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )
  if (upsert.error) throw new Error(upsert.error.message)

  const event = await admin.from('member_athlete_progress_events').insert({
    id: crypto.randomUUID(),
    member_user_id: memberUserId,
    event_type: 'program_change',
    effective_date: effectiveDate,
    previous_program_level: current.data?.program_level ?? null,
    next_program_level: nextProgram,
    previous_stripes: current.data?.stripes ?? null,
    next_stripes: current.data?.stripes ?? 0,
    notes,
    created_by: me.id,
  })
  if (event.error) throw new Error(event.error.message)

  revalidatePath('/head-coach/athletes')
  redirect(nextPath)
}

async function addStripeAction(formData: FormData) {
  'use server'

  const nextPath = String(formData.get('nextPath') || '/head-coach/athletes')
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  const effectiveDate = String(formData.get('effective_date') || '').trim() || new Date().toISOString().slice(0, 10)
  const notes = sanitizeNote(formData.get('notes'))
  const specialty = normalizeSpecialty(String(formData.get('specialty_snapshot') || ''))
  const ageGroup = String(formData.get('age_group_snapshot') || 'unknown') as AthleteAgeGroup

  if (!memberUserId) redirect(nextPath)
  if (!isKimonoEligible(specialty, ageGroup)) throw new Error('Kimono training is required before awarding stripes.')

  const me = await requireHeadCoachAccess(nextPath)
  const admin = getSupabaseAdminClientCached()
  const current = await admin
    .from('member_training_profiles')
    .select('program_level, stripes, specialty, reference_coach_user_id, notes')
    .eq('member_user_id', memberUserId)
    .maybeSingle<{ program_level: string | null; stripes: number | null; specialty: string | null; reference_coach_user_id: string | null; notes: string | null }>()

  if (current.error) throw new Error(current.error.message)

  const previousStripes = Math.max(0, Math.min(4, Number(current.data?.stripes ?? 0)))
  const nextStripes = Math.min(4, previousStripes + 1)

  const upsert = await admin
    .from('member_training_profiles')
    .upsert(
      {
        member_user_id: memberUserId,
        program_level: current.data?.program_level ?? null,
        stripes: nextStripes,
        specialty: current.data?.specialty ?? specialty,
        reference_coach_user_id: current.data?.reference_coach_user_id ?? null,
        notes: current.data?.notes ?? null,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )
  if (upsert.error) throw new Error(upsert.error.message)

  const event = await admin.from('member_athlete_progress_events').insert({
    id: crypto.randomUUID(),
    member_user_id: memberUserId,
    event_type: 'stripe_award',
    effective_date: effectiveDate,
    previous_program_level: current.data?.program_level ?? null,
    next_program_level: current.data?.program_level ?? null,
    previous_stripes: previousStripes,
    next_stripes: nextStripes,
    notes,
    created_by: me.id,
  })
  if (event.error) throw new Error(event.error.message)

  revalidatePath('/head-coach/athletes')
  redirect(nextPath)
}

async function promoteBeltAction(formData: FormData) {
  'use server'

  const nextPath = String(formData.get('nextPath') || '/head-coach/athletes')
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  const beltCode = String(formData.get('belt_code') || '').trim().toLowerCase()
  const promotedAt = String(formData.get('promoted_at') || '').trim() || new Date().toISOString().slice(0, 10)
  const notes = sanitizeNote(formData.get('notes'))
  const specialty = normalizeSpecialty(String(formData.get('specialty_snapshot') || ''))
  const ageGroup = String(formData.get('age_group_snapshot') || 'unknown') as AthleteAgeGroup
  if (!memberUserId || !beltCode) redirect(nextPath)
  if (!isKimonoEligible(specialty, ageGroup)) throw new Error('Kimono training is required before promoting a belt.')

  const me = await requireHeadCoachAccess(nextPath)
  const admin = getSupabaseAdminClientCached()
  const currentBelt = await admin
    .from('member_belt_promotions')
    .select('belt_code, promoted_at')
    .eq('member_user_id', memberUserId)
    .order('promoted_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ belt_code: string | null; promoted_at: string | null }>()
  if (currentBelt.error) throw new Error(currentBelt.error.message)

  const training = await admin
    .from('member_training_profiles')
    .select('program_level, stripes, specialty, reference_coach_user_id, notes')
    .eq('member_user_id', memberUserId)
    .maybeSingle<{ program_level: string | null; stripes: number | null; specialty: string | null; reference_coach_user_id: string | null; notes: string | null }>()
  if (training.error) throw new Error(training.error.message)

  const insert = await admin.from('member_belt_promotions').insert({
    id: crypto.randomUUID(),
    member_user_id: memberUserId,
    belt_code: beltCode,
    promoted_at: promotedAt,
    notes,
    created_by: me.id,
    updated_by: me.id,
  })
  if (insert.error) throw new Error(insert.error.message)

  const profileUpsert = await admin
    .from('member_training_profiles')
    .upsert(
      {
        member_user_id: memberUserId,
        program_level: training.data?.program_level ?? null,
        stripes: 0,
        specialty: training.data?.specialty ?? specialty,
        reference_coach_user_id: training.data?.reference_coach_user_id ?? null,
        notes: training.data?.notes ?? null,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )
  if (profileUpsert.error) throw new Error(profileUpsert.error.message)

  const event = await admin.from('member_athlete_progress_events').insert({
    id: crypto.randomUUID(),
    member_user_id: memberUserId,
    event_type: 'belt_promotion',
    effective_date: promotedAt,
    previous_program_level: training.data?.program_level ?? null,
    next_program_level: training.data?.program_level ?? null,
    previous_belt_code: currentBelt.data?.belt_code ?? null,
    next_belt_code: beltCode,
    previous_stripes: training.data?.stripes ?? 0,
    next_stripes: 0,
    notes,
    created_by: me.id,
  })
  if (event.error) throw new Error(event.error.message)

  revalidatePath('/head-coach/athletes')
  redirect(nextPath)
}

async function saveCompetitionResultAction(formData: FormData) {
  'use server'

  const nextPath = String(formData.get('nextPath') || '/head-coach/athletes')
  const resultId = String(formData.get('resultId') || '').trim()
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  const competitionName = String(formData.get('competition_name') || '').trim()
  const competitionDate = String(formData.get('competition_date') || '').trim()
  const division = String(formData.get('division') || '').trim() || null
  const category = String(formData.get('category') || '').trim() || null
  const result = normalizeCompetitionResult(String(formData.get('result') || ''))
  const notes = sanitizeNote(formData.get('notes'))

  if (!memberUserId || !competitionName || !competitionDate || !result) redirect(nextPath)
  const me = await requireHeadCoachAccess(nextPath)
  const admin = getSupabaseAdminClientCached()

  if (resultId) {
    const update = await admin
      .from('member_competition_results')
      .update({
        competition_name: competitionName,
        competition_date: competitionDate,
        division,
        category,
        result,
        notes,
        updated_by: me.id,
      })
      .eq('id', resultId)
      .eq('member_user_id', memberUserId)
    if (update.error) throw new Error(update.error.message)
  } else {
    const insert = await admin.from('member_competition_results').insert({
      id: crypto.randomUUID(),
      member_user_id: memberUserId,
      competition_name: competitionName,
      competition_date: competitionDate,
      division,
      category,
      result,
      notes,
      created_by: me.id,
      updated_by: me.id,
    })
    if (insert.error) throw new Error(insert.error.message)
  }

  const event = await admin.from('member_athlete_progress_events').insert({
    id: crypto.randomUUID(),
    member_user_id: memberUserId,
    event_type: 'competition_result',
    effective_date: competitionDate,
    notes: `${competitionName}${notes ? ` — ${notes}` : ''}`,
    created_by: me.id,
  })
  if (event.error) throw new Error(event.error.message)

  revalidatePath('/head-coach/athletes')
  redirect(nextPath)
}

async function deleteCompetitionResultAction(formData: FormData) {
  'use server'
  const nextPath = String(formData.get('nextPath') || '/head-coach/athletes')
  const resultId = String(formData.get('resultId') || '').trim()
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  if (!resultId || !memberUserId) redirect(nextPath)
  await requireHeadCoachAccess(nextPath)
  const admin = getSupabaseAdminClientCached()
  const del = await admin.from('member_competition_results').delete().eq('id', resultId).eq('member_user_id', memberUserId)
  if (del.error) throw new Error(del.error.message)
  revalidatePath('/head-coach/athletes')
  redirect(nextPath)
}

function badgeToneClass(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeToneClass(tone)}`}>{children}</span>
}

function statTone(status: ReturnType<typeof promotionRadar>['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'due') return 'success'
  if (status === 'review') return 'warning'
  if (status === 'blocked') return 'danger'
  return 'neutral'
}

function isDueSoon(dueDate?: string | null) {
  if (!dueDate) return false
  const due = new Date(`${dueDate}T00:00:00Z`)
  const now = new Date()
  if (Number.isNaN(due.getTime())) return false
  const days = Math.floor((due.getTime() - now.getTime()) / 86400000)
  return days >= 0 && days <= 30
}

function profileChecklist(row: HeadCoachRosterRow, ageGroup: AthleteAgeGroup) {
  const items: string[] = []
  if (!row.program_level) items.push('Program missing')
  if (!row.current_belt) items.push('Belt missing')
  if (!row.specialty) items.push('Specialty missing')
  if (!row.reference_coach_user_id) items.push('Reference coach missing')
  if (ageGroup === 'unknown') items.push('Age group unknown')
  return {
    items,
    label: items.length === 0 ? 'Ready' : `${items.length} setup item${items.length > 1 ? 's' : ''}`,
  }
}

function athletePriorityScore(args: {
  promotion: ReturnType<typeof promotionRadar>
  checklist: { items: string[] }
  referenceCoachUserId: string | null
  attendanceBand: ReturnType<typeof attendanceBand>
  dueSoon: boolean
}) {
  let score = 0
  if (args.promotion.status === 'due') score += 120
  else if (args.promotion.status === 'blocked') score += 90
  else if (args.promotion.status === 'review') score += 70
  else score += 30
  if (args.dueSoon) score += 15
  if (args.checklist.items.length) score += 20 + args.checklist.items.length * 4
  if (!args.referenceCoachUserId) score += 10
  if (args.attendanceBand.key === 'low') score += 6
  return score
}

function buildEnrichedRoster(rows: HeadCoachRosterRow[]) {
  return rows.map<EnrichedAthlete>((row) => {
    const age = ageYears(row.date_of_birth)
    const ageGroup = ageGroupFromDate(row.date_of_birth)
    const band = attendanceBand(Number(row.attendance_90d ?? 0))
    const kimonoEligible = isKimonoEligible(row.specialty, ageGroup)
    const baselineDate = row.current_belt_promoted_at ?? row.profile_created_at
    const promotion = promotionRadar({
      program: row.program_level,
      currentBelt: row.current_belt,
      stripes: row.stripes,
      specialty: row.specialty,
      ageGroup,
      baselineDate,
      attendance90d: Number(row.attendance_90d ?? 0),
    })
    const checklist = profileChecklist(row, ageGroup)
    const dueSoon = isDueSoon(promotion.dueDate)
    return {
      ...row,
      name: fullName(row.first_name, row.last_name, row.email),
      age,
      age_group: ageGroup,
      attendance_band: band,
      kimono_eligible: kimonoEligible,
      promotion,
      due_soon: dueSoon,
      profile_checklist: checklist,
      priority_score: athletePriorityScore({
        promotion,
        checklist,
        referenceCoachUserId: row.reference_coach_user_id,
        attendanceBand: band,
        dueSoon,
      }),
    }
  })
}

function matchesFilter(row: EnrichedAthlete, filters: {
  q: string
  role: string
  program: string
  belt: string
  specialty: string
  promotion: string
  attendance: string
  age_group: string
  kimono: string
  checklist: string
}) {
  const q = filters.q.trim().toLowerCase()
  if (q) {
    const haystack = [row.name, row.member_id ?? '', row.email ?? '', row.reference_coach_name ?? ''].join(' ').toLowerCase()
    if (!haystack.includes(q)) return false
  }
  if (filters.role && row.role !== filters.role) return false
  if (filters.program && (row.program_level ?? '') !== filters.program) return false
  if (filters.belt && (row.current_belt ?? '') !== filters.belt) return false
  if (filters.specialty && (row.specialty ?? '') !== filters.specialty) return false
  if (filters.promotion && row.promotion.status !== filters.promotion) return false
  if (filters.attendance && row.attendance_band.key !== filters.attendance) return false
  if (filters.age_group && row.age_group !== filters.age_group) return false
  if (filters.kimono === 'eligible' && !row.kimono_eligible) return false
  if (filters.kimono === 'blocked' && row.kimono_eligible) return false
  if (filters.checklist === 'incomplete' && row.profile_checklist.items.length === 0) return false
  if (filters.checklist === 'ready' && row.profile_checklist.items.length > 0) return false
  if (filters.checklist === 'missing_reference_coach' && row.reference_coach_user_id) return false
  if (filters.checklist === 'missing_program' && row.program_level) return false
  if (filters.checklist === 'missing_specialty' && row.specialty) return false
  if (filters.checklist === 'missing_belt' && row.current_belt) return false
  return true
}

export default async function HeadCoachAthletesPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  const signedInAs = me?.full_name || me?.email || null

  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    return (
      <AccessDeniedPage
        title="Head Coach Athletes"
        subtitle="Access restricted."
        signedInAs={signedInAs}
        message="Only the head coach and super admin can open the athlete dashboard."
        allowed="Allowed roles: Head Coach, Super Admin"
        nextPath="/head-coach/athletes"
      />
    )
  }

  const filters: DashboardFilters = {
    q: pick(searchParams?.q) ?? '',
    role: pick(searchParams?.role) ?? '',
    program: pick(searchParams?.program) ?? '',
    belt: pick(searchParams?.belt) ?? '',
    specialty: pick(searchParams?.specialty) ?? '',
    promotion: pick(searchParams?.promotion) ?? '',
    attendance: pick(searchParams?.attendance) ?? '',
    age_group: pick(searchParams?.age_group) ?? '',
    kimono: pick(searchParams?.kimono) ?? '',
    checklist: pick(searchParams?.checklist) ?? '',
    sort: pick(searchParams?.sort) ?? 'priority',
    focus: pick(searchParams?.focus) ?? '',
    page: pick(searchParams?.page) ?? '',
  }
  const admin = getSupabaseAdminClientCached()
  const [rosterRes, coachesRes] = await Promise.all([
    admin.from('head_coach_athlete_roster').select('*').returns<HeadCoachRosterRow[]>(),
    admin
      .from('profiles')
      .select('user_id, first_name, last_name, role')
      .in('role', REFERENCE_COACH_ROLES)
      .order('first_name', { ascending: true })
      .returns<CoachOption[]>(),
  ])

  if (rosterRes.error) throw new Error(rosterRes.error.message)
  if (coachesRes.error) throw new Error(coachesRes.error.message)

  const roster = buildEnrichedRoster(rosterRes.data ?? [])
  const filtered = roster
    .filter((row) => matchesFilter(row, filters))
    .sort((a, b) => {
      if (filters.sort === 'name') return a.name.localeCompare(b.name)
      if (filters.sort === 'attendance') return Number(b.attendance_90d ?? 0) - Number(a.attendance_90d ?? 0)
      if (filters.sort === 'due_date') {
        const left = a.promotion.dueDate ?? '9999-12-31'
        const right = b.promotion.dueDate ?? '9999-12-31'
        return left.localeCompare(right) || a.name.localeCompare(b.name)
      }
      return b.priority_score - a.priority_score || a.name.localeCompare(b.name)
    })

  const totalPages = Math.max(1, Math.ceil(filtered.length / ATHLETES_PER_PAGE))
  const currentPage = Math.min(parsePage(filters.page), totalPages)
  const pageStart = (currentPage - 1) * ATHLETES_PER_PAGE
  const pageRows = filtered.slice(pageStart, pageStart + ATHLETES_PER_PAGE)
  const pageEnd = pageStart + pageRows.length

  const focusAthlete = pageRows.find((row) => row.user_id === filters.focus) ?? pageRows[0] ?? null
  const nextPath = buildAthletesHref({ ...filters, page: String(currentPage), focus: focusAthlete?.user_id ?? filters.focus })

  const [focusCompetitionsRes, progressRes] = focusAthlete
    ? await Promise.all([
        admin
          .from('member_competition_results')
          .select('id, member_user_id, competition_name, competition_date, division, category, result, notes, created_at, updated_at')
          .eq('member_user_id', focusAthlete.user_id)
          .order('competition_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(8)
          .returns<CompetitionRow[]>(),
        admin
          .from('member_athlete_progress_events')
          .select('id, member_user_id, event_type, effective_date, previous_program_level, next_program_level, previous_belt_code, next_belt_code, previous_stripes, next_stripes, notes, created_at')
          .eq('member_user_id', focusAthlete.user_id)
          .order('effective_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(12)
          .returns<ProgressEventRow[]>(),
      ])
    : [{ data: [], error: null as any }, { data: [], error: null as any }]

  if (focusCompetitionsRes.error) throw new Error(focusCompetitionsRes.error.message)
  if (progressRes.error) throw new Error(progressRes.error.message)

  const totalAthletes = roster.length
  const dueCount = roster.filter((row) => row.promotion.status === 'due').length
  const dueSoonCount = roster.filter((row) => row.due_soon).length
  const reviewCount = roster.filter((row) => row.promotion.status === 'review').length
  const blockedCount = roster.filter((row) => row.promotion.status === 'blocked').length
  const incompleteCount = roster.filter((row) => row.profile_checklist.items.length > 0).length
  const noCoachCount = roster.filter((row) => !row.reference_coach_user_id).length

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Head Coach Athletes"
        subtitle="Analyse progression, manage programs, promotions, and competition tracking without touching front-desk critical flows."
        right={
          <div className="flex flex-wrap gap-2">
            <TinyBadge>{totalAthletes} athletes</TinyBadge>
            <TinyBadge tone="success">{dueCount} due</TinyBadge>
            <TinyBadge tone="warning">{reviewCount} review</TinyBadge>
            <TinyBadge tone="danger">{blockedCount} blocked</TinyBadge>
            <TinyBadge>{incompleteCount} incomplete</TinyBadge>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Total athletes</div><div className="mt-2 text-2xl font-semibold tracking-tight">{totalAthletes}</div></div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Action now</div><div className="mt-2 text-2xl font-semibold tracking-tight">{dueCount}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Due now</div></div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Due soon</div><div className="mt-2 text-2xl font-semibold tracking-tight">{dueSoonCount}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Next 30 days</div></div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Review due</div><div className="mt-2 text-2xl font-semibold tracking-tight">{reviewCount}</div></div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Incomplete</div><div className="mt-2 text-2xl font-semibold tracking-tight">{incompleteCount}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Needs setup</div></div>
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">No reference coach</div><div className="mt-2 text-2xl font-semibold tracking-tight">{noCoachCount}</div></div>
      </section>

      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <form className="grid gap-3 lg:grid-cols-8">
          <input type="text" name="q" defaultValue={filters.q} placeholder="Search name, member ID, email" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black lg:col-span-2" />
          <select name="role" defaultValue={filters.role} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All roles</option>{TARGET_ROLES.map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}</select>
          <select name="program" defaultValue={filters.program} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All programs</option>{PROGRAM_OPTIONS.map((program) => <option key={program} value={program}>{titleCase(program)}</option>)}</select>
          <select name="specialty" defaultValue={filters.specialty} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All specialties</option>{SPECIALTY_OPTIONS.map((specialty) => <option key={specialty} value={specialty}>{titleCase(specialty)}</option>)}</select>
          <select name="promotion" defaultValue={filters.promotion} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All promotion states</option><option value="due">Due</option><option value="review">Review</option><option value="watch">Watch</option><option value="blocked">Blocked</option></select>
          <select name="attendance" defaultValue={filters.attendance} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All attendance bands</option><option value="high">High</option><option value="steady">Steady</option><option value="low">Low</option></select>
          <select name="age_group" defaultValue={filters.age_group} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All age groups</option><option value="kids">Kids</option><option value="adults">Adults</option><option value="unknown">Unknown</option></select>
          <select name="kimono" defaultValue={filters.kimono} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All kimono states</option><option value="eligible">Kimono eligible</option><option value="blocked">Kimono blocked</option></select>
          <select name="checklist" defaultValue={filters.checklist} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">All setup states</option><option value="incomplete">Needs setup</option><option value="ready">Ready</option><option value="missing_reference_coach">Missing reference coach</option><option value="missing_program">Missing program</option><option value="missing_specialty">Missing specialty</option><option value="missing_belt">Missing belt</option></select>
          <select name="sort" defaultValue={filters.sort} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="priority">Priority first</option><option value="name">Name A-Z</option><option value="attendance">Attendance 90d</option><option value="due_date">Due date</option></select>
          <div className="flex flex-wrap gap-2 lg:col-span-8">
            <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Apply filters</button>
            <Link href="/head-coach/athletes" className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[hsl(var(--bg))]">Reset</Link>
          </div>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)]">
        <div className="overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight sm:text-base">Review queue</h2>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Showing {filtered.length === 0 ? 0 : pageStart + 1}-{pageEnd} of {filtered.length} athletes · 10 per page.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <TinyBadge>{currentPage}/{totalPages} pages</TinyBadge>
                <TinyBadge>{pageRows.length} on screen</TinyBadge>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">No athlete matches the current filters.</div>
            ) : (
              <>
                <div className="grid gap-3 xl:hidden">
                  {pageRows.map((row) => (
                    <div
                      key={row.user_id}
                      className={`rounded-2xl border p-4 ${focusAthlete?.user_id === row.user_id ? 'border-black ring-1 ring-black' : 'border-[hsl(var(--border))]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-semibold leading-tight text-black">{row.name}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                            <span>{titleCase(row.role ?? 'member')}</span>
                            {row.member_id ? <span>{row.member_id}</span> : null}
                            <span>{row.age_group === 'unknown' ? 'Age unknown' : titleCase(row.age_group)}</span>
                          </div>
                        </div>
                        <TinyBadge tone={statTone(row.promotion.status)}>{row.promotion.label}</TinyBadge>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Program</div>
                          <div className="mt-1 text-sm text-black">{row.program_level ? titleCase(row.program_level) : '—'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belt</div>
                          <div className="mt-1 text-sm text-black">{row.current_belt ? titleCase(row.current_belt) : '—'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Stripes</div>
                          <div className="mt-1 text-sm text-black">{Number(row.stripes ?? 0)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attendance 90d</div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-black">
                            <span>{Number(row.attendance_90d ?? 0)}</span>
                            <TinyBadge tone={row.attendance_band.tone === 'danger' ? 'danger' : row.attendance_band.tone === 'success' ? 'success' : 'warning'}>{row.attendance_band.label}</TinyBadge>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 text-xs text-[hsl(var(--muted))]">
                        <div>{row.specialty ? titleCase(row.specialty) : 'Specialty pending'}</div>
                        <div className="mt-1">Due {fmtDate(row.promotion.dueDate)}{row.due_soon ? ' · Due soon' : ''}</div>
                        <div className="mt-1">{row.promotion.reason}</div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <TinyBadge>{row.profile_checklist.label}</TinyBadge>
                        {!row.reference_coach_user_id ? <TinyBadge tone="warning">Missing coach</TinyBadge> : null}
                        {!row.kimono_eligible ? <TinyBadge tone="danger">Kimono blocked</TinyBadge> : null}
                      </div>

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <Link href={buildAthletesHref(filters, { page: currentPage, focus: row.user_id })} scroll={false} className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">Manage</Link>
                        <Link href={`/members/${row.user_id}`} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-[hsl(var(--bg))]">Open member file</Link>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden xl:block">
                  <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
                    <table className="w-full table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[28%]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%]" />
                        <col className="w-[8%]" />
                        <col className="w-[12%]" />
                        <col className="w-[16%]" />
                        <col className="w-[10%]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr className="border-b border-[hsl(var(--border))] text-xs uppercase tracking-wide text-[hsl(var(--muted))]">
                          <th className="px-4 py-3 font-medium">Athlete</th>
                          <th className="px-4 py-3 font-medium">Program</th>
                          <th className="px-4 py-3 font-medium">Belt</th>
                          <th className="px-4 py-3 font-medium">Stripes</th>
                          <th className="px-4 py-3 font-medium">Attendance</th>
                          <th className="px-4 py-3 font-medium">Promotion</th>
                          <th className="px-4 py-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row) => (
                          <tr key={row.user_id} className={`border-b border-[hsl(var(--border))] align-top last:border-b-0 ${focusAthlete?.user_id === row.user_id ? 'bg-[hsl(var(--bg))]' : 'bg-white'}`}>
                            <td className="px-4 py-4">
                              <div className="font-medium leading-tight text-black">{row.name}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                <span>{titleCase(row.role ?? 'member')}</span>
                                {row.member_id ? <span>{row.member_id}</span> : null}
                                <span>{row.age_group === 'unknown' ? 'Age unknown' : titleCase(row.age_group)}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="text-sm text-black">{row.program_level ? titleCase(row.program_level) : '—'}</div>
                              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.specialty ? titleCase(row.specialty) : 'Specialty pending'}</div>
                              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.profile_checklist.label}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="text-sm text-black">{row.current_belt ? titleCase(row.current_belt) : '—'}</div>
                              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(row.current_belt_promoted_at)}</div>
                            </td>
                            <td className="px-4 py-4 text-sm text-black">{Number(row.stripes ?? 0)}</td>
                            <td className="px-4 py-4">
                              <div className="text-sm text-black">{Number(row.attendance_90d ?? 0)}</div>
                              <div className="mt-1"><TinyBadge tone={row.attendance_band.tone === 'danger' ? 'danger' : row.attendance_band.tone === 'success' ? 'success' : 'warning'}>{row.attendance_band.label}</TinyBadge></div>
                            </td>
                            <td className="px-4 py-4">
                              <TinyBadge tone={statTone(row.promotion.status)}>{row.promotion.label}</TinyBadge>
                              <div className="mt-2 text-xs leading-5 text-[hsl(var(--muted))]">Due {fmtDate(row.promotion.dueDate)}{row.due_soon ? ' · soon' : ''}</div>
                              <div className="mt-1 text-xs leading-5 text-[hsl(var(--muted))]">{row.promotion.reason}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-2">
                                <Link href={buildAthletesHref(filters, { page: currentPage, focus: row.user_id })} scroll={false} className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-3 py-2 text-xs font-medium text-white transition hover:opacity-90">Manage</Link>
                                <Link href={`/members/${row.user_id}`} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-[hsl(var(--bg))]">Open file</Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-[hsl(var(--muted))]">Page {currentPage} of {totalPages}</div>
              <div className="flex flex-wrap gap-2">
                {currentPage > 1 ? (
                  <Link href={buildAthletesHref(filters, { page: currentPage - 1, focus: null })} scroll={false} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[hsl(var(--bg))]">Previous</Link>
                ) : (
                  <span className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-2 text-sm font-medium text-[hsl(var(--muted))]">Previous</span>
                )}
                {currentPage < totalPages ? (
                  <Link href={buildAthletesHref(filters, { page: currentPage + 1, focus: null })} scroll={false} className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Next</Link>
                ) : (
                  <span className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-2 text-sm font-medium text-[hsl(var(--muted))]">Next</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div id="athlete-manager" className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft xl:sticky xl:top-4 xl:self-start">
          {!focusAthlete ? (

            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">Select an athlete to manage the profile, promotions, and competition history.</div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{focusAthlete.name}</h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">{titleCase(focusAthlete.role ?? 'member')} · {focusAthlete.member_id ?? 'No member ID'} · {focusAthlete.reference_coach_name || 'No reference coach yet'}</p>
                  </div>
                  <TinyBadge tone={statTone(focusAthlete.promotion.status)}>{focusAthlete.promotion.label}</TinyBadge>
                </div>
                <p className="mt-3 text-sm text-[hsl(var(--muted))]">{focusAthlete.promotion.reason} {focusAthlete.promotion.nextAction}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {focusAthlete.due_soon ? <TinyBadge tone="warning">Due within 30 days</TinyBadge> : null}
                  <TinyBadge>{focusAthlete.profile_checklist.label}</TinyBadge>
                  <TinyBadge tone={focusAthlete.kimono_eligible ? 'success' : 'danger'}>{focusAthlete.kimono_eligible ? 'Kimono eligible' : 'Kimono blocked'}</TinyBadge>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Current belt</div><div className="mt-2 text-lg font-semibold tracking-tight">{focusAthlete.current_belt ? titleCase(focusAthlete.current_belt) : 'Not set'}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Promoted {fmtDate(focusAthlete.current_belt_promoted_at)}</div></div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attendance</div><div className="mt-2 text-lg font-semibold tracking-tight">{Number(focusAthlete.attendance_30d ?? 0)} / {Number(focusAthlete.attendance_90d ?? 0)} / {Number(focusAthlete.attendance_180d ?? 0)}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">30d / 90d / 180d · Last attended {fmtDate(focusAthlete.last_attended_at)}</div></div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Readiness checklist</div><div className="mt-2 text-sm font-semibold tracking-tight">{focusAthlete.profile_checklist.label}</div><div className="mt-2 flex flex-wrap gap-2">{focusAthlete.profile_checklist.items.length === 0 ? <TinyBadge tone="success">Setup complete</TinyBadge> : focusAthlete.profile_checklist.items.map((item) => <TinyBadge key={item} tone="warning">{item}</TinyBadge>)}</div><div className="mt-2 text-xs text-[hsl(var(--muted))]">Due date {fmtDate(focusAthlete.promotion.dueDate)}</div></div>
              </div>

              <form action={saveAthleteProfileAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">Athlete profile editor</h3>
                  <p className="mt-1 text-xs text-[hsl(var(--muted))]">Program, stripes, specialty, reference coach, and coach note.</p>
                </div>
                <input type="hidden" name="memberUserId" value={focusAthlete.user_id} />
                <input type="hidden" name="nextPath" value={nextPath} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Program</span><select name="program_level" defaultValue={focusAthlete.program_level ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">Program pending</option>{PROGRAM_OPTIONS.map((program) => <option key={program} value={program}>{titleCase(program)}</option>)}</select></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Stripes</span><input type="number" min={0} max={4} name="stripes" defaultValue={Number(focusAthlete.stripes ?? 0)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Specialty</span><select name="specialty" defaultValue={focusAthlete.specialty ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">Not set yet</option>{SPECIALTY_OPTIONS.map((specialty) => <option key={specialty} value={specialty}>{titleCase(specialty)}</option>)}</select></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Reference coach</span><select name="reference_coach_user_id" defaultValue={focusAthlete.reference_coach_user_id ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">No reference coach</option>{(coachesRes.data ?? []).map((coach) => <option key={coach.user_id} value={coach.user_id}>{fullName(coach.first_name, coach.last_name, coach.role ? titleCase(coach.role) : 'Coach')}</option>)}</select></label>
                </div>
                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Coach note</span><textarea name="notes" rows={4} defaultValue={focusAthlete.coach_note ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-[hsl(var(--muted))]">Kimono eligibility: <span className="font-medium text-black">{focusAthlete.kimono_eligible ? 'Eligible' : 'Blocked'}</span></div><button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save athlete profile</button></div>
              </form>

              <div className="grid gap-3 xl:grid-cols-3">
                <form action={addStripeAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div><h3 className="text-sm font-semibold tracking-tight">Award stripe</h3><p className="mt-1 text-xs text-[hsl(var(--muted))]">Increments stripes by one, up to 4.</p></div>
                  <input type="hidden" name="memberUserId" value={focusAthlete.user_id} />
                  <input type="hidden" name="nextPath" value={nextPath} />
                  <input type="hidden" name="specialty_snapshot" value={focusAthlete.specialty ?? ''} />
                  <input type="hidden" name="age_group_snapshot" value={focusAthlete.age_group} />
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Effective date</span><input type="date" name="effective_date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Note</span><textarea name="notes" rows={2} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Add stripe</button>
                </form>

                <form action={promoteBeltAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div><h3 className="text-sm font-semibold tracking-tight">Promote belt</h3><p className="mt-1 text-xs text-[hsl(var(--muted))]">Adds a belt promotion and resets stripes to 0.</p></div>
                  <input type="hidden" name="memberUserId" value={focusAthlete.user_id} />
                  <input type="hidden" name="nextPath" value={nextPath} />
                  <input type="hidden" name="specialty_snapshot" value={focusAthlete.specialty ?? ''} />
                  <input type="hidden" name="age_group_snapshot" value={focusAthlete.age_group} />
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">New belt</span><select name="belt_code" defaultValue={focusAthlete.current_belt ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">Select belt</option>{beltTrackForAgeGroup(focusAthlete.age_group).map((belt) => <option key={belt} value={belt}>{titleCase(belt)}</option>)}</select></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Promotion date</span><input type="date" name="promoted_at" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Note</span><textarea name="notes" rows={2} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Promote belt</button>
                </form>

                <form action={moveProgramAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div><h3 className="text-sm font-semibold tracking-tight">Move program</h3><p className="mt-1 text-xs text-[hsl(var(--muted))]">Records a program move in the progression history.</p></div>
                  <input type="hidden" name="memberUserId" value={focusAthlete.user_id} />
                  <input type="hidden" name="nextPath" value={nextPath} />
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Next program</span><select name="next_program_level" defaultValue={focusAthlete.program_level ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{PROGRAM_OPTIONS.map((program) => <option key={program} value={program}>{titleCase(program)}</option>)}</select></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Effective date</span><input type="date" name="effective_date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Reason</span><textarea name="notes" rows={2} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save program move</button>
                </form>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight">Competition results</h3>
                      <p className="mt-1 text-xs text-[hsl(var(--muted))]">Add, edit, or remove recent sports results.</p>
                    </div>
                    <TinyBadge>{focusCompetitionsRes.data?.length ?? 0} recent</TinyBadge>
                  </div>

                  <form action={saveCompetitionResultAction} className="mt-4 grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                    <input type="hidden" name="memberUserId" value={focusAthlete.user_id} />
                    <input type="hidden" name="nextPath" value={nextPath} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition name</span><input type="text" name="competition_name" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                      <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition date</span><input type="date" name="competition_date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                      <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Division</span><input type="text" name="division" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                      <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Category</span><input type="text" name="category" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                    </div>
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Result</span><select name="result" defaultValue="gold" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{COMPETITION_RESULTS.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Notes</span><textarea name="notes" rows={3} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                    <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Add result</button>
                  </form>

                  <div className="mt-4 grid gap-3">
                    {(focusCompetitionsRes.data ?? []).map((row) => (
                      <form key={row.id} action={saveCompetitionResultAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                        <input type="hidden" name="resultId" value={row.id} />
                        <input type="hidden" name="memberUserId" value={focusAthlete.user_id} />
                        <input type="hidden" name="nextPath" value={nextPath} />
                        <div className="flex flex-wrap items-center gap-2"><TinyBadge>{titleCase(row.result)}</TinyBadge><TinyBadge>{fmtDate(row.competition_date)}</TinyBadge></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition name</span><input type="text" name="competition_name" defaultValue={row.competition_name} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                          <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition date</span><input type="date" name="competition_date" defaultValue={row.competition_date} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                          <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Division</span><input type="text" name="division" defaultValue={row.division ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                          <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Category</span><input type="text" name="category" defaultValue={row.category ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                        </div>
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Result</span><select name="result" defaultValue={row.result} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{COMPETITION_RESULTS.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Notes</span><textarea name="notes" rows={2} defaultValue={row.notes ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                        <div className="flex flex-wrap justify-between gap-2">
                          <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save result</button>
                          <button type="submit" formAction={deleteCompetitionResultAction} className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100">Remove result</button>
                        </div>
                      </form>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight">Progress history</h3>
                      <p className="mt-1 text-xs text-[hsl(var(--muted))]">Program moves, stripes, belt promotions, and profile changes.</p>
                    </div>
                    <TinyBadge>{progressRes.data?.length ?? 0} events</TinyBadge>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {(progressRes.data ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">No progress event recorded yet.</div>
                    ) : (progressRes.data ?? []).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                        <div className="flex flex-wrap items-center gap-2"><TinyBadge>{titleCase(event.event_type)}</TinyBadge><TinyBadge>{fmtDate(event.effective_date)}</TinyBadge></div>
                        <div className="mt-2 text-sm text-black">
                          {event.previous_program_level || event.next_program_level ? (
                            <div>Program: {titleCase(event.previous_program_level ?? '—')} → {titleCase(event.next_program_level ?? '—')}</div>
                          ) : null}
                          {event.previous_belt_code || event.next_belt_code ? (
                            <div className="mt-1">Belt: {titleCase(event.previous_belt_code ?? '—')} → {titleCase(event.next_belt_code ?? '—')}</div>
                          ) : null}
                          {event.previous_stripes !== null || event.next_stripes !== null ? (
                            <div className="mt-1">Stripes: {event.previous_stripes ?? '—'} → {event.next_stripes ?? '—'}</div>
                          ) : null}
                        </div>
                        {event.notes ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{event.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
