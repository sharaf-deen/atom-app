// src/app/admin/expiring-soon/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import type { ReactNode } from 'react'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import { Table } from '@/components/ui/Table'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import SettleDueDialog from '@/components/SettleDueDialog'

import SubscribeDialog from '@/components/SubscribeDialog'
import NotifyExpiryButton from './notify-button'
import RunExpiryRemindersButton from './run-reminders-button'

import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { addDays, cairoToday, diffDays, clampInt, CAIRO_TZ } from '@/lib/cairoDate'

type ProfileLite = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  member_id: string | null
}

type SubRow = {
  id: string
  member_id: string
  end_date: string | null
  status: string
  plan: string
  sessions_total: number | null
  frozen_until: string | null
  amount?: number | string | null
  amount_due?: number | string | null
  payment_method?: string | null
  paid_at?: string | null
  profiles?: ProfileLite | null
}

type View = 'today' | 'next7' | 'overdue' | 'range'

const PER_PAGE = 50

function isView(v: any): v is View {
  return v === 'today' || v === 'next7' || v === 'overdue' || v === 'range'
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    sp.set(k, v)
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

function humanPlan(plan: string, sessionsTotal?: number | null) {
  if (plan === 'sessions') {
    const n = Number.isFinite(Number(sessionsTotal)) ? Number(sessionsTotal) : null
    return n ? `${n} sessions` : 'Sessions package'
  }
  if (!plan) return 'Membership'
  return plan.replace(/_/g, ' ').toUpperCase()
}

function fmtMoneyEGP(v: any) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0 EGP'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function humanPayment(v?: string | null) {
  switch (String(v ?? '').toLowerCase()) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'InstaPay'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return v ? String(v) : '—'
  }
}

