export type ProgramLevel = 'beginner' | 'intermediate' | 'advanced' | 'competitor'
export type AthleteSpecialty = 'kimono_only' | 'nogi_only' | 'both'
export type AthleteAgeGroup = 'kids' | 'adults' | 'unknown'
export type AttendanceBandKey = 'high' | 'steady' | 'low'
export type PromotionRadarStatus = 'blocked' | 'watch' | 'review' | 'due'
export type ReviewLane =
  | 'beginner_cycle'
  | 'intermediate_stripe'
  | 'intermediate_belt'
  | 'advanced_review'
  | 'competitor_review'
  | 'kimono_blocked'
  | 'profile_incomplete'

export type ReviewActionStatus = 'pending' | 'reviewed' | 'deferred' | 'approved' | 'hold'
export type ReviewQueueKey = 'action_now' | 'deferred' | 'logged' | 'watch'
export type RefinementStatus = 'ready_now' | 'competition_push' | 'build_more' | 'setup_missing' | 'watch'
export type CompetitionTier = 'inactive' | 'active' | 'podium'

export const PROGRAM_OPTIONS: ProgramLevel[] = ['beginner', 'intermediate', 'advanced', 'competitor']
export const SPECIALTY_OPTIONS: AthleteSpecialty[] = ['kimono_only', 'nogi_only', 'both']
export const REVIEW_LANES: ReviewLane[] = [
  'beginner_cycle',
  'intermediate_stripe',
  'intermediate_belt',
  'advanced_review',
  'competitor_review',
  'kimono_blocked',
  'profile_incomplete',
]
export const REVIEW_ACTION_STATUSES: ReviewActionStatus[] = ['pending', 'reviewed', 'deferred', 'approved', 'hold']
export const REFINEMENT_STATUSES: RefinementStatus[] = ['ready_now', 'competition_push', 'build_more', 'setup_missing', 'watch']
export const KIDS_BELTS = ['white', 'grey', 'yellow', 'orange', 'green'] as const
export const ADULT_BELTS = ['white', 'blue', 'purple', 'brown', 'black'] as const
export const ALL_BELTS = Array.from(new Set([...KIDS_BELTS, ...ADULT_BELTS]))

export type PromotionRadar = {
  status: PromotionRadarStatus
  lane: ReviewLane
  label: string
  reason: string
  nextAction: string
  dueDate: string | null
  monthsInCycle: number | null
}

export type ReviewQueueState = {
  key: ReviewQueueKey
  label: string
  reason: string
}

export type RefinementRadar = {
  status: RefinementStatus
  label: string
  reason: string
  nextAction: string
  dueDate: string | null
  competitionTier: CompetitionTier
  isPriority: boolean
}

export function titleCase(value: string | null | undefined) {
  return String(value ?? '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function fullName(firstName?: string | null, lastName?: string | null, fallback?: string | null) {
  const joined = [firstName ?? '', lastName ?? ''].join(' ').trim()
  return joined || fallback || 'Unnamed athlete'
}

export function parseDateOnly(value?: string | null) {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const iso = text.length === 10 ? `${text}T00:00:00Z` : text
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime()) ? null : dt
}

export function fmtDate(value?: string | null) {
  const dt = parseDateOnly(value)
  if (!dt) return '—'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(dt)
}

export function isoDateOnly(value?: string | null) {
  const dt = parseDateOnly(value)
  if (!dt) return null
  return dt.toISOString().slice(0, 10)
}

export function addMonthsDateOnly(value: string | null | undefined, monthsToAdd: number) {
  const dt = parseDateOnly(value)
  if (!dt) return null
  const year = dt.getUTCFullYear()
  const month = dt.getUTCMonth()
  const day = dt.getUTCDate()
  const shifted = new Date(Date.UTC(year, month + monthsToAdd + 1, 0))
  const safeDay = Math.min(day, shifted.getUTCDate())
  return new Date(Date.UTC(year, month + monthsToAdd, safeDay)).toISOString().slice(0, 10)
}

export function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

export function isFutureDateOnly(value?: string | null) {
  const date = isoDateOnly(value)
  if (!date) return false
  return date > todayDateOnly()
}

export function ageYears(dateOfBirth?: string | null) {
  const dob = parseDateOnly(dateOfBirth)
  if (!dob) return null
  const today = new Date()
  let age = today.getUTCFullYear() - dob.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth()
  const dayDiff = today.getUTCDate() - dob.getUTCDate()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1
  return age >= 0 ? age : null
}

