// src/app/admin/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import type React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AdminExports from '@/components/AdminExports'
import AdminRevenue from '@/components/AdminRevenue'
import { addDays, cairoToday, CAIRO_TZ } from '@/lib/cairoDate'

function fmtMoneyEGP(v: any) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  href?: string
}) {
  const inner = (
    <Card hover>
      <CardContent>
        <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">{hint}</div> : null}
      </CardContent>
    </Card>
  )

  if (!href) return inner
  return (
    <Link
      href={href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl"
    >
      {inner}
    </Link>
  )
}

export default async function AdminPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin')

  const allowed = me.role === 'admin' || me.role === 'super_admin'
  if (!allowed) {
    return (
      <Forbidden
        pageTitle="Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can access the admin dashboard."
        allowed="admin, super_admin"
        nextPath="/admin"
        actions={[{ href: '/', label: 'Go Home' }, { href: '/members', label: 'Members' }]}
        showBackHome
      />
    )
  }

  const supa = createSupabaseRSC()

  // Cairo date strings (YYYY-MM-DD)
  const today = cairoToday()
  const next7 = addDays(today, 7)

  // KPIs
  const [{ count: activeCount }, { count: expiring7Count }, scansRes] = await Promise.all([
    supa
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('end_date', today)
      // exclude frozen memberships (same logic as Expiring Soon page)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    supa
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', next7)
      .or(`frozen_until.is.null,frozen_until.lt.${today}`),
    supa.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
  ])

  // Outstanding total (sum)
  let outstandingCount = 0
  let outstandingTotal = 0
  try {
    const { data, count } = await supa
      .from('subscriptions')
      .select('amount_due', { count: 'exact' })
      .gt('amount_due', 0)
      .not('member_id', 'is', null)
      .limit(10000)

    outstandingCount = count ?? (data?.length ?? 0)
    outstandingTotal = (data ?? []).reduce((acc, r: any) => acc + Number(r?.amount_due ?? 0), 0)
  } catch {
    // ignore
  }

  const scansToday = scansRes?.count ?? 0

  return (
    <main>
      <PageHeader
        title="Admin Dashboard"
        subtitle={`Daily ops — Cairo time (${CAIRO_TZ}).`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" href="/scan?kiosk=1">
              Scan
            </Button>
            <Button asChild variant="outline" href="/members">
              Members
            </Button>
          </div>
        }
      />

      <Section>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active members"
            value={activeCount ?? 0}
            hint={`Active subscriptions (end date ≥ ${today})`}
            href="/members"
          />
          <StatCard
            label="Expiring in 7 days"
            value={expiring7Count ?? 0}
            hint={`${today} → ${next7}`}
            href="/admin/expiring-soon"
          />
          <StatCard
            label="Outstanding total"
            value={fmtMoneyEGP(outstandingTotal)}
            hint={`${outstandingCount} member(s) with dues`}
            href="/admin/outstanding-dues"
          />
          <StatCard
            label="Scans today"
            value={scansToday}
            hint={`Kiosk attendance — ${today}`}
            href="/admin/scan-audit"
          />
        </div>
      </Section>

      <Section className="space-y-4">
        <h2 className="text-lg font-semibold">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/expiring-soon">
            Expiring
          </Button>
          <Button asChild variant="outline" href="/admin/outstanding-dues">
            Outstanding
          </Button>
          <Button asChild variant="outline" href="/admin/payments">
            Payments
          </Button>
          <Button asChild variant="outline" href="/expenses">
            Expenses
          </Button>
          <Button asChild variant="outline" href="/admin/scan-audit">
            Scan Audit
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AdminRevenue />
          <AdminExports />
        </div>

        <div className="text-xs text-[hsl(var(--muted))]">
          <Link href="/" className="underline">
            Back to home
          </Link>
        </div>
      </Section>
    </main>
  )
}
