import { NextResponse } from 'next/server'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { fetchScanAuditExportRows, formatDateTimeCairo, cairoDateStamp } from '@/lib/scanAudit'

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
  const { rows, error } = await fetchScanAuditExportRows(supabase, {
    q,
    status,
    device,
    scannedByRole,
    start,
    end,
    sort,
    limit,
  })

  if (error) return NextResponse.json({ ok: false, error }, { status: 500 })

  const header = [
    'scanned_at_egypt',
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
    lines.push(
      [
        formatDateTimeCairo(r.scanned_at),
        r.date ?? '',
        r.status ?? '',
        r.valid ? 'true' : 'false',
        r.device_tag ?? '',
        r.member_code ?? '',
        r.member_name,
        r.member_email ?? '',
        r.scanned_by_role ?? '',
        r.scanned_by_name,
        r.scanned_by_email ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }

  const csv = lines.join('\n')
  const filename = `scan-audit-${cairoDateStamp()}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
