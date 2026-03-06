// src/app/admin/scan-audit/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'

import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { cairoTodayDateOnly, addDaysDateOnly, cairoRangeBoundsUTC, CAIRO_TZ, isISODateOnly } from '@/lib/cairoTime'

const PER_PAGE = 50

type AttendanceRow = {
  id: string
  scan_time: string | null
  date: string
  status: string
  member_id: string
  scanned_by: string | null
  device_tag: string | null
  valid: boolean | null
  from_sessions: boolean
  subscription_id: string | null
  source: string
}

type ProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  member_id: string | null
}

function fullName(p?: ProfileRow | null) {
  const a = (p?.first_name ?? '').trim()
  const b = (p?.last_name ?? '').trim()
  const n = `${a} ${b}`.trim()
  return n || (p?.email ?? '') || '—'
}

function fmtCairo(tsIso: string | null) {
  if (!tsIso) return '—'
  try {
    const dt = new Date(tsIso)
    return dt.toLocaleString('en-GB', {
      timeZone: CAIRO_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function statusPill(status: string, valid: boolean | null) {
  const s = (status || '').toLowerCase().trim()

  let cls = 'bg-[hsl(var(--muted-foreground))/0.06] text-[hsl(var(--muted-foreground))]'
  if (valid) cls = 'bg-emerald-500/10 text-emerald-700'
  if (!valid && (s.includes('expired') || s.includes('no') || s.includes('deny') || s.includes('invalid'))) {
    cls = 'bg-rose-500/10 text-rose-700'
  }
  if (s.includes('frozen')) cls = 'bg-amber-500/10 text-amber-700'
  if (s === 'ok') cls = 'bg-emerald-500/10 text-emerald-700'

  return <Badge className={cls}>{status || (valid ? 'ok' : 'deny')}</Badge>
}

function clampPage(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.trunc(n))
}

function pickRange(args: { period?: string; from?: string; to?: string }) {
  const today = cairoTodayDateOnly()
  const p = (args.period ?? 'today').trim()

  if (p === 'last7') return { from: addDaysDateOnly(today, -6), to: today, period: 'last7' }
  if (p === 'last30') return { from: addDaysDateOnly(today, -29), to: today, period: 'last30' }
  if (p === 'custom') {
    const from = isISODateOnly(args.from) ? args.from : addDaysDateOnly(today, -6)
    const to = isISODateOnly(args.to) ? args.to : today
    return { from, to, period: 'custom' }
  }

  return { from: today, to: today, period: 'today' }
}

export default async function ScanAuditPage({
  searchParams,
}: {
  searchParams?: { period?: string; from?: string; to?: string; q?: string; status?: string; device?: string; page?: string }
}) {
  const user = await getSessionUser()
  const nextPath = '/admin/scan-audit'

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return (
      <Forbidden
        pageTitle="Scan Audit"
        subtitle="Admins only."
        nextPath={nextPath}
        allowed="admin, super_admin"
        signedInAs={user?.email ?? null}
        actions={[{ href: '/', label: 'Go Home' }]}
      />
    )
  }

  const admin = createSupabaseAdminClient()

  const q = (searchParams?.q ?? '').trim()
  const status = (searchParams?.status ?? 'all').trim()
  const device = (searchParams?.device ?? '').trim()
  const page = clampPage(searchParams?.page ?? '1')

  const range = pickRange({ period: searchParams?.period, from: searchParams?.from, to: searchParams?.to })
  const bounds = cairoRangeBoundsUTC(range.from, range.to)

  // Optional: resolve member ids from q (member_id / email / name)
  let memberIds: string[] | null = null
  if (q) {
    const like = `%${q}%`
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('user_id')
      .or(`member_id.ilike.${like},email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(250)

    if (!profErr && prof?.length) {
      memberIds = Array.from(new Set(prof.map((r: any) => String(r.user_id)).filter(Boolean)))
    } else {
      memberIds = []
    }
  }

  const fromIdx = (page - 1) * PER_PAGE
  const toIdx = fromIdx + PER_PAGE // inclusive => PER_PAGE + 1 rows

  let query = admin
    .from('attendance')
    .select('id, scan_time, date, status, member_id, scanned_by, device_tag, valid, from_sessions, subscription_id, source')
    .eq('source', 'kiosk')
    .gte('scan_time', bounds.startISO)
    .lt('scan_time', bounds.endISO)
    .order('scan_time', { ascending: false })
    .range(fromIdx, toIdx)

  if (status !== 'all') query = query.eq('status', status)
  if (device) query = query.ilike('device_tag', `%${device}%`)
  if (memberIds) {
    if (!memberIds.length) {
      query = query.in('member_id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      query = query.in('member_id', memberIds.slice(0, 250))
    }
  }

  const { data, error } = await query
  if (error) {
    return (
      <>
        <PageHeader title="Scan Audit" subtitle="Kiosk scan log (attendance events)" />
        <Section className="space-y-3">
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700">
            Failed to load: {error.message}
          </div>
        </Section>
      </>
    )
  }

  const rows = (data ?? []) as any as AttendanceRow[]
  const hasMore = rows.length > PER_PAGE
  const pageRows = rows.slice(0, PER_PAGE)

  const memberSet = new Set<string>()
  const staffSet = new Set<string>()
  for (const r of pageRows) {
    if (r.member_id) memberSet.add(r.member_id)
    if (r.scanned_by) staffSet.add(r.scanned_by)
  }
  const lookupIds = Array.from(new Set([...memberSet, ...staffSet]))

  const { data: profRows } = await admin
    .from('profiles')
    .select('user_id, first_name, last_name, email, member_id')
    .in('user_id', lookupIds)
    .limit(1000)

  const profMap = new Map<string, ProfileRow>()
  for (const p of (profRows ?? []) as any[]) {
    profMap.set(String(p.user_id), p as ProfileRow)
  }

  const tableColumns = [
    { key: 'time', header: 'Time' },
    { key: 'member', header: 'Member' },
    { key: 'status', header: 'Status' },
    { key: 'device', header: 'Device', hideOnMobile: true },
    { key: 'by', header: 'Scanned by', hideOnMobile: true },
    { key: 'notes', header: 'Notes', hideOnMobile: true },
  ]

  const tableRows = pageRows.map((r) => {
    const member = profMap.get(r.member_id) ?? null
    const staff = r.scanned_by ? profMap.get(r.scanned_by) ?? null : null
    const memberLabel = (
      <div className="min-w-0">
        <div className="truncate font-medium">{fullName(member)}</div>
        <div className="truncate text-[11px] text-[hsl(var(--muted))]">
          {(member?.member_id ?? '—') + (member?.email ? ` • ${member.email}` : '')}
        </div>
      </div>
    )

    const staffLabel = staff ? (
      <div className="min-w-0">
        <div className="truncate font-medium">{fullName(staff)}</div>
        <div className="truncate text-[11px] text-[hsl(var(--muted))]">{staff.email ?? '—'}</div>
      </div>
    ) : (
      <span className="text-[hsl(var(--muted))]">—</span>
    )

    const notes: string[] = []
    if (r.from_sessions) notes.push('sessions')
    if (r.subscription_id) notes.push('sub')
    if (r.valid === false) notes.push('denied')
    if (r.source && r.source !== 'kiosk') notes.push(r.source)

    return {
      id: r.id,
      time: fmtCairo(r.scan_time),
      member: memberLabel,
      status: statusPill(r.status, r.valid),
      device: r.device_tag ?? '—',
      by: staffLabel,
      notes: notes.length ? notes.join(' • ') : '—',
    }
  })

  // Preserve filters in pagination links
  const keep = new URLSearchParams()
  keep.set('period', range.period)
  if (range.period === 'custom') {
    keep.set('from', range.from)
    keep.set('to', range.to)
  }
  if (q) keep.set('q', q)
  if (status) keep.set('status', status)
  if (device) keep.set('device', device)

  const prevHref = page > 1 ? `${nextPath}?${new URLSearchParams({ ...Object.fromEntries(keep), page: String(page - 1) })}` : null
  const nextHref = hasMore ? `${nextPath}?${new URLSearchParams({ ...Object.fromEntries(keep), page: String(page + 1) })}` : null

  return (
    <>
      <PageHeader title="Scan Audit" subtitle="Kiosk scan log (attendance events)" />

      <Section className="space-y-3">
        <form className="grid gap-3 sm:grid-cols-4" action={nextPath} method="get">
          <Select name="period" label="Period" defaultValue={range.period}>
            <option value="today">Today</option>
            <option value="last7">Last 7 days</option>
            <option value="last30">Last 30 days</option>
            <option value="custom">Custom</option>
          </Select>

          <Input name="from" label="From (YYYY-MM-DD)" defaultValue={range.period === 'custom' ? range.from : ''} />
          <Input name="to" label="To (YYYY-MM-DD)" defaultValue={range.period === 'custom' ? range.to : ''} />

          <Select name="status" label="Status" defaultValue={status}>
            <option value="all">All</option>
            <option value="ok">ok</option>
            <option value="expired">expired</option>
            <option value="frozen">frozen</option>
            <option value="no_subscription">no_subscription</option>
            <option value="invalid">invalid</option>
          </Select>

          <Input name="q" label="Member search" placeholder="Name, email, member_id…" defaultValue={q} />
          <Input name="device" label="Device tag" placeholder="Entrance iPad…" defaultValue={device} />

          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" className="w-full sm:w-auto">
              Apply
            </Button>
            <Link href={nextPath} className="text-sm text-[hsl(var(--muted))] hover:underline">
              Reset
            </Link>
          </div>
        </form>
      </Section>

      <Section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[hsl(var(--muted))]">
            Showing page <span className="font-medium text-[hsl(var(--foreground))]">{page}</span>
          </div>

          <div className="flex items-center gap-2">
            {prevHref ? (
              <Link href={prevHref}>
                <Button variant="outline">Prev</Button>
              </Link>
            ) : (
              <Button variant="outline" disabled>
                Prev
              </Button>
            )}

            {nextHref ? (
              <Link href={nextHref}>
                <Button variant="outline">Next</Button>
              </Link>
            ) : (
              <Button variant="outline" disabled>
                Next
              </Button>
            )}
          </div>
        </div>

        <Table columns={tableColumns} rows={tableRows} keyField="id" />
      </Section>
    </>
  )
}
