import { NextResponse } from 'next/server'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { formatScanAuditMember, formatScanAuditScanner, getScanAuditData } from '@/lib/scanAudit'
import { cairoTodayDateOnly } from '@/lib/cairoTime'

function csvEscape(v: unknown): string {
  const s = (v ?? '').toString()
  const escaped = s.replace(/"/g, '""')
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`
  return escaped
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
  const limit = clamp(Number(url.searchParams.get('limit') ?? 5000), 1, 20000)

  const supabase = getSupabaseAdminClientCached()

  try {
    const data = await getScanAuditData(supabase, {
      q,
      status,
      device,
      scannedByRole,
      start,
      end,
      sort,
      page: 1,
      perPage: limit,
      maxFetch: limit,
    })

    const header = [
      'scanned_at_egypt',
      'date',
      'status',
      'valid',
      'device_tag',
      'member_code',
      'member_name',
      'member_email',
      'scanner_role',
      'scanner_name',
      'scanner_email',
      'source',
    ]

    const lines = [header.map(csvEscape).join(',')]

    for (const row of data.rows) {
      lines.push(
        [
          row.scanned_at_cairo,
          row.date ?? '',
          row.status ?? '',
          row.valid ? 'true' : 'false',
          row.device_tag ?? '',
          row.member_code ?? '',
          formatScanAuditMember(row),
          row.member_email ?? '',
          row.scanned_by_role ?? '',
          formatScanAuditScanner(row),
          row.scanned_by_email ?? '',
          row.source ?? '',
        ]
          .map(csvEscape)
          .join(',')
      )
    }

    const csv = lines.join('\n')
    const stamp = cairoTodayDateOnly()
    const filename = `scan-audit-${stamp}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'export_failed' }, { status: 500 })
  }
}
