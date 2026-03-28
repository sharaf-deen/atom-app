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

import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

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

function cairoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

function shiftDays(dateOnly: string, deltaDays: number) {
  const d = new Date(`${dateOnly}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
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

function formatPeriodLabel(period: string, from: string, to: string) {
  if (period === 'today') return 'Today'
  if (period === 'last7') return 'Last 7 days'
  if (period === 'last14') return 'Last 14 days'
  if (period === 'last30') return 'Last 30 days'
  return `${from} → ${to}`
}

export default async function AttendanceDashboard({
  searchParams,
}: {
  searchParams?: { period?: string; from?: string; to?: string; inactiveDays?: string }
}) {
  const user = await getSessionUser()
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

  const today = cairoToday()
  const period = (searchParams?.period ?? 'last14').trim()
  const inactiveDays = clampInt(Number(searchParams?.inactiveDays ?? 14), 7, 60)

  let from = today
  let to = today

  if (period === 'today') {
    from = today
    to = today
  } else if (period === 'last7') {
    from = shiftDays(today, -6)
    to = today
  } else if (period === 'last30') {
    from = shiftDays(today, -29)
    to = today
  } else if (period === 'custom') {
    const f = (searchParams?.from ?? '').trim()
    const t = (searchParams?.to ?? '').trim()
    if (isISODateOnly(f) && isISODateOnly(t) && f <= t) {
      from = f
      to = t
    } else {
      from = shiftDays(today, -13)
      to = today
    }
  } else {
    // default last14
    from = shiftDays(today, -13)
    to = today
  }

  let loadError: string | null = null
  let rows: AttendanceRow[] = []
  let daySeries: { date: string; total: number; valid: number; invalid: number }[] = []
  let topRows: { member_id: string; count: number }[] = []
  let inactiveMemberIds: string[] = []
  const profiles = new Map<string, ProfileRow>()

  try {
    const admin = createSupabaseAdminClient()

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
    for (let d = from; d <= to; d = shiftDays(d, 1)) dates.push(d)

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
    const fromInact = shiftDays(today, -(inactiveDays - 1))
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
  const total = rows.length
  const valid = rows.filter((r) => r.valid).length
  const invalid = total - valid
  const unique = new Set(rows.map((r) => r.member_id).filter(Boolean)).size
  const uniqueValid = new Set(rows.filter((r) => r.valid).map((r) => r.member_id).filter(Boolean)).size

  const exportHref = `/api/admin/export/attendance?from=${from}&to=${to}`
  const currentViewLabel = `${formatPeriodLabel(period, from, to)} · Inactive threshold: ${inactiveDays} days`

  const filters = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Filters</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Focus the dashboard before reviewing attendance and inactivity.
            </p>
          </div>
          <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
            Cairo time
          </div>
        </div>

        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" action={nextPath} method="get">
          <div>
            <Select name="period" defaultValue={period} label="Period">
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last14">Last 14 days</option>
              <option value="last30">Last 30 days</option>
              <option value="custom">Custom</option>
            </Select>
          </div>

          <div>
            <Input label="From" name="from" type="date" defaultValue={from} disabled={period !== 'custom'} />
          </div>

          <div>
            <Input label="To" name="to" type="date" defaultValue={to} disabled={period !== 'custom'} />
          </div>

          <div>
            <Input
              label="Inactive threshold"
              hint="Days without valid check-ins"
              name="inactiveDays"
              type="number"
              min={7}
              max={60}
              defaultValue={String(inactiveDays)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-4">
            <Button type="submit">Apply filters</Button>
            <Button asChild href={nextPath} variant="outline">
              Reset filters
            </Button>
            <div className="ml-auto rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
              <span className="font-medium text-black">Current view:</span> {currentViewLabel}
            </div>
          </div>
        </form>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Export</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Export exactly this attendance view.</p>
        </div>

        <div className="mt-4 space-y-3">
          <Button asChild href={exportHref} className="w-full">
            Export CSV
          </Button>
          <p className="text-xs text-[hsl(var(--muted))]">Uses current filters</p>
        </div>
      </div>
    </div>
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

  return (
    <main>
      <PageHeader
        title="Attendance"
        subtitle={`Attendance dashboard — date filters are shown in Cairo time (${CAIRO_TZ}).`}
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