function toneClasses(kind: 'neutral' | 'warning' | 'danger' | 'success') {
  if (kind === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (kind === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (kind === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClasses(tone)}`}>
      {children}
    </span>
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-[hsl(var(--muted))]">{hint}</div>
    </div>
  )
}

export default async function ExpiringSoonPage({
  searchParams,
}: {
  searchParams?: { view?: string; days?: string; q?: string; includeFrozen?: string; page?: string }
}) {
  const user = await getSessionUserCached()
  const nextPath = '/admin/expiring-soon'

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return (
      <Forbidden
        pageTitle="Expiring Soon"
        subtitle="Admins only."
        nextPath={nextPath}
        allowed="admin, super_admin"
        signedInAs={user?.email ?? null}
        actions={[{ href: '/', label: 'Go Home' }]}
      />
    )
  }

  const today = cairoToday()
  const view: View = isView(searchParams?.view) ? (searchParams!.view as View) : 'next7'
  const daysWindow = clampInt(Number(searchParams?.days ?? 7), 1, 60)
  const q = (searchParams?.q ?? '').trim()
  const includeFrozen = (searchParams?.includeFrozen ?? '').trim() === '1'
  const page = clampInt(Number(searchParams?.page ?? 1), 1, 9999)

  const rangeStart = today
  const rangeEnd =
    view === 'today'
      ? today
      : view === 'next7'
      ? addDays(today, 7)
      : view === 'range'
      ? addDays(today, daysWindow)
      : null

  let rows: SubRow[] = []
  let loadError: string | null = null

  let hasNext = false
  const hasPrev = page > 1
  let totalKnown: number | null = null

  try {
    const admin = getSupabaseAdminClientCached()

    let query = admin
      .from('subscriptions')
      .select(
        'id, member_id, end_date, status, plan, sessions_total, frozen_until, amount, amount_due, payment_method, paid_at, profiles:member_id(first_name,last_name,email,phone,member_id)',
      )
      .eq('status', 'active')
      .not('end_date', 'is', null)

    if (view === 'overdue') {
      query = query.lt('end_date', today).order('end_date', { ascending: false })
    } else {
      query = query.gte('end_date', rangeStart).lte('end_date', rangeEnd!).order('end_date', { ascending: true })
    }

    if (!includeFrozen) {
      query = query.or(`frozen_until.is.null,frozen_until.lt.${today}`)
    }

    if (q) {
      query = query.limit(5000)
    } else {
      const from = (page - 1) * PER_PAGE
      const to = from + PER_PAGE
      query = query.range(from, to)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    let fetched = ((data ?? []) as unknown as SubRow[]) ?? []

    if (q) {
      const qq = q.toLowerCase()
      fetched = fetched.filter((s) => {
        const p = s.profiles
        const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim().toLowerCase()
        const email = (p?.email ?? '').toLowerCase()
        const phone = (p?.phone ?? '').toLowerCase()
        const memberCode = (p?.member_id ?? '').toLowerCase()
        return (
          name.includes(qq) ||
          email.includes(qq) ||
          phone.includes(qq) ||
          memberCode.includes(qq) ||
          (s.member_id ?? '').toLowerCase().includes(qq)
        )
      })

      totalKnown = fetched.length
      const start = (page - 1) * PER_PAGE
      const end = start + PER_PAGE
      rows = fetched.slice(start, end)
      hasNext = end < fetched.length
    } else {
      hasNext = fetched.length > PER_PAGE
      rows = fetched.slice(0, PER_PAGE)
    }
  } catch (e: any) {
    loadError = e?.message ?? String(e)
  }

  const subtitle =
    view === 'today'
      ? `Active memberships expiring today — Cairo time (${CAIRO_TZ}).`
      : view === 'next7'
      ? `Active memberships expiring in the next 7 days — Cairo time (${CAIRO_TZ}).`
      : view === 'overdue'
      ? `Active memberships already expired (overdue) — Cairo time (${CAIRO_TZ}).`
      : `Active memberships expiring within ${daysWindow} day(s) — Cairo time (${CAIRO_TZ}).`

  const baseQS = {
    view,
    q: q || undefined,
    includeFrozen: includeFrozen ? '1' : '0',
    days: String(daysWindow),
  }

  const tabs = (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          { key: 'today', label: 'Today' },
          { key: 'next7', label: 'Next 7 days' },
          { key: 'range', label: 'Custom range' },
          { key: 'overdue', label: 'Overdue' },
        ] as const
      ).map((t) => {
        const active = view === t.key
        const href = nextPath + buildQS({ ...baseQS, view: t.key, page: undefined })
        return (
          <Link
            key={t.key}
            href={href}
            className={
              'inline-flex items-center rounded-full border px-3 py-1 text-sm transition ' +
              (active ? 'bg-black text-white border-black' : 'bg-white hover:bg-gray-50')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2">
      {tabs}
      <RunExpiryRemindersButton />
    </div>
  )

  const form = (
    <form className="flex flex-col gap-3 md:flex-row md:items-end" action={nextPath} method="get">
      <input type="hidden" name="view" value={view} />

      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted))]">Search member</label>
        <Input name="q" defaultValue={q} placeholder="Name, email, phone, member id" />
      </div>

      <div className="w-full md:w-44">
        <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted))]">Days window</label>
        <Select name="days" defaultValue={String(daysWindow)} disabled={view !== 'range'}>
          <option value="3">3 days</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
        </Select>
      </div>

      <div className="w-full md:w-44">
        <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted))]">Frozen</label>
        <Select name="includeFrozen" defaultValue={includeFrozen ? '1' : '0'}>
          <option value="0">Hide frozen</option>
          <option value="1">Include frozen</option>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit">Apply</Button>
        <Link
          href={nextPath + buildQS({ view })}
          className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium"
        >
          Reset
        </Link>
      </div>
    </form>
  )

  const columns = [
    { key: 'member', header: 'Member' },
    { key: 'membership', header: 'Membership' },
    { key: 'billing', header: 'Billing' },
    { key: 'actions', header: 'Actions' },
  ]

  const tableRows = rows.map((s) => {
    const p = s.profiles
    const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || p?.email || 'Member'
    const memberCode = p?.member_id ? ` · ${p.member_id}` : ''
    const leftNum = s.end_date ? diffDays(today, s.end_date) : null
    const end = s.end_date ?? '—'
    const dueAmount = Math.max(Number(s.amount_due ?? 0), 0)
    const paidAmount = Math.max(Number(s.amount ?? 0), 0)
    const frozen = !!s.frozen_until && s.frozen_until >= today

    const renewStart = s.end_date && s.end_date >= today ? addDays(s.end_date, 1) : today

    const memberObj = {
      user_id: s.member_id,
      email: p?.email ?? null,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
    }

    const leftTone: 'success' | 'warning' | 'danger' = leftNum === null ? 'success' : leftNum < 0 ? 'danger' : leftNum <= 7 ? 'warning' : 'success'
    const leftText = leftNum === null ? '—' : leftNum >= 0 ? `${leftNum} day(s) left` : `${Math.abs(leftNum)} day(s) overdue`

    return {
      id: s.id,
      member: (
        <div className="space-y-1">
          <div className="font-medium">{name}{memberCode}</div>
          {p?.email ? <div className="text-xs text-[hsl(var(--muted))]">{p.email}</div> : null}
          <div className="flex flex-wrap gap-1">
            <TinyBadge tone={leftTone}>{leftText}</TinyBadge>
            {frozen ? <TinyBadge tone="warning">Frozen until {s.frozen_until}</TinyBadge> : null}
          </div>
        </div>
      ),
      membership: (
        <div className="space-y-1">
          <div className="font-medium">{humanPlan(s.plan, s.sessions_total)}</div>
          <div className="text-xs text-[hsl(var(--muted))]">Ends {end}</div>
          <div className="text-xs text-[hsl(var(--muted))]">Status: active</div>
        </div>
      ),
      billing: (
        <div className="space-y-1">
          <div className="font-medium">{dueAmount > 0 ? `Due ${fmtMoneyEGP(dueAmount)}` : 'No due'}</div>
          <div className="text-xs text-[hsl(var(--muted))]">Paid {fmtMoneyEGP(paidAmount)} · Method {humanPayment(s.payment_method)}</div>
          <div className="text-xs text-[hsl(var(--muted))]">Paid at {s.paid_at ? s.paid_at.slice(0, 10) : '—'}</div>
        </div>
      ),
      actions: (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubscribeDialog member={memberObj} buttonLabel="Renew" mode="renew" lockStartDate defaultStartDate={renewStart} />
          {dueAmount > 0 ? (
            <SettleDueDialog
              sub={{ id: s.id, amount: paidAmount, amount_due: dueAmount, payment_method: s.payment_method ?? null }}
              buttonLabel="Settle due"
            />
          ) : null}
          <NotifyExpiryButton subscriptionId={s.id} />
          <Link prefetch={false} className="inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50" href={`/members/${s.member_id}`}>
            Open profile
          </Link>
        </div>
      ),
    }
  })

  const totalVisibleDue = rows.reduce((sum, s) => sum + Math.max(Number(s.amount_due ?? 0), 0), 0)
  const overdueVisible = rows.filter((s) => !!s.end_date && diffDays(today, s.end_date) < 0).length
  const dueVisible = rows.filter((s) => Math.max(Number(s.amount_due ?? 0), 0) > 0).length
  const frozenVisible = rows.filter((s) => !!s.frozen_until && s.frozen_until >= today).length

  const rangeTextBase =
    view === 'overdue'
      ? `Overdue: end date before ${today}.`
      : `Between ${rangeStart} and ${rangeEnd}.`

  const rangeText =
    totalKnown === null
      ? `Showing ${rows.length} membership(s) · ${rangeTextBase}${page > 1 ? ` · Page ${page}` : ''}`
      : `Showing ${rows.length} of ${totalKnown} membership(s) · ${rangeTextBase}${page > 1 ? ` · Page ${page}` : ''}`

  const pager = !loadError && (hasPrev || hasNext) ? (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-[hsl(var(--muted))]">Per page: {PER_PAGE}</div>
      <div className="flex items-center gap-2">
        <Link
          aria-disabled={!hasPrev}
          href={
            hasPrev
              ? nextPath + buildQS({ ...baseQS, page: String(page - 1) })
              : nextPath + buildQS({ ...baseQS, page: String(page) })
          }
          className={
            'inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium ' +
            (hasPrev ? 'hover:bg-gray-50' : 'pointer-events-none opacity-50')
          }
        >
          ← Prev
        </Link>
        <div className="text-sm font-medium">Page {page}</div>
        <Link
          aria-disabled={!hasNext}
          href={
            hasNext
              ? nextPath + buildQS({ ...baseQS, page: String(page + 1) })
              : nextPath + buildQS({ ...baseQS, page: String(page) })
          }
          className={
            'inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium ' +
            (hasNext ? 'hover:bg-gray-50' : 'pointer-events-none opacity-50')
          }
        >
          Next →
        </Link>
      </div>
    </div>
  ) : null

  return (
    <main>
      <PageHeader title="Expiring Soon" subtitle={subtitle} right={headerRight} />
      <Section className="space-y-5">
        {loadError ? (
          <InlineAlert variant="error" title="Failed to load" className="max-w-3xl">
            {loadError}
          </InlineAlert>
        ) : null}

        {form}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Visible memberships" value={String(rows.length)} hint={view === 'overdue' ? 'Rows currently overdue in this page view.' : 'Rows in the current filtered page view.'} />
          <SummaryCard label="Visible due" value={fmtMoneyEGP(totalVisibleDue)} hint={dueVisible > 0 ? `${dueVisible} row(s) still have money due.` : 'No due in the current view.'} />
          <SummaryCard label="Overdue now" value={String(overdueVisible)} hint={overdueVisible > 0 ? 'Needs fast renewal action.' : 'Nothing overdue in the visible rows.'} />
          <SummaryCard label="Frozen visible" value={String(frozenVisible)} hint={frozenVisible > 0 ? 'Check pause dates before renewing.' : 'No frozen memberships visible.'} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
          <TinyBadge>{view === 'overdue' ? 'Overdue mode' : view === 'today' ? 'Today' : view === 'next7' ? 'Next 7 days' : `Custom ${daysWindow} days`}</TinyBadge>
          {includeFrozen ? <TinyBadge tone="warning">Frozen included</TinyBadge> : <TinyBadge>Frozen hidden</TinyBadge>}
          {q ? <TinyBadge>Search: {q}</TinyBadge> : null}
          <span>{rangeText}</span>
        </div>

        {pager}

        <Table columns={columns} rows={tableRows as any[]} keyField="id" stickyTopClassName="top-0" />

        {pager}

        <div className="max-w-3xl text-xs text-[hsl(var(--muted))]">
          Tips: <b>Renew</b> is ready directly from the list. Use <b>Settle due</b> before or after renewal when there is still money outstanding. <b>Notify</b> sends an in-app reminder now and logs it in Membership Activity.
        </div>
      </Section>
    </main>
  )
}
