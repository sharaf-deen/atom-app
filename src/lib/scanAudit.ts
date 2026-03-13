import 'server-only'

const CAIRO_TZ = 'Africa/Cairo'

export type ScanAuditFilters = {
  q?: string
  status?: string
  device?: string
  scannedByRole?: string
  start?: string
  end?: string
  sort?: string
}

type AttendanceAuditRow = {
  id: string
  date: string | null
  scanned_at: string | null
  status: string | null
  valid: boolean | null
  device_tag: string | null
  member_id: string | null
  scanned_by: string | null
  source: string | null
}

type ProfileLite = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

export type ScanAuditRow = {
  id: string
  date: string | null
  scanned_at: string | null
  status: string | null
  valid: boolean
  device_tag: string | null
  member_id: string | null
  member_code: string | null
  member_email: string | null
  member_first_name: string | null
  member_last_name: string | null
  member_name: string
  scanned_by: string | null
  scanned_by_role: string | null
  scanned_by_email: string | null
  scanned_by_first_name: string | null
  scanned_by_last_name: string | null
  scanned_by_name: string
  source: string | null
}

function asText(v: unknown) {
  return typeof v === 'string' ? v : ''
}

function norm(v: unknown) {
  return asText(v).trim().toLowerCase()
}

function fmtName(first?: string | null, last?: string | null) {
  const value = [first ?? '', last ?? ''].join(' ').trim()
  return value || '—'
}

function buildSearchBlob(row: ScanAuditRow) {
  return [
    row.device_tag,
    row.member_code,
    row.member_email,
    row.member_first_name,
    row.member_last_name,
    row.member_name,
    row.scanned_by_role,
    row.scanned_by_email,
    row.scanned_by_first_name,
    row.scanned_by_last_name,
    row.scanned_by_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function compareRows(sort: string, a: ScanAuditRow, b: ScanAuditRow) {
  if (sort === 'device_asc') {
    const byDevice = (a.device_tag ?? '').localeCompare(b.device_tag ?? '')
    if (byDevice !== 0) return byDevice
  }

  if (sort === 'device_desc') {
    const byDevice = (b.device_tag ?? '').localeCompare(a.device_tag ?? '')
    if (byDevice !== 0) return byDevice
  }

  const ta = a.scanned_at ? new Date(a.scanned_at).getTime() : 0
  const tb = b.scanned_at ? new Date(b.scanned_at).getTime() : 0
  return tb - ta
}

async function loadBaseRows(supabase: any, filters: ScanAuditFilters, hardLimit: number) {
  let qb = supabase
    .from('attendance')
    .select('id,date,scanned_at,status,valid,device_tag,member_id,scanned_by,source')
    .or('source.eq.kiosk,scanned_by.not.is.null,device_tag.not.is.null')
    .limit(hardLimit)

  if (filters.start) qb = qb.gte('date', filters.start)
  if (filters.end) qb = qb.lte('date', filters.end)
  if (filters.status) qb = qb.eq('status', filters.status)
  if (filters.device) qb = qb.eq('device_tag', filters.device)

  if (filters.sort === 'device_asc') qb = qb.order('device_tag', { ascending: true }).order('scanned_at', { ascending: false })
  else if (filters.sort === 'device_desc') qb = qb.order('device_tag', { ascending: false }).order('scanned_at', { ascending: false })
  else qb = qb.order('scanned_at', { ascending: false })

  const { data, error } = await qb
  if (error) return { rows: [] as AttendanceAuditRow[], error: error.message }
  return { rows: (data ?? []) as AttendanceAuditRow[], error: null as string | null }
}

async function loadProfiles(supabase: any, rows: AttendanceAuditRow[]) {
  const ids = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.member_id, r.scanned_by])
        .filter((v): v is string => !!v)
    )
  )

  if (ids.length === 0) return new Map<string, ProfileLite>()

  const { data } = await supabase
    .from('profiles')
    .select('user_id,member_id,email,first_name,last_name,role')
    .in('user_id', ids)
    .limit(ids.length)

  const map = new Map<string, ProfileLite>()
  for (const p of (data ?? []) as ProfileLite[]) {
    map.set(p.user_id, p)
  }
  return map
}

