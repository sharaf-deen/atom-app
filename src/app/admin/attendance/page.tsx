// src/app/admin/attendance/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import InlineAlert from '@/components/ui/InlineAlert'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'

import InactiveNotifyClient from './inactive-notify-client'

import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { addDaysDateOnly, cairoTodayDateOnly } from '@/lib/cairoTime'

const CAIRO_TZ = 'Africa/Cairo'

type AttendanceRow = {
  member_id: string
  date: string
  valid: boolean
}

type ProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  member_id: string | null
}

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.trunc(v)))
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function fmtPct(n: number, d: number) {
  if (!d) return '0%'
  const p = Math.round((n / d) * 100)
  return `${p}%`
}

function fmtName(p: ProfileRow | undefined | null) {
  if (!p) return 'Member'
  const name = [p.first_name ?? '', p.last_name ?? ''].join(' ').trim()
  return name || p.email || p.member_id || 'Member'
}

export default async function AttendanceDashboard({
  searchParams,
}: {
  searchParams?: { period?: string; from?: string; to?: string; inactiveDays?: string }
}) {
  const user = await getSessionUserCached()
  const nextPath = '/admin/attendance'

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return (
      <Forbidden
        pageTitle="Attendance"
        subtitle="Admins only."
        nextPath={nextPath}
        allowed="admin, super_admin"
        signedInAs={user?.email ?? null}
        actions={[{ href: '/', label: 'Go Home' }]}
      />
    )
  }

  const today = cairoTodayDateOnly()
  const period = (searchParams?.period ?? 'last14').trim()
  const inactiveDays = clampInt(Number(searchParams?.inactiveDays ?? 14), 7, 60)

  let from = today
  let to = today

  if (period === 'today') {
    from = today
    to = today
  } else if (period === 'last7') {
    from = addDaysDateOnly(today, -6)
    to = today
  } else if (period === 'last30') {
    from = addDaysDateOnly(today, -29)
    to = today
  } else if (period === 'custom') {
    const f = (searchParams?.from ?? '').trim()
    const t = (searchParams?.to ?? '').trim()
    if (isISODateOnly(f) && isISODateOnly(t) && f <= t) {
      from = f
      to = t
    } else {
      from = addDaysDateOnly(today, -13)
      to = today
    }
  } else {
    // default last14
    from = addDaysDateOnly(today, -13)
    to = today
  }

  let loadError: string | null = null
  let rows: AttendanceRow[] = []
  let daySeries: { date: string; total: number; valid: number; invalid: number }[] = []
  let topRows: { member_id: string; count: number }[] = []
  let inactiveMemberIds: string[] = []
  const profiles = new Map<string, ProfileRow>()

  try {
    const admin = getSupabaseAdminClientCached()

    // Attendance rows in range (for series + totals + top)
    const { data: att, error: attErr } = await admin
      .from('attendance')
      .select('member_id,date,valid')
      .gte('date', from)
      .lte('date', to)
      .limit(100000)

    if (attErr) throw new Error(attErr.message)
    rows = (att ?? []) as any

    // Build day series
    const byDay = new Map<string, { total: number; valid: number }>()
    for (const r of rows) {
      const d = (r.date ?? '').slice(0, 10)
      if (!d) continue
      const cur = byDay.get(d) ?? { total: 0, valid: 0 }
      cur.total += 1
      if (r.valid) cur.valid += 1
      byDay.set(d, cur)
    }

    const dates: string[] = []
    for (let d = from; d <= to; d = addDaysDateOnly(d, 1)) dates.push(d)

    daySeries = dates.map((d) => {
      const v = byDay.get(d) ?? { total: 0, valid: 0 }
      const invalid = Math.max(0, v.total - v.valid)
      return { date: d, total: v.total, valid: v.valid, invalid }
    })

    // Top attendees (valid check-ins count)
    const byMember = new Map<string, number>()
    for (const r of rows) {
      if (!r.valid) continue
      const id = r.member_id
      if (!id) continue
      byMember.set(id, (byMember.get(id) ?? 0) + 1)
    }
    topRows = Array.from(byMember.entries())
      .map(([member_id, count]) => ({ member_id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    // Active members list (for inactivity)
    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('member_id, subscription_type, status, start_date, end_date')
      .eq('status', 'active')
      .limit(100000)

    if (subErr) throw new Error(subErr.message)

    const activeMembers = new Set<string>()
    for (const s of subs ?? []) {
      const mid = (s as any).member_id as string | null
      if (!mid) continue
      const type = (s as any).subscription_type as string | null
      if (type === 'time') {
        const sd = (s as any).start_date as string | null
        const ed = (s as any).end_date as string | null
        if (!sd || !ed) continue
        if (sd <= today && ed >= today) activeMembers.add(mid)
      } else {
        // sessions or others
        activeMembers.add(mid)
      }
    }

    // Attendance last N days (valid only) for active members
    const fromInact = addDaysDateOnly(today, -(inactiveDays - 1))
    const { data: recent, error: recErr } = await admin
      .from('attendance')
      .select('member_id,date,valid')
      .gte('date', fromInact)
      .lte('date', today)
      .eq('valid', true)
      .limit(100000)

    if (recErr) throw new Error(recErr.message)

    const lastValid = new Map<string, string>() // member_id -> last date
    for (const r of recent ?? []) {
      const mid = (r as any).member_id as string | null
      const d = ((r as any).date as string | null)?.slice(0, 10) ?? ''
      if (!mid || !d) continue
      const prev = lastValid.get(mid)
      if (!prev || d > prev) lastValid.set(mid, d)
    }

    inactiveMemberIds = Array.from(activeMembers)
      .filter((mid) => !lastValid.has(mid))
      .slice(0, 200)

    // Load profiles for top + inactive
    const ids = Array.from(new Set([...topRows.map((t) => t.member_id), ...inactiveMemberIds])).filter(Boolean)
    if (ids.length > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('user_id, first_name, last_name, email, phone, member_id')
        .in('user_id', ids)
        .limit(10000)

      if (pErr) throw new Error(pErr.message)
      for (const p of profs ?? []) profiles.set((p as any).user_id, p as any)
    }
  } catch (e: any) {
    loadError = e?.message ?? String(e)
  }

  // Stats
  let valid = 0
  const uniqueMembers = new Set<string>()
  const uniqueValidMembers = new Set<string>()
  for (const row of rows) {
    if (row.member_id) uniqueMembers.add(row.member_id)
    if (row.valid) {
      valid += 1
      if (row.member_id) uniqueValidMembers.add(row.member_id)
    }
  }
  const total = rows.length
  const invalid = total - valid
  const unique = uniqueMembers.size
  const uniqueValid = uniqueValidMembers.size

  const exportHref = `/api/admin/export/attendance?from=${from}&to=${to}`

  const filters = (
    <form className="flex flex-col gap-3 md:flex-row md:items-end" action={nextPath} method="get">
      <div className="w-full md:w-56">
        <Select name="period" defaultValue={period} label="Period">
          <option value="today">Today</option>
          <option value="last7">Last 7 days</option>
          <option value="last14">Last 14 days</option>
          <option value="last30">Last 30 days</option>
          <option value="custom">Custom</option>
        </Select>
      </div>

      <div className="w-full md:w-44">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">From</label>
        <Input name="from" type="date" defaultValue={from} disabled={period !== 'custom'} />
      </div>

      <div className="w-full md:w-44">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">To</label>
        <Input name="to" type="date" defaultValue={to} disabled={period !== 'custom'} />
      </div>

      <div className="w-full md:w-44">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Inactive threshold</label>
        <Input name="inactiveDays" type="number" min={7} max={60} defaultValue={String(inactiveDays)} />
        <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">days (valid check-ins)</div>
      </div>

      <div className="flex gap-2">
        <Button type="submit">Apply</Button>
        <Link
          href={nextPath}
          className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium"
        >
          Reset
        </Link>
      </div>
    </form>
  )

  const statCards = (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div className="text-xs text-[hsl(var(--muted))]">Total check-ins</div>
        <div className="mt-1 text-2xl font-semibold">{total}</div>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div className="text-xs text-[hsl(var(--muted))]">Valid</div>
        <div className="mt-1 text-2xl font-semibold">{valid}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtPct(valid, total)}</div>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div className="text-xs text-[hsl(var(--muted))]">Invalid</div>
        <div className="mt-1 text-2xl font-semibold">{invalid}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtPct(invalid, total)}</div>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div className="text-xs text-[hsl(var(--muted))]">Unique members</div>
        <div className="mt-1 text-2xl font-semibold">{unique}</div>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div className="text-xs text-[hsl(var(--muted))]">Unique valid</div>
        <div className="mt-1 text-2xl font-semibold">{uniqueValid}</div>
      </div>
    </div>
  )

  const seriesCols = [
    { key: 'date', header: 'Date' },
    { key: 'valid', header: 'Valid' },
    { key: 'invalid', header: 'Invalid' },
    { key: 'total', header: 'Total' },
  ]
  const seriesRows = daySeries.map((d) => ({
    id: d.date,
    date: d.date,
    valid: d.valid,
    invalid: d.invalid,
    total: d.total,
  }))

  const topCols = [
    { key: 'member', header: 'Member' },
    { key: 'count', header: 'Valid check-ins' },
    { key: 'open', header: '' },
  ]
  const topTableRows = topRows.map((t) => {
    const p = profiles.get(t.member_id)
    return {
      id: t.member_id,
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">{fmtName(p)}</div>
          {p?.email ? <div className="text-xs text-[hsl(var(--muted))]">{p.email}</div> : null}
        </div>
      ),
      count: t.count,
      open: (
        <Link className="underline" href={`/members/${t.member_id}`}>
          Open
        </Link>
      ),
    }
  })

  const inactiveMembers = inactiveMemberIds.map((mid) => {
    const p = profiles.get(mid)
    return {
      member_id: mid,
      name: fmtName(p),
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      member_code: p?.member_id ?? null,
    }
  })

  const headerRight = (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
                <a href={exportHref}>Export CSV</a>
      </Button>
    </div>
  )

  return (
    <main>
      <PageHeader
        title="Attendance"
        subtitle={`Attendance dashboard — date filters are shown in Cairo time (${CAIRO_TZ}).`}
        right={headerRight}
      />
      <Section className="space-y-5">
        {loadError ? (
          <InlineAlert variant="error" title="Failed to load" className="max-w-3xl">
            {loadError}
          </InlineAlert>
        ) : null}

        {filters}
        {statCards}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-[hsl(var(--muted))]">Daily breakdown</h2>
              <div className="text-xs text-[hsl(var(--muted))]">
                Range: <b>{from}</b> → <b>{to}</b>
              </div>
            </div>
            <Table columns={seriesCols} rows={seriesRows} keyField="id" stickyTopClassName="top-0" />
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-[hsl(var(--muted))]">Top attendees (valid)</h2>
            <Table columns={topCols} rows={topTableRows} keyField="id" stickyTopClassName="top-0" />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-[hsl(var(--muted))]">Inactive members</h2>
          <div className="text-xs text-[hsl(var(--muted))]">
            Members who currently have an active subscription but have <b>no valid attendance</b> in the last{' '}
            <b>{inactiveDays}</b> day(s). Use <b>Notify</b> to send a reminder (or an offer) and track it in logs.
          </div>
          <InactiveNotifyClient members={inactiveMembers} inactiveDays={inactiveDays} />
        </div>

        <div className="text-xs text-[hsl(var(--muted))]">
          Note: attendance is recorded when staff uses Scan / Kiosk. If you want “today” to match Cairo midnight exactly,
          keep scan date in Cairo time (already patched).
        </div>
      </Section>
    </main>
  )
}