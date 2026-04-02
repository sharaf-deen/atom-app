import {
  ageGroupFromDate,
  nextBeltForAgeGroup,
  promotionRadar,
  titleCase,
  type AthleteAgeGroup,
  type AthleteSpecialty,
  type ProgramLevel,
} from '@/lib/headCoachAthletes'
import type { Role } from '@/lib/session'

export type BeltPromotionAudience = 'kids' | 'adults' | 'mixed'
export type BeltPromotionEventStatus = 'draft' | 'published' | 'live' | 'closed'
export type BeltPromotionPreparationStatus = 'suggested' | 'reviewed' | 'approved' | 'hold'
export type BeltPromotionPaymentStatus = 'pending' | 'paid' | 'waived' | 'verify'
export type BeltPromotionDecision = 'stripe' | 'belt' | 'none'
export type BeltPromotionAttendanceStatus = 'pending' | 'present' | 'absent'
export type BeltPromotionFinalDecision = 'pending' | 'confirmed' | 'deferred' | 'rejected' | 'absent'
export type BeltPromotionLogAction =
  | 'event_created'
  | 'event_updated'
  | 'event_status_changed'
  | 'candidate_added'
  | 'candidate_updated'
  | 'candidate_removed'
  | 'suggestions_added'
  | 'results_applied'

export const BELT_PROMOTION_AUDIENCES: BeltPromotionAudience[] = ['kids', 'adults', 'mixed']
export const BELT_PROMOTION_EVENT_STATUSES: BeltPromotionEventStatus[] = ['draft', 'published', 'live', 'closed']
export const BELT_PROMOTION_PREPARATION_STATUSES: BeltPromotionPreparationStatus[] = ['suggested', 'reviewed', 'approved', 'hold']
export const BELT_PROMOTION_PAYMENT_STATUSES: BeltPromotionPaymentStatus[] = ['pending', 'paid', 'waived', 'verify']
export const BELT_PROMOTION_DECISIONS: BeltPromotionDecision[] = ['stripe', 'belt', 'none']
export const BELT_PROMOTION_ATTENDANCE_STATUSES: BeltPromotionAttendanceStatus[] = ['pending', 'present', 'absent']
export const BELT_PROMOTION_FINAL_DECISIONS: BeltPromotionFinalDecision[] = ['pending', 'confirmed', 'deferred', 'rejected', 'absent']
export const BELT_PROMOTION_TARGET_ROLES: Role[] = ['member', 'coach', 'assistant_coach', 'vip', 'champion']

export type BeltPromotionEventRow = {
  id: string
  title: string
  event_date: string
  event_time: string | null
  audience: BeltPromotionAudience
  status: BeltPromotionEventStatus
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type BeltPromotionCandidateRow = {
  id: string
  event_id: string
  member_user_id: string
  current_belt: string | null
  current_stripes: number | null
  proposed_decision: BeltPromotionDecision
  proposed_belt: string | null
  proposed_stripes: number | null
  preparation_status: BeltPromotionPreparationStatus
  final_decision: BeltPromotionFinalDecision
  attendance_status: BeltPromotionAttendanceStatus
  payment_status: BeltPromotionPaymentStatus
  reference_coach_user_id: string | null
  head_coach_note: string | null
  belt_delivered: boolean
  certificate_delivered: boolean
  sort_order: number | null
  results_applied_at: string | null
  results_applied_by: string | null
  created_at: string | null
  updated_at: string | null
}

export type BeltPromotionApplyRunRow = {
  id: string
  event_id: string
  applied_count: number
  stripe_count: number
  belt_count: number
  note_count: number
  closed_event: boolean
  created_at: string | null
  applied_by: string | null
  notes: string | null
}

export type BeltPromotionLogRow = {
  id: string
  event_id: string
  candidate_id: string | null
  action: BeltPromotionLogAction
  details: string | null
  created_at: string | null
}

export type BeltPromotionRosterRow = {
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
  attendance_90d: number | null
  current_belt: string | null
  current_belt_promoted_at: string | null
}

export type BeltPromotionSuggestedCandidate = {
  member_user_id: string
  athlete_name: string
  member_id: string | null
  role: Role | null
  age_group: AthleteAgeGroup
  priority_score: number
  current_belt: string | null
  current_stripes: number
  program_level: ProgramLevel | null
  specialty: AthleteSpecialty | null
  reference_coach_user_id: string | null
  reference_coach_name: string | null
  promotion_label: string
  promotion_reason: string
  proposed_decision: BeltPromotionDecision
  proposed_belt: string | null
  proposed_stripes: number | null
  preparation_status: BeltPromotionPreparationStatus
  head_coach_note: string | null
}

export type LiveCandidateState = 'ready' | 'attention' | 'done' | 'absent'

export function fullName(firstName?: string | null, lastName?: string | null, fallback?: string | null) {
  const joined = [firstName ?? '', lastName ?? ''].join(' ').trim()
  return joined || fallback || 'Unnamed athlete'
}

export function normalizeAudience(value?: string | null): BeltPromotionAudience | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_AUDIENCES.includes(lowered as BeltPromotionAudience) ? (lowered as BeltPromotionAudience) : null
}