export function ageGroupFromAge(age: number | null | undefined): AthleteAgeGroup {
  if (typeof age !== 'number' || !Number.isFinite(age)) return 'unknown'
  return age < 16 ? 'kids' : 'adults'
}

export function ageGroupFromDate(dateOfBirth?: string | null): AthleteAgeGroup {
  return ageGroupFromAge(ageYears(dateOfBirth))
}

export function beltTrackForAgeGroup(ageGroup: AthleteAgeGroup) {
  if (ageGroup === 'kids') return [...KIDS_BELTS]
  if (ageGroup === 'adults') return [...ADULT_BELTS]
  return [...ALL_BELTS]
}

export function nextBeltForAgeGroup(currentBelt: string | null | undefined, ageGroup: AthleteAgeGroup) {
  const track = beltTrackForAgeGroup(ageGroup)
  const idx = track.findIndex((belt) => belt === currentBelt)
  if (idx < 0 || idx >= track.length - 1) return null
  return track[idx + 1]
}

export function monthsSince(dateValue?: string | null) {
  const dt = parseDateOnly(dateValue)
  if (!dt) return null
  const today = new Date()
  const yearDiff = today.getUTCFullYear() - dt.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - dt.getUTCMonth()
  let months = yearDiff * 12 + monthDiff
  if (today.getUTCDate() < dt.getUTCDate()) months -= 1
  return Math.max(months, 0)
}

export function attendanceBand(attendance90d: number): { key: AttendanceBandKey; label: string; tone: 'success' | 'warning' | 'danger' } {
  if (attendance90d >= 18) return { key: 'high', label: 'High', tone: 'success' }
  if (attendance90d >= 8) return { key: 'steady', label: 'Steady', tone: 'warning' }
  return { key: 'low', label: 'Low', tone: 'danger' }
}

export function isKimonoEligible(specialty: AthleteSpecialty | null | undefined, ageGroup: AthleteAgeGroup) {
  if (specialty === 'nogi_only') return false
  if (ageGroup === 'kids') return specialty === 'kimono_only' || specialty === 'both' || specialty == null
  return specialty === 'kimono_only' || specialty === 'both'
}

