export type ProgramLevel = 'beginner' | 'intermediate' | 'advanced' | 'competitor'
export type AthleteSpecialty = 'kimono_only' | 'nogi_only' | 'both'
export type AthleteAgeGroup = 'kids' | 'adults' | 'unknown'
export type AttendanceBandKey = 'high' | 'steady' | 'low'
export type PromotionRadarStatus = 'blocked' | 'watch' | 'review' | 'due'

export const PROGRAM_OPTIONS: ProgramLevel[] = ['beginner', 'intermediate', 'advanced', 'competitor']
export const SPECIALTY_OPTIONS: AthleteSpecialty[] = ['kimono_only', 'nogi_only', 'both']
export const KIDS_BELTS = ['white', 'grey', 'yellow', 'orange', 'green'] as const
export const ADULT_BELTS = ['white', 'blue', 'purple', 'brown', 'black'] as const
export const ALL_BELTS = Array.from(new Set([...KIDS_BELTS, ...ADULT_BELTS]))

export type PromotionRadar = {
  status: PromotionRadarStatus
  label: string
  reason: string
  nextAction: string
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
      label: 'Promotion blocked',
      reason: 'No belt or stripe promotion without kimono training.',
      nextAction: 'Switch specialty to Kimono only or Both.',
    }
  }

  if ((args.program ?? null) === 'beginner') {
    if ((months ?? 0) >= 6) {
      if ((args.currentBelt ?? 'white') === 'white' && stripes < 2) {
        return {
          status: 'due',
          label: 'White 2 stripes due',
          reason: 'Beginner athlete reached the 6-month review window.',
          nextAction: 'Review readiness, then award stripes up to white 2.',
        }
      }
      return {
        status: 'review',
        label: 'Intermediate review due',
        reason: 'Beginner athlete reached the 6-month review window.',
        nextAction: 'Discuss with the reference coach and evaluate move to Intermediate.',
      }
    }

    return {
      status: 'watch',
      label: 'Tracking beginner cycle',
      reason: 'Still inside the first 6-month beginner window.',
      nextAction: 'Keep attendance and kimono consistency on track.',
    }
  }

  if ((args.program ?? null) === 'intermediate') {
    const targetMonths = Math.max(1, stripes + 1) * 6
    if ((months ?? 0) >= targetMonths) {
      if (stripes >= 4) {
        return {
          status: 'due',
          label: nextBelt ? `${titleCase(nextBelt)} belt review` : 'Belt review due',
          reason: 'Intermediate athlete completed the stripe cycle.',
          nextAction: nextBelt ? `Review promotion to ${titleCase(nextBelt)} belt.` : 'Review next belt promotion.',
        }
      }
      return {
        status: 'due',
        label: `Stripe ${stripes + 1} due`,
        reason: 'Intermediate athlete reached the next 6-month stripe checkpoint.',
        nextAction: 'Review attendance, kimono work, and technical progress.',
      }
    }

    return {
      status: 'watch',
      label: 'Intermediate cycle active',
      reason: 'Next stripe checkpoint has not been reached yet.',
      nextAction: 'Keep attendance and technical consistency high.',
    }
  }

  if ((args.program ?? null) === 'advanced' || (args.program ?? null) === 'competitor') {
    if (args.attendance90d < 8) {
      return {
        status: 'watch',
        label: 'Low attendance watch',
        reason: 'Advanced and competitor athletes need attendance consistency.',
        nextAction: 'Increase mat time before the next promotion review.',
      }
    }

    return {
      status: 'review',
      label: 'Coach review lane',
      reason: 'Promotion remains coach-led in Advanced / Competitor tracks.',
      nextAction: 'Use competition results, attendance, and coach notes for the next review.',
    }
  }

  return {
    status: 'watch',
    label: 'Profile incomplete',
    reason: 'Program or belt data is still incomplete.',
    nextAction: 'Complete the athlete profile first.',
  }
}