export function normalizeEventStatus(value?: string | null): BeltPromotionEventStatus | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_EVENT_STATUSES.includes(lowered as BeltPromotionEventStatus) ? (lowered as BeltPromotionEventStatus) : null
}

export function normalizePreparationStatus(value?: string | null): BeltPromotionPreparationStatus | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_PREPARATION_STATUSES.includes(lowered as BeltPromotionPreparationStatus) ? (lowered as BeltPromotionPreparationStatus) : null
}

export function normalizePaymentStatus(value?: string | null): BeltPromotionPaymentStatus | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_PAYMENT_STATUSES.includes(lowered as BeltPromotionPaymentStatus) ? (lowered as BeltPromotionPaymentStatus) : null
}

export function normalizeDecision(value?: string | null): BeltPromotionDecision | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_DECISIONS.includes(lowered as BeltPromotionDecision) ? (lowered as BeltPromotionDecision) : null
}

export function normalizeAttendanceStatus(value?: string | null): BeltPromotionAttendanceStatus | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_ATTENDANCE_STATUSES.includes(lowered as BeltPromotionAttendanceStatus)
    ? (lowered as BeltPromotionAttendanceStatus)
    : null
}

export function normalizeFinalDecision(value?: string | null): BeltPromotionFinalDecision | null {
  if (!value) return null
  const lowered = String(value).trim().toLowerCase()
  return BELT_PROMOTION_FINAL_DECISIONS.includes(lowered as BeltPromotionFinalDecision)
    ? (lowered as BeltPromotionFinalDecision)
    : null
}

export function normalizeStripes(value: unknown) {
  const raw = Number(String(value ?? '').trim())
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(4, Math.trunc(raw)))
}

export function sanitizeEventNote(value: unknown) {
  return String(value ?? '').trim().slice(0, 4000) || null
}

export function sanitizeCandidateNote(value: unknown) {
  return String(value ?? '').trim().slice(0, 2000) || null
}

export function eventAudienceLabel(audience: BeltPromotionAudience) {
  if (audience === 'kids') return 'Kids'
  if (audience === 'adults') return 'Adults'
  return 'Mixed'
}

export function includesAudience(audience: BeltPromotionAudience, ageGroup: AthleteAgeGroup) {
  if (audience === 'mixed') return true
  if (audience === 'kids') return ageGroup === 'kids'
  return ageGroup === 'adults'
}

export function suggestionPriorityScore(row: BeltPromotionRosterRow) {
  const ageGroup = ageGroupFromDate(row.date_of_birth)
  const radar = promotionRadar({
    program: row.program_level,
    currentBelt: row.current_belt,
    stripes: row.stripes,
    specialty: row.specialty,
    ageGroup,
    baselineDate: row.current_belt_promoted_at ?? row.profile_created_at,
    attendance90d: Number(row.attendance_90d ?? 0),
  })

  let score = 0
  if (radar.status === 'due') score += 100
  else if (radar.status === 'review') score += 70
  else if (radar.status === 'blocked') score += 20
  else score += 10

  score += Math.min(30, Number(row.attendance_90d ?? 0))
  if (row.reference_coach_user_id) score += 5
  if (row.program_level === 'intermediate') score += 10
  if (row.program_level === 'advanced' || row.program_level === 'competitor') score += 5
  return score
}