export function promotionRadar(args: {
  program: ProgramLevel | null | undefined
  currentBelt: string | null | undefined
  stripes: number | null | undefined
  specialty: AthleteSpecialty | null | undefined
  ageGroup: AthleteAgeGroup
  baselineDate: string | null | undefined
  attendance90d: number
}) : PromotionRadar {
  const stripes = Math.max(0, Math.min(4, Number(args.stripes ?? 0)))
  const months = monthsSince(args.baselineDate)
  const kimonoEligible = isKimonoEligible(args.specialty, args.ageGroup)
  const nextBelt = nextBeltForAgeGroup(args.currentBelt, args.ageGroup)

  if (!kimonoEligible) {
    return {
      status: 'blocked',
      lane: 'kimono_blocked',
      label: 'Promotion blocked',
      reason: 'No belt or stripe promotion without kimono training.',
      nextAction: 'Switch specialty to Kimono only or Both.',
      dueDate: null,
      monthsInCycle: months,
    }
  }

  if ((args.program ?? null) === 'beginner') {
    const dueDate = addMonthsDateOnly(args.baselineDate ?? null, 6)
    if ((months ?? 0) >= 6) {
      if ((args.currentBelt ?? 'white') === 'white' && stripes < 2) {
        return {
          status: 'due',
          lane: 'beginner_cycle',
          label: 'White 2 stripes due',
          reason: 'Beginner athlete reached the 6-month review window.',
          nextAction: 'Review readiness, then award stripes up to white 2.',
          dueDate,
          monthsInCycle: months,
        }
      }
      return {
        status: 'review',
        lane: 'beginner_cycle',
        label: 'Intermediate review due',
        reason: 'Beginner athlete reached the 6-month review window.',
        nextAction: 'Discuss with the reference coach and evaluate move to Intermediate.',
        dueDate,
        monthsInCycle: months,
      }
    }

    return {
      status: 'watch',
      lane: 'beginner_cycle',
      label: 'Tracking beginner cycle',
      reason: 'Still inside the first 6-month beginner window.',
      nextAction: 'Keep attendance and kimono consistency on track.',
      dueDate,
      monthsInCycle: months,
    }
  }

  if ((args.program ?? null) === 'intermediate') {
    const targetMonths = Math.max(1, stripes + 1) * 6
    const dueDate = addMonthsDateOnly(args.baselineDate ?? null, targetMonths)
    if ((months ?? 0) >= targetMonths) {
      if (stripes >= 4) {
        return {
          status: 'due',
          lane: 'intermediate_belt',
          label: nextBelt ? `${titleCase(nextBelt)} belt review` : 'Belt review due',
          reason: 'Intermediate athlete completed the stripe cycle.',
          nextAction: nextBelt ? `Review promotion to ${titleCase(nextBelt)} belt.` : 'Review next belt promotion.',
          dueDate,
          monthsInCycle: months,
        }
      }
      return {
        status: 'due',
        lane: 'intermediate_stripe',
        label: `Stripe ${stripes + 1} due`,
        reason: 'Intermediate athlete reached the next 6-month stripe checkpoint.',
        nextAction: 'Review attendance, kimono work, and technical progress.',
        dueDate,
        monthsInCycle: months,
      }
    }

    return {
      status: 'watch',
      lane: stripes >= 4 ? 'intermediate_belt' : 'intermediate_stripe',
      label: 'Intermediate cycle active',
      reason: 'Next stripe checkpoint has not been reached yet.',
      nextAction: 'Keep attendance and technical consistency high.',
      dueDate,
      monthsInCycle: months,
    }
  }

  if ((args.program ?? null) === 'advanced') {
    return {
      status: args.attendance90d < 8 ? 'watch' : 'review',
      lane: 'advanced_review',
      label: args.attendance90d < 8 ? 'Low attendance watch' : 'Coach review lane',
      reason: args.attendance90d < 8
        ? 'Advanced athletes need attendance consistency before the next review.'
        : 'Promotion remains coach-led in the Advanced track.',
      nextAction: args.attendance90d < 8
        ? 'Increase mat time before the next promotion review.'
        : 'Use attendance, notes, and competition results for the next review.',
      dueDate: null,
      monthsInCycle: months,
    }
  }

  if ((args.program ?? null) === 'competitor') {
    return {
      status: args.attendance90d < 8 ? 'watch' : 'review',
      lane: 'competitor_review',
      label: args.attendance90d < 8 ? 'Attendance watch' : 'Competitor review lane',
      reason: args.attendance90d < 8
        ? 'Competitor athletes need strong attendance consistency.'
        : 'Competitor promotions remain head-coach led.',
      nextAction: args.attendance90d < 8
        ? 'Increase mat time before the next competitor review.'
        : 'Use results, attendance, and coach notes for the next review.',
      dueDate: null,
      monthsInCycle: months,
    }
  }

  return {
    status: 'watch',
    lane: 'profile_incomplete',
    label: 'Profile incomplete',
    reason: 'Program or belt data is still incomplete.',
    nextAction: 'Complete the athlete profile first.',
    dueDate: null,
    monthsInCycle: months,
  }
}

