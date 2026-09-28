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
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name)
  })
}

export function memberProgramLabel(option: MemberProgramOption) {
  const details = [option.level].filter(Boolean).join(' · ')
  return details ? `${option.name} · ${details}` : option.name
}
