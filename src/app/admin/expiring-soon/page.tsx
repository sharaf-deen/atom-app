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

import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { addDays, cairoToday, diffDays, clampInt, CAIRO_TZ } from '@/lib/cairoDate'
import RunExpiryRemindersButton from './run-reminders-button'

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
  // These columns exist in your current project (added in previous patches).
  // Keep them optional for safety.
  amount_due?: number | string | null
  payment_method?: string | null
  profiles?: ProfileLite | null
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
  searchParams?: { days?: string; q?: string; includeFrozen?: string }
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
  const daysWindow = clampInt(Number(searchParams?.days ?? 7), 1, 60)
  const q = (searchParams?.q ?? '').trim()
  const includeFrozen = (searchParams?.includeFrozen ?? '').trim() === '1'

  const endMax = addDays(today, daysWindow)

  let rows: SubRow[] = []
  let loadError: string | null = null

  try {
    const admin = createSupabaseAdminClient()
    const query = admin
      .from('subscriptions')
      .select(
        'id, member_id, end_date, status, plan, sessions_total, frozen_until, amount_due, payment_method, profiles:member_id(first_name,last_name,email,phone,member_id)',
      )
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', endMax)
      .order('end_date', { ascending: true })
      .limit(5000)

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

  const subtitle = `Active memberships expiring within ${daysWindow} day(s) — Cairo time (${CAIRO_TZ}).`

  const headerRight = (
    <div className="flex items-center gap-2">
      <RunExpiryRemindersButton />
    </div>
  )

  const form = (
    <form className="flex flex-col gap-3 md:flex-row md:items-end" action={nextPath} method="get">
      <div className="flex-1">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Search member</label>
        <Input name="q" defaultValue={q} placeholder="Name, email, phone, member id" />
      </div>

      <div className="w-full md:w-44">
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Days window</label>
        <Select name="includeFrozen" defaultValue={includeFrozen ? '1' : '0'}>
          <option value="0">Hide frozen</option>
          <option value="1">Include frozen</option>
        </Select>
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

  const columns = [
    { key: 'member', header: 'Member' },
    { key: 'plan', header: 'Plan' },
    { key: 'end', header: 'End date' },
    { key: 'left', header: 'Days left' },
    { key: 'due', header: 'Due (EGP)' },
    { key: 'frozen', header: 'Frozen until' },
    { key: 'open', header: '' },
  ]

  const tableRows = rows.map((s) => {
    const p = s.profiles
    const name = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || p?.email || 'Member'
    const memberCode = p?.member_id ? ` (${p.member_id})` : ''
    const end = s.end_date ?? '—'
    const left = s.end_date ? diffDays(today, s.end_date) : '—'
    const due = fmtMoneyEGP(s.amount_due ?? 0)
    const frozen = s.frozen_until ?? '—'

    return {
      id: s.id,
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">{name}{memberCode}</div>
          {p?.email ? <div className="text-xs text-[hsl(var(--muted))]">{p.email}</div> : null}
        </div>
      ),
      plan: humanPlan(s.plan, s.sessions_total),
      end,
      left: typeof left === 'number' ? (left >= 0 ? String(left) : `-${Math.abs(left)}`) : String(left),
      due,
      frozen,
      open: (
        <Link prefetch={false} className="underline" href={`/members/${s.member_id}`}>
          Open
        </Link>
      ),
    }
  })

  return (
    <main>
      <PageHeader title="Expiring Soon" subtitle={subtitle} right={headerRight} />
      <Section className="space-y-5">
        {loadError ? (
          <InlineAlert
            variant="error"
            title="Failed to load"
            className="max-w-3xl"
          >
            {loadError}
          </InlineAlert>
        ) : null}

        {form}

        <div className="text-sm text-[hsl(var(--muted))]">
          Showing <strong>{rows.length}</strong> membership(s) expiring between <strong>{today}</strong> and{' '}
          <strong>{endMax}</strong>.
        </div>

        <Table columns={columns} rows={tableRows as any[]} keyField="id" />

        <div className="text-xs text-[hsl(var(--muted))] max-w-3xl">
          Auto reminders run daily via Vercel Cron (requires <code>CRON_SECRET</code> on Vercel). Manual run sends in-app
          notifications to members and writes to Membership Activity Log.
        </div>
      </Section>
    </main>
  )
}
