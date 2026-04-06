import { NextResponse } from 'next/server'
import {
  accountActivationRowsToCsv,
  filterAccountActivationRows,
  sortAccountActivationRows,
  type AccountActivationAgeFilter,
  type AccountActivationSort,
} from '@/lib/accountActivation'
import { listAccountActivationRows } from '@/lib/accountActivationServer'
import { getSessionUserCached } from '@/lib/requestCache'

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

export async function GET(req: Request) {
  const me = await getSessionUserCached()
  if (!me) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'admin' && me.role !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').trim()
    const status = (url.searchParams.get('status') ?? '').trim()
    const age = (url.searchParams.get('age') ?? '').trim() as AccountActivationAgeFilter
    const sort = ((url.searchParams.get('sort') ?? '').trim() as AccountActivationSort) || 'priority'

    const rows = sortAccountActivationRows(
      filterAccountActivationRows(await listAccountActivationRows(), { q, status, age }),
      sort,
    )

    const csv = accountActivationRowsToCsv(rows)
    const stamp = new Date().toISOString().slice(0, 10)
    const suffix = [status, age, sort].filter(Boolean).map(safeFilePart).join('-')
    const filename = suffix
      ? `account-activation-${stamp}-${suffix}.csv`
      : `account-activation-${stamp}.csv`

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
