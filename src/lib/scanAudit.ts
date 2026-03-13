import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type ProfileLite = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type AttendanceLite = {
  id: string
  date: string
  scanned_at: string | null
  status: string
  valid: boolean | null
  device_tag: string | null
  member_id: string
  scanned_by: string | null
  source: string | null
}

export type ScanAuditFilters = {
  q?: string
  status?: string
  device?: string
  scannedByRole?: string
  start?: string
  end?: string
  sort?: string
  limit?: number
}

export type ScanAuditRow = {
  id: string
  date: string
  scanned_at: string | null
  status: string
  valid: boolean | null
  device_tag: string | null
  source: string | null
  member_id: string
  scanned_by: string | null
  member_code: string | null
  member_email: string | null
  member_first_name: string | null
  member_last_name: string | null
  member_role: string | null
  scanned_by_email: string | null
  scanned_by_first_name: string | null
  scanned_by_last_name: string | null
  scanned_by_role: string | null
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function safeText(v?: string | null) {
  return (v ?? '').trim().toLowerCase()
}

function fmtName(first?: string | null, last?: string | null) {
  return [first ?? '', last ?? ''].join(' ').trim()
}

function compareNullable(a?: string | null, b?: string | null, ascending = true) {
  const av = a ?? ''
  const bv = b ?? ''
  const cmp = av.localeCompare(bv)
  return ascending ? cmp : -cmp
}

function compareDateDesc(a?: string | null, b?: string | null) {
  const at = a ? new Date(a).getTime() : 0
  const bt = b ? new Date(b).getTime() : 0
  return bt - at
}

export async function fetchScanAuditRows(filters: ScanAuditFilters): Promise<ScanAuditRow[]> {
  const supabase = createSupabaseAdminClient()
  const q = (filters.q ?? '').trim()
  const status = (filters.status ?? '').trim()
  const device = (filters.device ?? '').trim()
  const scannedByRole = (filters.scannedByRole ?? '').trim()
  const start = (filters.start ?? '').trim()
  const end = (filters.end ?? '').trim()
  const sort = (filters.sort ?? 'recent').trim() || 'recent'
  const limit = clamp(Number(filters.limit ?? 5000) || 5000, 1, 20000)

  let qb = supabase
    .from('attendance')
    .select('id,date,scanned_at,status,valid,device_tag,member_id,scanned_by,source')
    .or('source.eq.kiosk,scanned_by.not.is.null,device_tag.not.is.null')
    .limit(limit)

  if (start) qb = qb.gte('date', start)
  if (end) qb = qb.lte('date', end)
  if (status) qb = qb.eq('status', status)
  if (device) qb = qb.eq('device_tag', device)

  // Keep DB-side ordering stable; final sorting happens after enrichment too.
  qb = qb.order('scanned_at', { ascending: false })

  const { data, error } = await qb
  if (error) throw new Error(error.message)

  const attendanceRows = ((data ?? []) as AttendanceLite[]).filter(Boolean)
  if (attendanceRows.length === 0) return []

  const profileIds = Array.from(
    new Set(
      attendanceRows
        .flatMap((row) => [row.member_id, row.scanned_by])
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    )
  )

  const profilesById = new Map<string, ProfileLite>()

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id,member_id,email,first_name,last_name,role')
      .in('user_id', profileIds)

    if (profilesError) throw new Error(profilesError.message)

    for (const p of (profiles ?? []) as ProfileLite[]) {
      profilesById.set(p.user_id, p)
    }
  }

  let rows: ScanAuditRow[] = attendanceRows.map((row) => {
    const member = profilesById.get(row.member_id)
    const scanner = row.scanned_by ? profilesById.get(row.scanned_by) : undefined

    return {
      id: row.id,
      date: row.date,
      scanned_at: row.scanned_at,
      status: row.status,
      valid: row.valid,
      device_tag: row.device_tag,
      source: row.source,
      member_id: row.member_id,
      scanned_by: row.scanned_by,
      member_code: member?.member_id ?? null,
      member_email: member?.email ?? null,
      member_first_name: member?.first_name ?? null,
      member_last_name: member?.last_name ?? null,
      member_role: member?.role ?? null,
      scanned_by_email: scanner?.email ?? null,
      scanned_by_first_name: scanner?.first_name ?? null,
      scanned_by_last_name: scanner?.last_name ?? null,
      scanned_by_role: scanner?.role ?? null,
    }
  })

  if (scannedByRole) {
    rows = rows.filter((row) => (row.scanned_by_role ?? '') === scannedByRole)
  }

  if (q) {
    const needle = safeText(q)
    rows = rows.filter((row) => {
      const haystacks = [
        row.member_code,
        row.member_email,
        row.member_first_name,
        row.member_last_name,
        fmtName(row.member_first_name, row.member_last_name),
        row.scanned_by_email,
        row.scanned_by_first_name,
        row.scanned_by_last_name,
        fmtName(row.scanned_by_first_name, row.scanned_by_last_name),
        row.device_tag,
        row.source,
      ]

      return haystacks.some((value) => safeText(value).includes(needle))
    })
  }

  if (sort === 'device_asc') {
    rows.sort((a, b) => {
      const deviceCmp = compareNullable(a.device_tag, b.device_tag, true)
      if (deviceCmp !== 0) return deviceCmp
      return compareDateDesc(a.scanned_at, b.scanned_at)
    })
  } else if (sort === 'device_desc') {
    rows.sort((a, b) => {
      const deviceCmp = compareNullable(a.device_tag, b.device_tag, false)
      if (deviceCmp !== 0) return deviceCmp
      return compareDateDesc(a.scanned_at, b.scanned_at)
    })
  } else {
    rows.sort((a, b) => compareDateDesc(a.scanned_at, b.scanned_at))
  }

  return rows
}
