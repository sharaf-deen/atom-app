export type MemberProgramOption = {
  key: string
  name: string
  audience: string
  age_min: number | null
  age_max: number | null
  level: string
  sort_order: number
}

export const MEMBER_PROGRAM_ACTIVITY_TYPES = ['jiu_jitsu', 'competition', 'wrestling'] as const

const LEVEL_RANK: Record<string, number> = {
  beginner: 0,
  beginners: 0,
  intermediate: 1,
  intermediates: 1,
  advanced: 2,
  competitor: 3,
  competitors: 3,
}

function normalized(value: string) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function programAudienceRank(option: MemberProgramOption) {
  const audience = normalized(option.audience)
  const name = normalized(option.name)

  const explicitlyYouth =
    audience.includes('kid') ||
    audience.includes('child') ||
    audience.includes('youth') ||
    audience.includes('teen') ||
    name.includes('baby') ||
    name.includes('kid') ||
    name.includes('child') ||
    name.includes('youth') ||
    name.includes('teen') ||
    (option.age_max != null && option.age_max < 18)

  if (explicitlyYouth) return 0

  const explicitlyAdult =
    audience.includes('adult') ||
    name.includes('adult') ||
    name.includes('master') ||
    (option.age_min != null && option.age_min >= 18)

  if (explicitlyAdult) return 1
  return 2
}

function levelRank(level: string) {
  return LEVEL_RANK[normalized(level)] ?? 99
}

function levelAlreadyInName(name: string, level: string) {
  const normalizedName = ` ${normalized(name)} `
  const normalizedLevel = normalized(level)
  if (!normalizedLevel) return false

  const aliases: Record<string, string[]> = {
    beginner: ['beginner', 'beginners'],
    beginners: ['beginner', 'beginners'],
    intermediate: ['intermediate', 'intermediates'],
    intermediates: ['intermediate', 'intermediates'],
    advanced: ['advanced'],
    competitor: ['competitor', 'competitors', 'competition'],
    competitors: ['competitor', 'competitors', 'competition'],
  }

  const candidates = aliases[normalizedLevel] ?? [normalizedLevel]
  return candidates.some((candidate) => normalizedName.includes(` ${candidate} `))
}

export async function loadActiveMemberProgramOptions(admin: any): Promise<MemberProgramOption[]> {
  const { data, error } = await admin
    .from('schedule_class_templates')
    .select('series_key,name,audience,age_min,age_max,level,activity_type,sort_order')
    .eq('is_active', true)
    .in('activity_type', [...MEMBER_PROGRAM_ACTIVITY_TYPES])
    .order('sort_order', { ascending: true })
    .limit(500)

  if (error) throw new Error(error.message)

  const byKey = new Map<string, MemberProgramOption>()
  for (const row of data ?? []) {
    const key = String(row.series_key ?? '').trim()
    if (!key || byKey.has(key)) continue
    byKey.set(key, {
      key,
      name: String(row.name ?? key).trim() || key,
      audience: String(row.audience ?? 'all'),
      age_min: row.age_min == null ? null : Number(row.age_min),
      age_max: row.age_max == null ? null : Number(row.age_max),
      level: String(row.level ?? '').trim(),
      sort_order: Number(row.sort_order ?? 0),
    })
  }

  return [...byKey.values()].sort((a, b) => {
    const audienceDiff = programAudienceRank(a) - programAudienceRank(b)
    if (audienceDiff) return audienceDiff

    const ageMinA = a.age_min ?? 999
    const ageMinB = b.age_min ?? 999
    if (ageMinA !== ageMinB) return ageMinA - ageMinB

    const ageMaxA = a.age_max ?? 999
    const ageMaxB = b.age_max ?? 999
    if (ageMaxA !== ageMaxB) return ageMaxA - ageMaxB

    const nameDiff = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    if (nameDiff) return nameDiff

    const levelDiff = levelRank(a.level) - levelRank(b.level)
    if (levelDiff) return levelDiff

    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.key.localeCompare(b.key)
  })
}

export function memberProgramLabel(option: MemberProgramOption) {
  const level = option.level.trim()
  if (!level || levelAlreadyInName(option.name, level)) return option.name
  return `${option.name} · ${level}`
}
