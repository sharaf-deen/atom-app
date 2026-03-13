import { formatDateTimeInCairo } from '@/lib/cairoTime'

type AdminClient = any

type AttendanceBaseRow = {
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

export type ScanAuditRecord = {
  id: string
  date: string | null
  scanned_at: string | null
  scanned_at_cairo: string
  status: string | null
  valid: boolean | null
  device_tag: string | null
  member_id: string | null
  member_code: string | null
  member_email: string | null
  member_first_name: string | null
  member_last_name: string | null
  scanned_by: string | null
  scanned_by_role: string | null
  scanned_by_email: string | null
  scanned_by_first_name: string | null
  scanned_by_last_name: string | null
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
  page?: number
  perPage?: number
  maxFetch?: number
}

export type ScanAuditResult = {
  rows: ScanAuditRecord[]
  total: number
  totalPages: number
  page: number
  truncated: boolean
}

const DEFAULT_MAX_FETCH = 5000
const FETCH_BATCH = 1000

function norm(v?: string | null) {
  return (v ?? '').trim().toLowerCase()
}

function fmtName(first?: string | null, last?: string | null) {
  return [first ?? '', last ?? ''].join(' ').trim()
}

function isKioskLike(row: AttendanceBaseRow) {
  return row.source === 'kiosk' || !!row.scanned_by || !!row.device_tag
}

function compareNullableText(a?: string | null, b?: string | null, asc = true) {
  const aa = (a ?? '').toLowerCase()
  const bb = (b ?? '').toLowerCase()
  const cmp = aa.localeCompare(bb)
  return asc ? cmp : -cmp
}

function compareScannedAtDesc(a: ScanAuditRecord, b: ScanAuditRecord) {
  const at = a.scanned_at ? new Date(a.scanned_at).getTime() : 0
  const bt = b.scanned_at ? new Date(b.scanned_at).getTime() : 0
  return bt - at
}

async function fetchAttendanceRows(admin: AdminClient, args: ScanAuditFilters) {
  const maxFetch = Math.max(1, Math.min(args.maxFetch ?? DEFAULT_MAX_FETCH, 20000))
  const rows: AttendanceBaseRow[] = []
  let from = 0
  let truncated = false

  while (rows.length < maxFetch) {
    let qb = admin
      .from('attendance')
      .select('id,date,scanned_at,status,valid,device_tag,member_id,scanned_by,source')
      .or('source.eq.kiosk,scanned_by.not.is.null,device_tag.not.is.null')

    if (args.start) qb = qb.gte('date', args.start)
    if (args.end) qb = qb.lte('date', args.end)
    if (args.status) qb = qb.eq('status', args.status)
    if (args.device) qb = qb.eq('device_tag', args.device)

    if (args.sort === 'device_asc') qb = qb.order('device_tag', { ascending: true }).order('scanned_at', { ascending: false })
    else if (args.sort === 'device_desc') qb = qb.order('device_tag', { ascending: false }).order('scanned_at', { ascending: false })
    else qb = qb.order('scanned_at', { ascending: false })

    const to = Math.min(from + FETCH_BATCH - 1, maxFetch - 1)
    const { data, error } = await qb.range(from, to)
    if (error) throw new Error(error.message)

    const batch = (data ?? []) as AttendanceBaseRow[]
    rows.push(...batch)

    if (batch.length < FETCH_BATCH) break
    from += FETCH_BATCH

    if (rows.length >= maxFetch) {
      truncated = true
      break
    }
  }

  return { rows, truncated }
}

async function fetchProfilesByUserIds(admin: AdminClient, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  const map = new Map<string, ProfileLite>()

  if (!uniqueIds.length) return map

  for (let i = 0; i < uniqueIds.length; i += FETCH_BATCH) {
    const chunk = uniqueIds.slice(i, i + FETCH_BATCH)
    const { data, error } = await admin
      .from('profiles')
      .select('user_id,member_id,email,first_name,last_name,role')
      .in('user_id', chunk)

    if (error) throw new Error(error.message)

    for (const row of (data ?? []) as ProfileLite[]) {
      map.set(row.user_id, row)
    }
  }

  return map
}

export async function getScanAuditData(admin: AdminClient, args: ScanAuditFilters = {}): Promise<ScanAuditResult> {
  const page = Math.max(1, Number(args.page ?? 1) || 1)
  const perPage = Math.max(1, Math.min(Number(args.perPage ?? 50) || 50, 200))
  const q = norm(args.q)
  const scannedByRole = norm(args.scannedByRole)

  const { rows: attendanceRows, truncated } = await fetchAttendanceRows(admin, args)
  const kioskRows = attendanceRows.filter(isKioskLike)

  const ids = kioskRows.flatMap((row) => [row.member_id ?? '', row.scanned_by ?? ''])
  const profiles = await fetchProfilesByUserIds(admin, ids)

  let enriched: ScanAuditRecord[] = kioskRows.map((row) => {
    const member = row.member_id ? profiles.get(row.member_id) : undefined
    const scanner = row.scanned_by ? profiles.get(row.scanned_by) : undefined

    return {
      id: row.id,
      date: row.date,
      scanned_at: row.scanned_at,
      scanned_at_cairo: formatDateTimeInCairo(row.scanned_at),
      status: row.status,
      valid: row.valid,
      device_tag: row.device_tag,
      member_id: row.member_id,
      member_code: member?.member_id ?? null,
      member_email: member?.email ?? null,
      member_first_name: member?.first_name ?? null,
      member_last_name: member?.last_name ?? null,
      scanned_by: row.scanned_by,
      scanned_by_role: scanner?.role ?? null,
      scanned_by_email: scanner?.email ?? null,
      scanned_by_first_name: scanner?.first_name ?? null,
      scanned_by_last_name: scanner?.last_name ?? null,
      source: row.source,
    }
  })

  if (scannedByRole) {
    enriched = enriched.filter((row) => norm(row.scanned_by_role) === scannedByRole)
  }

  if (q) {
    enriched = enriched.filter((row) => {
      const blob = [
        row.member_code,
        row.member_email,
        row.member_first_name,
        row.member_last_name,
        row.member_id,
        row.scanned_by_email,
        row.scanned_by_first_name,
        row.scanned_by_last_name,
        row.scanned_by,
        row.scanned_by_role,
        row.device_tag,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return blob.includes(q)
    })
  }

  if (args.sort === 'device_asc') {
    enriched.sort((a, b) => compareNullableText(a.device_tag, b.device_tag, true) || compareScannedAtDesc(a, b))
  } else if (args.sort === 'device_desc') {
    enriched.sort((a, b) => compareNullableText(a.device_tag, b.device_tag, false) || compareScannedAtDesc(a, b))
  } else {
    enriched.sort(compareScannedAtDesc)
  }

  const total = enriched.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const startIndex = (page - 1) * perPage
  const paged = enriched.slice(startIndex, startIndex + perPage)

  return {
    rows: paged,
    total,
    totalPages,
    page,
    truncated,
  }
}

export function formatScanAuditMember(row: ScanAuditRecord) {
  return fmtName(row.member_first_name, row.member_last_name) || row.member_email || row.member_code || row.member_id || '—'
}

export function formatScanAuditScanner(row: ScanAuditRecord) {
  return fmtName(row.scanned_by_first_name, row.scanned_by_last_name) || row.scanned_by_email || row.scanned_by || '—'
}