export function refinementRadar(args: {
  program: ProgramLevel | null | undefined
  attendance90d: number
  competitionCount: number
  podiumCount: number
  latestCompetitionDate: string | null | undefined
  hasReferenceCoach: boolean
  hasCoachNote: boolean
  baselineDate: string | null | undefined
}): RefinementRadar {
  const program = args.program ?? null
  const competitionTier: CompetitionTier = args.podiumCount > 0 ? 'podium' : args.competitionCount > 0 ? 'active' : 'inactive'

  if (program !== 'advanced' && program !== 'competitor') {
    return {
      status: 'watch',
      label: 'Standard lane',
      reason: 'Advanced / Competitor refinement applies only to upper-track athletes.',
      nextAction: 'Use the standard review lane for this athlete.',
      dueDate: null,
      competitionTier,
      isPriority: false,
    }
  }

  const dueDate = addMonthsDateOnly(args.latestCompetitionDate ?? args.baselineDate ?? null, program === 'competitor' ? 4 : 6)

  if (!args.hasReferenceCoach || !args.hasCoachNote) {
    return {
      status: 'setup_missing',
      label: 'Setup missing',
      reason: !args.hasReferenceCoach && !args.hasCoachNote
        ? 'Upper-track athletes need both a reference coach and an active coach note.'
        : !args.hasReferenceCoach
          ? 'Assign a reference coach before the next upper-track review.'
          : 'Add a fresh coach note before the next upper-track review.',
      nextAction: !args.hasReferenceCoach ? 'Assign the reference coach first.' : 'Log a current coach note.',
      dueDate,
      competitionTier,
      isPriority: true,
    }
  }

  if (program === 'advanced') {
    if (args.attendance90d >= 14 && (args.competitionCount > 0 || ((monthsSince(args.baselineDate) ?? 0) >= 6))) {
      return {
        status: 'ready_now',
        label: 'Advanced ready',
        reason: args.competitionCount > 0
          ? 'Advanced athlete combines good attendance with recent competition data.'
          : 'Advanced athlete completed a solid review cycle with strong attendance.',
        nextAction: 'Run a full advanced-track review with technique, maturity, and leadership criteria.',
        dueDate,
        competitionTier,
        isPriority: true,
      }
    }

    if (args.attendance90d >= 10 || args.competitionCount > 0) {
      return {
        status: 'competition_push',
        label: 'Advanced building',
        reason: 'This advanced athlete is moving in the right direction but is not fully review-ready yet.',
        nextAction: args.competitionCount > 0
          ? 'Consolidate the last competition cycle with stronger attendance.'
          : 'Keep mat time high and collect more coach evidence before the next review.',
        dueDate,
        competitionTier,
        isPriority: false,
      }
    }

    return {
      status: 'build_more',
      label: 'Attendance build-up',
      reason: 'Advanced athletes need stronger attendance before a serious review.',
      nextAction: 'Raise consistency over the next 4 to 6 weeks.',
      dueDate,
      competitionTier,
      isPriority: false,
    }
  }

  if (args.attendance90d >= 16 && (args.podiumCount > 0 || args.competitionCount >= 2)) {
    return {
      status: 'ready_now',
      label: 'Competitor ready',
      reason: args.podiumCount > 0
        ? 'Competitor athlete has podium results and strong mat consistency.'
        : 'Competitor athlete has enough recent competition volume and attendance for a high-level review.',
      nextAction: 'Run a competitor review using performance, activity, and leadership signals.',
      dueDate,
      competitionTier,
      isPriority: true,
    }
  }

  if (args.attendance90d >= 12 && args.competitionCount > 0) {
    return {
      status: 'competition_push',
      label: 'Competition push',
      reason: 'Competitor athlete is active but still building toward the next full review.',
      nextAction: 'Keep attendance high and convert the next competition cycle into stronger evidence.',
      dueDate,
      competitionTier,
      isPriority: false,
    }
  }

  return {
    status: 'build_more',
    label: 'Competitor build-up',
    reason: 'Competitor lane needs both stronger attendance and more competition evidence.',
    nextAction: args.competitionCount === 0
      ? 'Enter or log more competition activity before the next review.'
      : 'Raise training consistency before the next competitor review.',
    dueDate,
    competitionTier,
    isPriority: false,
  }
}

export function reviewQueueState(args: {
  promotion: PromotionRadar
  latestAction?: { action_status: ReviewActionStatus | null; action_date?: string | null; snoozed_until?: string | null } | null
}): ReviewQueueState {
  const actionStatus = args.latestAction?.action_status ?? null
  const snoozedUntil = isoDateOnly(args.latestAction?.snoozed_until ?? null)

  if (actionStatus === 'deferred' && isFutureDateOnly(snoozedUntil)) {
    return {
      key: 'deferred',
      label: 'Deferred',
      reason: snoozedUntil ? `Deferred until ${fmtDate(snoozedUntil)}.` : 'Deferred review is still active.',
    }
  }

  if (actionStatus === 'reviewed' || actionStatus === 'approved' || actionStatus === 'hold') {
    return {
      key: 'logged',
      label: titleCase(actionStatus),
      reason: 'Latest manual review decision is already logged.',
    }
  }

  if (args.promotion.status === 'due' || args.promotion.status === 'review' || args.promotion.status === 'blocked') {
    return {
      key: 'action_now',
      label: 'Action now',
      reason: args.promotion.nextAction,
    }
  }

  return {
    key: 'watch',
    label: 'Watch',
    reason: 'No immediate review action needed.',
  }
}
