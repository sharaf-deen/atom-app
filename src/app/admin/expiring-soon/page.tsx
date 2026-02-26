// src/app/admin/expiring-soon/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import { Table } from '@/components/ui/Table'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'

import SubscribeDialog from '@/components/SubscribeDialog'
import NotifyExpiryButton from './notify-button'
import RunExpiryRemindersButton from './run-reminders-button'

import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
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
  amount_due?: number | string | null
  payment_method?: string | null
  profiles?: ProfileLite | null
}

type View = 'today' | 'next7' | 'overdue' | 'range'

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
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(0)
}

export default async function ExpiringSoonPage({
  searchParams,
}: {
  searchParams?: { view?: string; days?: string; q?: string; includeFrozen?: string }
}) {
  const user = await getSessionUser()
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

  // Range logic (Cairo date strings)
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

  try {
    const admin = createSupabaseAdminClient()

    let query = admin
      .from('subscriptions')
      .select(
        'id, member_id, end_date, status, plan, sessions_total, frozen_until, amount_due, payment_method, profiles:member_id(first_name,last_name,email,phone,member_id)',
      )
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .limit(5000)

    if (view === 'overdue') {
      query = query.lt('end_date', today).order('end_date', { ascending: false })
    } else {
      query = query.gte('end_date', rangeStart).lte('end_date', rangeEnd!).order('end_date', { ascending: true })
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    rows = (data ?? []) as unknown as SubRow[]

    if (!includeFrozen) {
      rows = rows.filter((s) => {
        const fu = (s.frozen_until ?? '').trim()
        if (!fu) return true
        return fu < today
      })
    }

    if (q) {
      const qq = q.toLowerCase()
      rows = rows.filter((s) => {
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
        const href = nextPath + buildQS({ ...baseQS, view: t.key })
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
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Search member</label>
        <Input name="q" defaultValue={q} placeholder="Name, email, phone, member id" />
      </div>

      <div className="w-full md:w-44">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Days window</label>
        <Select name="days" defaultValue={String(daysWindow)} disabled={view !== 'range'}>
          <option value="3">3 days</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
        </Select>
      </div>

      <div className="w-full md:w-44">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Frozen</label>
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
    { key: 'plan', header: 'Plan' },
    { key: 'end', header: 'End date' },
    { key: 'left', header: 'Days left' },
    { key: 'due', header: 'Due (EGP)' },
    { key: 'frozen', header: 'Frozen until' },
    { key: 'actions', header: '' },
  ]

  const tableRows = rows.map((s) => {
    const p = s.profiles
    const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || p?.email || 'Member'
    const memberCode = p?.member_id ? ` (${p.member_id})` : ''
    const end = s.end_date ?? '—'
    const leftNum = s.end_date ? diffDays(today, s.end_date) : null
    const left = leftNum === null ? '—' : leftNum >= 0 ? String(leftNum) : `-${Math.abs(leftNum)}`

    const due = fmtMoneyEGP(s.amount_due ?? 0)
    const frozen = s.frozen_until ?? '—'

    // Renew start date (Egypt day): chain to end_date + 1 if not ended yet; otherwise start today
    const renewStart = s.end_date && s.end_date >= today ? addDays(s.end_date, 1) : today

    const memberObj = {
      user_id: s.member_id,
      email: p?.email ?? null,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
    }

    return {
      id: s.id,
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">
            {name}
            {memberCode}
          </div>
          {p?.email ? <div className="text-xs text-[hsl(var(--muted))]">{p.email}</div> : null}
        </div>
      ),
      plan: humanPlan(s.plan, s.sessions_total),
      end,
      left,
      due,
      frozen,
      actions: (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubscribeDialog member={memberObj} buttonLabel="Renew" mode="renew" lockStartDate defaultStartDate={renewStart} />
          <NotifyExpiryButton subscriptionId={s.id} />
          <Link prefetch={false} className="underline" href={`/members/${s.member_id}`}>
            Open
          </Link>
        </div>
      ),
    }
  })

  const rangeText =
    view === 'overdue'
      ? `Showing ${rows.length} overdue membership(s) with end date before ${today}.`
      : `Showing ${rows.length} membership(s) expiring between ${rangeStart} and ${rangeEnd}.`

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

        <div className="text-sm text-[hsl(var(--muted))]">{rangeText}</div>

        <Table columns={columns} rows={tableRows as any[]} keyField="id" />

        <div className="text-xs text-[hsl(var(--muted))] max-w-3xl">
          Tips: use <b>Renew</b> directly from this list (no need to open the member profile). <b>Notify</b> sends an
          in-app reminder now and logs it in Membership Activity.
        </div>
      </Section>
    </main>
  )
}