export function buildSuggestedCandidate(row: BeltPromotionRosterRow): BeltPromotionSuggestedCandidate {
  const ageGroup = ageGroupFromDate(row.date_of_birth)
  const radar = promotionRadar({
    program: row.program_level,
    currentBelt: row.current_belt,
    stripes: row.stripes,
    specialty: row.specialty,
    ageGroup,
    baselineDate: row.current_belt_promoted_at ?? row.profile_created_at,
    attendance90d: Number(row.attendance_90d ?? 0),
  })

  const currentStripes = normalizeStripes(row.stripes)
  let proposedDecision: BeltPromotionDecision = 'none'
  let proposedBelt: string | null = null
  let proposedStripes: number | null = null

  if (row.program_level === 'beginner' && radar.status === 'due') {
    proposedDecision = 'stripe'
    proposedStripes = Math.max(currentStripes, 2)
  } else if (row.program_level === 'intermediate' && radar.status === 'due') {
    if (currentStripes >= 4) {
      proposedDecision = 'belt'
      proposedBelt = nextBeltForAgeGroup(row.current_belt, ageGroup)
      proposedStripes = 0
    } else {
      proposedDecision = 'stripe'
      proposedStripes = Math.min(4, currentStripes + 1)
    }
  }

  return {
    member_user_id: row.user_id,
    athlete_name: fullName(row.first_name, row.last_name, row.email),
    member_id: row.member_id,
    role: row.role,
    age_group: ageGroup,
    priority_score: suggestionPriorityScore(row),
    current_belt: row.current_belt,
    current_stripes: currentStripes,
    program_level: row.program_level,
    specialty: row.specialty,
    reference_coach_user_id: row.reference_coach_user_id,
    reference_coach_name: row.reference_coach_name,
    promotion_label: radar.label,
    promotion_reason: radar.reason,
    proposed_decision: proposedDecision,
    proposed_belt: proposedBelt,
    proposed_stripes: proposedStripes,
    preparation_status: radar.status === 'due' ? 'approved' : radar.status === 'review' ? 'reviewed' : 'suggested',
    head_coach_note:
      proposedDecision === 'none'
        ? `${radar.label}. ${radar.nextAction}`
        : `${radar.label}. ${radar.reason}`,
  }
}

export function preparationTone(status: BeltPromotionPreparationStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'approved') return 'success'
  if (status === 'reviewed') return 'warning'
  if (status === 'hold') return 'danger'
  return 'neutral'
}

export function paymentTone(status: BeltPromotionPaymentStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'paid' || status === 'waived') return 'success'
  if (status === 'verify') return 'warning'
  if (status === 'pending') return 'danger'
  return 'neutral'
}

export function finalDecisionTone(status: BeltPromotionFinalDecision): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'confirmed') return 'success'
  if (status === 'deferred' || status === 'pending') return 'warning'
  if (status === 'rejected' || status === 'absent') return 'danger'
  return 'neutral'
}

export function decisionLabel(decision: BeltPromotionDecision, belt?: string | null, stripes?: number | null) {
  if (decision === 'belt') return belt ? `Belt → ${titleCase(belt)}` : 'Belt promotion'
  if (decision === 'stripe') return `Stripe → ${Number(stripes ?? 0)}`
  return 'No promotion'
}

export function liveState(candidate: Pick<BeltPromotionCandidateRow, 'attendance_status' | 'final_decision' | 'payment_status' | 'belt_delivered' | 'certificate_delivered'>): LiveCandidateState {
  if (candidate.attendance_status === 'absent' || candidate.final_decision === 'absent') return 'absent'
  if (
    candidate.attendance_status === 'present' &&
    (candidate.final_decision === 'confirmed' || candidate.final_decision === 'rejected' || candidate.final_decision === 'deferred') &&
    (candidate.payment_status === 'paid' || candidate.payment_status === 'waived' || candidate.final_decision !== 'confirmed')
  ) {
    return 'done'
  }
  if (candidate.attendance_status === 'present') return 'attention'
  return 'ready'
}

export function liveStateLabel(state: LiveCandidateState) {
  if (state === 'done') return 'Done'
  if (state === 'attention') return 'Needs action'
  if (state === 'absent') return 'Absent'
  return 'Ready'
}

export function liveStateTone(state: LiveCandidateState): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'done') return 'success'
  if (state === 'attention') return 'warning'
  if (state === 'absent') return 'danger'
  return 'neutral'
}

export function sortCandidatesForLive<T extends BeltPromotionCandidateRow & { athlete_name?: string | null; sort_rank?: number | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const stateRank = { attention: 0, ready: 1, done: 2, absent: 3 } as const
    const diff = stateRank[liveState(a)] - stateRank[liveState(b)]
    if (diff !== 0) return diff
    const sortDiff = Number(a.sort_rank ?? a.sort_order ?? 0) - Number(b.sort_rank ?? b.sort_order ?? 0)
    if (sortDiff !== 0) return sortDiff
    return String(a.athlete_name ?? '').localeCompare(String(b.athlete_name ?? ''))
  })
}

export function eventSummary(candidates: BeltPromotionCandidateRow[]) {
  return {
    total: candidates.length,
    approved: candidates.filter((row) => row.preparation_status === 'approved').length,
    reviewed: candidates.filter((row) => row.preparation_status === 'reviewed').length,
    hold: candidates.filter((row) => row.preparation_status === 'hold').length,
    paid: candidates.filter((row) => row.payment_status === 'paid').length,
    pendingPayment: candidates.filter((row) => row.payment_status === 'pending' || row.payment_status === 'verify').length,
    stripes: candidates.filter((row) => row.proposed_decision === 'stripe').length,
    belts: candidates.filter((row) => row.proposed_decision === 'belt').length,
    present: candidates.filter((row) => row.attendance_status === 'present').length,
    absent: candidates.filter((row) => row.attendance_status === 'absent').length,
    confirmed: candidates.filter((row) => row.final_decision === 'confirmed').length,
    deferred: candidates.filter((row) => row.final_decision === 'deferred').length,
    rejected: candidates.filter((row) => row.final_decision === 'rejected').length,
    deliveredBelts: candidates.filter((row) => row.belt_delivered).length,
    deliveredCertificates: candidates.filter((row) => row.certificate_delivered).length,
    applied: candidates.filter((row) => !!row.results_applied_at).length,
    pendingApply: candidates.filter((row) => row.final_decision === 'confirmed' && !row.results_applied_at).length,
  }
}

