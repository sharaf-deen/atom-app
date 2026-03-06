import { NextResponse } from 'next/server'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

function csvEscape(v: unknown): string {
  const s = (v ?? '').toString()
  // Escape double quotes by doubling them
  const escaped = s.replace(/"/g, '""')
  // Wrap in quotes if it contains special chars
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`
  return escaped
}

function toDateOnly(d: string): string {
  // Expect YYYY-MM-DD; fallback to input
  return d
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function GET(req: Request) {
  const me = await getSessionUserCached()
  if (!me) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'admin' && me.role !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const status = (url.searchParams.get('status') ?? '').trim()
  const device = (url.searchParams.get('device') ?? '').trim()
  const scannedByRole = (url.searchParams.get('scanned_by_role') ?? '').trim()
  const start = (url.searchParams.get('start') ?? '').trim()
  const end = (url.searchParams.get('end') ?? '').trim()
  const sort = (url.searchParams.get('sort') ?? 'recent').trim()

  // Optional hard limit for export
  const limit = clamp(Number(url.searchParams.get('limit') ?? 5000), 1, 20000)

  const supabase = getSupabaseAdminClientCached()

  let qb = supabase
    .from('scan_audit')
    .select(
      'id,date,scanned_at,status,valid,device_tag,member_code,member_email,member_first_name,member_last_name,scanned_by_role,scanned_by_email,scanned_by_first_name,scanned_by_last_name'
    )
    .limit(limit)

  if (start) qb = qb.gte('date', toDateOnly(start))
  if (end) qb = qb.lte('date', toDateOnly(end))
  if (status) qb = qb.eq('status', status)
  if (device) qb = qb.eq('device_tag', device)
  if (scannedByRole) qb = qb.eq('scanned_by_role', scannedByRole)

  if (q) {
    const like = `%${q}%`
    qb = qb.or(
      [
        `member_code.ilike.${like}`,
        `member_email.ilike.${like}`,
        `member_first_name.ilike.${like}`,
        `member_last_name.ilike.${like}`,
        `scanned_by_email.ilike.${like}`,
        `scanned_by_first_name.ilike.${like}`,
        `scanned_by_last_name.ilike.${like}`,
        `device_tag.ilike.${like}`,
      ].join(',')
    )
  }

  // Sorting
  if (sort === 'device_asc') qb = qb.order('device_tag', { ascending: true }).order('scanned_at', { ascending: false })
  else if (sort === 'device_desc') qb = qb.order('device_tag', { ascending: false }).order('scanned_at', { ascending: false })
  else qb = qb.order('scanned_at', { ascending: false })

  const { data, error } = await qb
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const rows = data ?? []

  const header = [
    'scanned_at',
    'date',
    'status',
    'valid',
    'device_tag',
    'member_code',
    'member_name',
    'member_email',
    'scanned_by_role',
    'scanned_by_name',
    'scanned_by_email',
  ]

  const lines = [header.map(csvEscape).join(',')]

  for (const r of rows) {
    const memberName = [r.member_first_name, r.member_last_name].filter(Boolean).join(' ').trim()
    const scannerName = [r.scanned_by_first_name, r.scanned_by_last_name].filter(Boolean).join(' ').trim()
    lines.push(
      [
        r.scanned_at ?? '',
        r.date ?? '',
        r.status ?? '',
        r.valid ? 'true' : 'false',
        r.device_tag ?? '',
        r.member_code ?? '',
        memberName,
        r.member_email ?? '',
        r.scanned_by_role ?? '',
        scannerName,
        r.scanned_by_email ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }

  const csv = lines.join('\n')
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `scan-audit-${stamp}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
