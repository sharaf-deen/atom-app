// src/app/admin/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AdminExports from '@/components/AdminExports'
import AdminRevenue from '@/components/AdminRevenue'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}
function tomorrowDateOnly(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

export default async function AdminPage() {
  const me = await getSessionUser()
  if (!me || !['admin', 'super_admin'].includes(me.role)) {
    return (
      <main>
        <PageHeader title="Admin" subtitle="Forbidden." />
      </main>
    )
  }

  const supa = createSupabaseRSC()
  const today = todayDateOnly()
  const tomorrow = tomorrowDateOnly(today)

  // --- KPI queries (unchanged) ---
  const { count: activeTimeCount } = await supa
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_type', 'time')
    .eq('status', 'active')
    .gte('end_date', today)

  const { count: activeSessionsCount } = await supa
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_type', 'sessions')
    .eq('status', 'active')
    .gte('end_date', today)

  const { count: expiredCount } = await supa
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'expired')

  const { count: attendanceToday } = await supa
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('valid', true)
    .eq('date', today)

  const { data: activeRows } = await supa
    .from('subscriptions')
    .select('plan, status, end_date')
    .eq('status', 'active')
    .gte('end_date', today)
    .limit(5000) as {
      data: Array<{ plan: Plan; status: string | null; end_date: string | null }> | null
    }

  const byPlan: Record<Plan, number> = { '1m': 0, '3m': 0, '6m': 0, '12m': 0, 'sessions': 0 }
  for (const r of activeRows ?? []) {
    if (r.plan && (['1m', '3m', '6m', '12m', 'sessions'] as Plan[]).includes(r.plan)) {
      byPlan[r.plan] = (byPlan[r.plan] ?? 0) + 1
    }
  }

  // Store KPIs
  const { count: readyCount } = await supa
    .from('store_orders').select('id', { count: 'exact', head: true }).eq('status', 'ready')
  const { count: pendingCount } = await supa
    .from('store_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  const { count: confirmedCount } = await supa
    .from('store_orders').select('id', { count: 'exact', head: true }).eq('status', 'confirmed')
  const { count: deliveredCount } = await supa
    .from('store_orders').select('id', { count: 'exact', head: true }).eq('status', 'delivered')
  const { count: canceledCount } = await supa
    .from('store_orders').select('id', { count: 'exact', head: true }).eq('status', 'canceled')
  const { count: storeTodayCount } = await supa
    .from('store_orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today)
    .lt('created_at', tomorrow)

  return (
    <main>
      <PageHeader
        title="Admin"
        subtitle="Overview and operations"
      />

      {/* KPI Cards (Membership) */}
      <Section>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card hover>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Active (subscriptions)</div>
              <div className="mt-1 text-2xl font-semibold">{activeTimeCount ?? 0}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">end date ≥ today</div>
            </CardContent>
          </Card>

          <Card hover>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Active (sessions)</div>
              <div className="mt-1 text-2xl font-semibold">{activeSessionsCount ?? 0}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">end date ≥ today</div>
            </CardContent>
          </Card>

          <Card hover>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Expired (all)</div>
              <div className="mt-1 text-2xl font-semibold">{expiredCount ?? 0}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">status = expired</div>
            </CardContent>
          </Card>

          <Card hover>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Attendance today</div>
              <div className="mt-1 text-2xl font-semibold">{attendanceToday ?? 0}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">date = {today}</div>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Breakdown Active by plan */}
      <Section>
        <h2 className="text-lg font-semibold mb-3">Active subscriptions (by plan)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(['1m', '3m', '6m', '12m', 'sessions'] as Plan[]).map((p) => (
            <Card key={p}>
              <CardContent>
                <div className="text-sm text-[hsl(var(--muted))]">
                  {p === 'sessions'
                    ? 'Per sessions'
                    : p === '1m'
                    ? '1 month'
                    : p === '3m'
                    ? '3 months'
                    : p === '6m'
                    ? '6 months'
                    : '12 months'}
                </div>
                <div className="mt-1 text-xl font-semibold">{byPlan[p] ?? 0}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-3 text-xs text-[hsl(var(--muted))]">
          * Calculated on subscriptions with status = active & end_date ≥ today.
        </div>
      </Section>

      {/* Store KPIs */}
      <Section>
        <h2 className="text-lg font-semibold mb-3">Store</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
          <Card><CardContent>
            <div className="text-sm text-[hsl(var(--muted))]">Ready</div>
            <div className="mt-1 text-2xl font-semibold">{readyCount ?? 0}</div>
          </CardContent></Card>

          <Card><CardContent>
            <div className="text-sm text-[hsl(var(--muted))]">Pending</div>
            <div className="mt-1 text-2xl font-semibold">{pendingCount ?? 0}</div>
          </CardContent></Card>

          <Card><CardContent>
            <div className="text-sm text-[hsl(var(--muted))]">Confirmed</div>
            <div className="mt-1 text-2xl font-semibold">{confirmedCount ?? 0}</div>
          </CardContent></Card>

          <Card><CardContent>
            <div className="text-sm text-[hsl(var(--muted))]">Delivered</div>
            <div className="mt-1 text-2xl font-semibold">{deliveredCount ?? 0}</div>
          </CardContent></Card>

          <Card><CardContent>
            <div className="text-sm text-[hsl(var(--muted))]">Canceled</div>
            <div className="mt-1 text-2xl font-semibold">{canceledCount ?? 0}</div>
          </CardContent></Card>

          <Card><CardContent>
            <div className="text-sm text-[hsl(var(--muted))]">Orders today</div>
            <div className="mt-1 text-2xl font-semibold">{storeTodayCount ?? 0}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">{today}</div>
          </CardContent></Card>
        </div>
      </Section>

      {/* Revenue dashboard */}
      <Section>
        <AdminRevenue />
      </Section>

      {/* Exports (CSV) */}
      <Section>
        <AdminExports />
      </Section>
    </main>
  )
}
