// src/app/admin/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import AdminExports from '@/components/AdminExports'
import AdminRevenue from '@/components/AdminRevenue'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}
function tomorrowDateOnly(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

export default async function AdminPage() {
  const me = await getSessionUser()

  if (!me) {
    redirect('/login?next=/admin')
  }

  // Reception -> Members
  if (me.role === 'reception') {
    redirect('/admin/members')
  }

  // Admin dashboard only
  if (!['admin', 'super_admin'].includes(me.role)) {
    const logoutNext = '/admin'
    return (
      <main>
        <PageHeader title="Admin" subtitle="Access restricted" />
        <div className="p-6 max-w-2xl">
          <div className="rounded-2xl border bg-white p-5 space-y-2">
            <div className="text-sm text-gray-600">
              You’re signed in as <span className="font-medium">{me.email}</span>.
            </div>

            <div className="text-base font-semibold">You don’t have permission to access Admin.</div>

            <div className="text-sm text-gray-600">
              If you believe this is a mistake, please contact an administrator to request access.
            </div>

            <div className="flex gap-2 flex-wrap pt-2">
              <Link href="/" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                Back to home
              </Link>
              <Link href="/profile" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                My profile
              </Link>

              <Link
                href={`/logout?next=${encodeURIComponent(logoutNext)}`}
                className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
              >
                Switch account
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const supa = createSupabaseRSC()
  const today = todayDateOnly()
  const tomorrow = tomorrowDateOnly(today)

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

  const { count: storeTodayCount } = await supa
    .from('store_orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today)
    .lt('created_at', tomorrow)

  return (
    <main>
      <PageHeader title="Admin" subtitle="Overview and operations" />

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
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">today</div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section>
        <div className="text-sm text-gray-600">Store orders today: {storeTodayCount ?? 0}</div>
      </Section>

      <Section>
        <AdminRevenue />
      </Section>

      <Section>
        <AdminExports />
      </Section>
    </main>
  )
}
