import { cairoToday } from '@/lib/cairoDate'
import { roleLabel as appRoleLabel, type Role } from '@/lib/rbac'

export type AthleteProgramLevel = 'beginner' | 'intermediate' | 'advanced' | 'competitor'
export type AthleteSpecialty = 'kimono_only' | 'nogi_only' | 'both'
export type AthletePromotionStatus = 'not_ready' | 'eligible_review' | 'due' | 'blocked' | 'unknown'
export type AthleteAgeGroup = 'kids' | 'adults' | 'unknown'

export const ATHLETE_SCOPE_ROLES = ['member', 'coach', 'assistant_coach', 'vip', 'champion'] as const satisfies readonly Role[]
export const ATHLETE_PROGRAM_OPTIONS = ['beginner', 'intermediate', 'advanced', 'competitor'] as const satisfies readonly AthleteProgramLevel[]
export const ATHLETE_SPECIALTY_OPTIONS = ['kimono_only', 'nogi_only', 'both'] as const satisfies readonly AthleteSpecialty[]
export const KID_BELTS = ['white', 'grey', 'yellow', 'orange', 'green'] as const
export const ADULT_BELTS = ['white', 'blue', 'purple', 'brown', 'black'] as const

export function athleteRoleLabel(role: Role | null | undefined) {
  return appRoleLabel(role)
}

export function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function programLabel(value?: AthleteProgramLevel | null) {
  return value ? titleCase(value) : '—'
}

export function specialtyLabel(value?: AthleteSpecialty | null) {
  switch (value) {
    case 'kimono_only':
      return 'Kimono only'
    case 'nogi_only':
      return 'NoGi only'
    case 'both':
      return 'Kimono + NoGi'
    default:
      return 'Not set'
  }
}

export function beltLabel(value?: string | null) {
  if (!value) return 'Not set'
  if (value === 'grey') return 'Gray'
  return titleCase(value)
}

export function isAthleteProgram(value: unknown): value is AthleteProgramLevel {
  return typeof value === 'string' && (ATHLETE_PROGRAM_OPTIONS as readonly string[]).includes(value)
}

export function isAthleteSpecialty(value: unknown): value is AthleteSpecialty {
  return typeof value === 'string' && (ATHLETE_SPECIALTY_OPTIONS as readonly string[]).includes(value)
}

export function athleteAgeGroup(age?: number | null): AthleteAgeGroup {
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 0) return 'unknown'
  return age < 17 ? 'kids' : 'adults'
}

export function ageLabel(age?: number | null) {
  const group = athleteAgeGroup(age)
  if (group === 'kids') return typeof age === 'number' ? `Kid · ${age}y` : 'Kid'
  if (group === 'adults') return typeof age === 'number' ? `Adult · ${age}y` : 'Adult'
  return 'Age unknown'
}

export function kimonoEligibility(args: { age?: number | null; specialty?: AthleteSpecialty | null }) {
  const group = athleteAgeGroup(args.age)
  const specialty = args.specialty ?? null

  if (!specialty) {
    return {
      eligible: false,
      blocked: true,
      label: 'Specialty not set',
      hint: 'Set the athlete specialty to track kimono-based promotion eligibility.',
    }
  }

  if (group === 'kids') {
    if (specialty === 'nogi_only') {
      return {
        eligible: false,
        blocked: true,
        label: 'Kimono required',
        hint: 'Kids training must include kimono to stay promotion-eligible.',
      }
    }

    return {
      eligible: true,
      blocked: false,
      label: 'Kimono eligible',
      hint: 'Kids are promotion-eligible when kimono training is present.',
    }
  }

  if (group === 'adults') {
    if (specialty === 'nogi_only') {
      return {
        eligible: false,
        blocked: true,
        label: 'NoGi only',
        hint: 'Adults can train NoGi only, but belt and stripe promotions stay blocked without kimono.',
      }
    }

    return {
      eligible: true,
      blocked: false,
      label: 'Kimono eligible',
      hint: 'Kimono training is available, so promotions can be reviewed.',
    }
  }

  return {
    eligible: false,
    blocked: true,
    label: 'Age unknown',
    hint: 'Set date of birth to classify the athlete as kid or adult for promotion tracking.',
  }
}

export function monthsBetween(from?: string | null, to: string = cairoToday()) {
  if (!from) return null
  const a = from.slice(0, 10)
  const b = to.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null

  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)

  let months = (by - ay) * 12 + (bm - am)
  if (bd < ad) months -= 1
  return months < 0 ? 0 : months
}

export function attendanceBand(attendance90d: number): {
  key: 'high' | 'steady' | 'low'
  label: string
  tone: 'success' | 'warning' | 'danger'
} {
  if (attendance90d >= 20) return { key: 'high', label: 'High', tone: 'success' }
  if (attendance90d >= 10) return { key: 'steady', label: 'Steady', tone: 'warning' }
  return { key: 'low', label: 'Low', tone: 'danger' }
}