function enrichRows(rows: AttendanceAuditRow[], profiles: Map<string, ProfileLite>) {
  return rows.map((r): ScanAuditRow => {
    const member = r.member_id ? profiles.get(r.member_id) : null
    const scanner = r.scanned_by ? profiles.get(r.scanned_by) : null

    const memberName = [member?.first_name ?? '', member?.last_name ?? ''].join(' ').trim() || member?.email || member?.member_id || r.member_id || '—'
    const scannerName = [scanner?.first_name ?? '', scanner?.last_name ?? ''].join(' ').trim() || scanner?.email || r.scanned_by || '—'

    return {
      id: r.id,
      date: r.date,
      scanned_at: r.scanned_at,
      status: r.status,
      valid: !!r.valid,
      device_tag: r.device_tag,
      member_id: r.member_id,
      member_code: member?.member_id ?? null,
      member_email: member?.email ?? null,
      member_first_name: member?.first_name ?? null,
      member_last_name: member?.last_name ?? null,
      member_name: memberName,
      scanned_by: r.scanned_by,
      scanned_by_role: scanner?.role ?? null,
      scanned_by_email: scanner?.email ?? null,
      scanned_by_first_name: scanner?.first_name ?? null,
      scanned_by_last_name: scanner?.last_name ?? null,
      scanned_by_name: scannerName,
      source: r.source,
    }
  })
}

function applyFilters(rows: ScanAuditRow[], filters: ScanAuditFilters) {
  let next = rows

  if (filters.scannedByRole) {
    const wanted = norm(filters.scannedByRole)
    next = next.filter((r) => norm(r.scanned_by_role) === wanted)
  }

  if (filters.q) {
    const wanted = norm(filters.q)
    next = next.filter((r) => buildSearchBlob(r).includes(wanted))
  }

  const sort = filters.sort || 'recent'
  return [...next].sort((a, b) => compareRows(sort, a, b))
}

export async function fetchScanAuditPage(
  supabase: any,
  filters: ScanAuditFilters & { page: number; perPage: number; limit?: number }
) {
  const hardLimit = Math.max(filters.limit ?? 5000, filters.page * filters.perPage)
  const base = await loadBaseRows(supabase, filters, hardLimit)
  if (base.error) return { rows: [] as ScanAuditRow[], total: 0, error: base.error }

  const profiles = await loadProfiles(supabase, base.rows)
  const filtered = applyFilters(enrichRows(base.rows, profiles), filters)

  const startIndex = Math.max(0, (filters.page - 1) * filters.perPage)
  const endIndex = startIndex + filters.perPage

  return {
    rows: filtered.slice(startIndex, endIndex),
    total: filtered.length,
    error: null as string | null,
  }
}

export async function fetchScanAuditExportRows(
  supabase: any,
  filters: ScanAuditFilters & { limit: number }
) {
  const base = await loadBaseRows(supabase, filters, filters.limit)
  if (base.error) return { rows: [] as ScanAuditRow[], error: base.error }

  const profiles = await loadProfiles(supabase, base.rows)
  const filtered = applyFilters(enrichRows(base.rows, profiles), filters)

  return {
    rows: filtered.slice(0, filters.limit),
    error: null as string | null,
  }
}

export function formatDateTimeCairo(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '00'
  const day = parts.find((p) => p.type === 'day')?.value ?? '00'
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const second = parts.find((p) => p.type === 'second')?.value ?? '00'

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export function cairoDateStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '00'
  const day = parts.find((p) => p.type === 'day')?.value ?? '00'
  return `${year}-${month}-${day}`
}