export function applyStateLabel(appliedAt?: string | null) {
  return appliedAt ? 'Applied' : 'Pending apply'
}

export function applyStateTone(appliedAt?: string | null): 'success' | 'warning' {
  return appliedAt ? 'success' : 'warning'
}


export function csvEscape(value: unknown) {
  const stringValue = String(value ?? '')
  if (stringValue.includes(',') || stringValue.includes('\"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}
export function csvDataHref(csv: string) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
}

export function buildEventCandidatesCsv<T extends BeltPromotionCandidateRow & {
  athlete_name?: string | null
  member_id?: string | null
  role?: string | null
  program_level?: string | null
  specialty?: string | null
  reference_coach_name?: string | null
  age_group?: string | null
}>(rows: T[]) {
  const headers = [
    'athlete_name',
    'member_id',
    'role',
    'age_group',
    'program_level',
    'specialty',
    'current_belt',
    'current_stripes',
    'proposed_decision',
    'proposed_belt',
    'proposed_stripes',
    'preparation_status',
    'attendance_status',
    'final_decision',
    'payment_status',
    'belt_delivered',
    'certificate_delivered',
    'reference_coach',
    'head_coach_note',
    'results_applied_at',
  ]
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push([
      row.athlete_name ?? '',
      row.member_id ?? '',
      row.role ?? '',
      row.age_group ?? '',
      row.program_level ?? '',
      row.specialty ?? '',
      row.current_belt ?? '',
      Number(row.current_stripes ?? 0),
      row.proposed_decision ?? '',
      row.proposed_belt ?? '',
      row.proposed_stripes ?? '',
      row.preparation_status ?? '',
      row.attendance_status ?? '',
      row.final_decision ?? '',
      row.payment_status ?? '',
      row.belt_delivered ? 'yes' : 'no',
      row.certificate_delivered ? 'yes' : 'no',
      row.reference_coach_name ?? '',
      row.head_coach_note ?? '',
      row.results_applied_at ?? '',
    ].map(csvEscape).join(','))
  }
  return lines.join('\n')
}

export function buildConfirmedResultsCsv<T extends BeltPromotionCandidateRow & {
  athlete_name?: string | null
  member_id?: string | null
  role?: string | null
  program_level?: string | null
  reference_coach_name?: string | null
}>(rows: T[]) {
  const confirmed = rows.filter((row) => row.final_decision === 'confirmed')
  const headers = [
    'athlete_name',
    'member_id',
    'role',
    'program_level',
    'current_belt',
    'current_stripes',
    'final_decision',
    'proposed_decision',
    'proposed_belt',
    'proposed_stripes',
    'payment_status',
    'belt_delivered',
    'certificate_delivered',
    'reference_coach',
    'results_applied_at',
  ]
  const lines = [headers.join(',')]
  for (const row of confirmed) {
    lines.push([
      row.athlete_name ?? '',
      row.member_id ?? '',
      row.role ?? '',
      row.program_level ?? '',
      row.current_belt ?? '',
      Number(row.current_stripes ?? 0),
      row.final_decision ?? '',
      row.proposed_decision ?? '',
      row.proposed_belt ?? '',
      row.proposed_stripes ?? '',
      row.payment_status ?? '',
      row.belt_delivered ? 'yes' : 'no',
      row.certificate_delivered ? 'yes' : 'no',
      row.reference_coach_name ?? '',
      row.results_applied_at ?? '',
    ].map(csvEscape).join(','))
  }
  return lines.join('\n')
}

export function buildApplyRunsCsv(rows: BeltPromotionApplyRunRow[]) {
  const headers = ['created_at', 'applied_count', 'stripe_count', 'belt_count', 'note_count', 'closed_event', 'applied_by', 'notes']
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push([
      row.created_at ?? '',
      row.applied_count,
      row.stripe_count,
      row.belt_count,
      row.note_count,
      row.closed_event ? 'yes' : 'no',
      row.applied_by ?? '',
      row.notes ?? '',
    ].map(csvEscape).join(','))
  }
  return lines.join('\n')
}