export function nextBeltForAge(currentBelt: string | null | undefined, age?: number | null) {
  const group = athleteAgeGroup(age)
  const track = group === 'kids' ? KID_BELTS : group === 'adults' ? ADULT_BELTS : null
  if (!track?.length) return null
  const belt = currentBelt ?? 'white'
  const idx = track.indexOf(belt as any)
  if (idx < 0) return track[0]
  return track[Math.min(idx + 1, track.length - 1)]
}

export function promotionRadar(args: {
  program?: AthleteProgramLevel | null
  age?: number | null
  specialty?: AthleteSpecialty | null
  currentBelt?: string | null
  stripes?: number | null
  baselineDate?: string | null
  attendance90d?: number | null
  competitionCount?: number | null
  today?: string
}) {
  const program = args.program ?? null
  const stripes = Math.max(0, Math.min(4, Number(args.stripes ?? 0)))
  const attendance90d = Math.max(0, Number(args.attendance90d ?? 0))
  const competitionCount = Math.max(0, Number(args.competitionCount ?? 0))
  const kimono = kimonoEligibility({ age: args.age, specialty: args.specialty ?? null })
  const elapsedMonths = monthsBetween(args.baselineDate ?? null, args.today ?? cairoToday())

  if (!program) {
    return {
      status: 'unknown' as AthletePromotionStatus,
      label: 'Program missing',
      hint: 'Set the athlete program to unlock promotion tracking.',
    }
  }

  if (kimono.blocked) {
    return {
      status: 'blocked' as AthletePromotionStatus,
      label: kimono.label,
      hint: kimono.hint,
    }
  }

  if (elapsedMonths === null) {
    return {
      status: 'unknown' as AthletePromotionStatus,
      label: 'Timeline missing',
      hint: 'A join date or latest promotion date is needed to estimate timing windows.',
    }
  }

  if (program === 'beginner') {
    if (stripes >= 2) {
      return {
        status: 'eligible_review' as AthletePromotionStatus,
        label: 'Intermediate review',
        hint: 'Beginner athlete already has the expected white belt stripes. Review readiness for Intermediate with the reference coach.',
      }
    }

    if (elapsedMonths >= 6) {
      return {
        status: 'due' as AthletePromotionStatus,
        label: 'White 2 stripes review',
        hint: 'Beginner athlete reached the 6-month timing window. Review white belt 2 stripes and discuss the next program step.',
      }
    }

    if (elapsedMonths >= 5) {
      return {
        status: 'eligible_review' as AthletePromotionStatus,
        label: 'Review soon',
        hint: 'The 6-month beginner checkpoint is approaching.',
      }
    }

    return {
      status: 'not_ready' as AthletePromotionStatus,
      label: 'On track',
      hint: 'Still building toward the first 6-month beginner review.',
    }
  }

  if (program === 'intermediate') {
    if (stripes >= 4) {
      return {
        status: 'due' as AthletePromotionStatus,
        label: `${beltLabel(nextBeltForAge(args.currentBelt ?? 'white', args.age))} belt review`,
        hint: 'Intermediate athlete already reached 4 stripes. Review the next belt promotion.',
      }
    }

    const completedSixMonthBlocks = Math.floor(elapsedMonths / 6)
    if (completedSixMonthBlocks > stripes) {
      return {
        status: 'due' as AthletePromotionStatus,
        label: `Stripe ${stripes + 1} review`,
        hint: 'Intermediate athlete passed another 6-month checkpoint and may be ready for the next stripe.',
      }
    }

    if (completedSixMonthBlocks === stripes && elapsedMonths >= 5) {
      return {
        status: 'eligible_review' as AthletePromotionStatus,
        label: 'Stripe review soon',
        hint: 'The next 6-month stripe checkpoint is approaching.',
      }
    }

    return {
      status: 'not_ready' as AthletePromotionStatus,
      label: 'On track',
      hint: 'Intermediate timing is still within the current stripe cycle.',
    }
  }

  if (program === 'advanced') {
    if (attendance90d >= 14 || competitionCount > 0) {
      return {
        status: 'eligible_review' as AthletePromotionStatus,
        label: 'Coach review',
        hint: 'Advanced athlete shows enough activity to justify a technical review.',
      }
    }

    return {
      status: 'not_ready' as AthletePromotionStatus,
      label: 'Track progress',
      hint: 'Keep monitoring advanced attendance and technical progression.',
    }
  }

  if (program === 'competitor') {
    if (competitionCount >= 2 || attendance90d >= 18) {
      return {
        status: 'eligible_review' as AthletePromotionStatus,
        label: 'Competition review',
        hint: 'Competitor activity is high enough for a focused performance review.',
      }
    }

    return {
      status: 'not_ready' as AthletePromotionStatus,
      label: 'Build volume',
      hint: 'Keep building mat time and competition experience.',
    }
  }

  return {
    status: 'unknown' as AthletePromotionStatus,
    label: 'Not set',
    hint: 'Program rules are not configured yet.',
  }
}
