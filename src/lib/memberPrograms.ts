export type MemberProgramOption = {
  key: string
  name: string
  audience: string
  age_min: number | null
  age_max: number | null
  level: string
  sort_order: number
}

export async function loadActiveMemberProgramOptions(admin: any): Promise<MemberProgramOption[]> {
  const { data, error } = await admin
    .from('member_program_catalog')
    .select('key,name,audience,age_min,age_max,level,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message)

  return (data ?? []).map((row: any) => ({
    key: String(row.key ?? '').trim(),
    name: String(row.name ?? row.key ?? '').trim(),
    audience: String(row.audience ?? 'all'),
    age_min: row.age_min == null ? null : Number(row.age_min),
    age_max: row.age_max == null ? null : Number(row.age_max),
    level: String(row.level ?? '').trim(),
    sort_order: Number(row.sort_order ?? 0),
  }))
}

export function memberProgramLabel(option: MemberProgramOption) {
  return option.name
}
