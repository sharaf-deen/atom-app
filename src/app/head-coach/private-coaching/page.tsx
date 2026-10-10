export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

const PRIMARY_WORKSPACES = [
  { href: '/head-coach/private-coaching/bookings', title: 'Upcoming bookings', description: 'Manage bookings, quick bookings and technical session content.' },
  { href: '/head-coach/private-coaching/requests', title: 'Pending requests', description: 'Review package requests, payments and member session requests.' },
  { href: '/head-coach/private-coaching/availability/new', title: 'Add availability', description: 'Publish the next coach availability slot.' },
] as const

const SECONDARY_WORKSPACES = [
  { href: '/head-coach/private-coaching/availability', title: 'Availability history', description: 'Review upcoming, past, booked and cancelled availability.' },
  { href: '/head-coach/private-coaching/past-session', title: 'Record past session', description: 'Add a completed session that was not recorded at the time.' },
  { href: '/head-coach/private-coaching/promo-codes', title: 'Promo codes', description: 'Create, activate and maintain private coaching discounts.' },
] as const

export default async function HeadCoachPrivateCoachingPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/head-coach/private-coaching')
  if (me.role !== 'head_coach' && me.role !== 'super_admin') {
    return <AccessDeniedPage title="Private coaching" subtitle="Access restricted." signedInAs={me.email} message="Only Head Coach and Super Admin can manage private coaching." allowed="head_coach, super_admin" nextPath="/head-coach/private-coaching" actions={[{ href: '/', label: 'Go Home' }]} showBackHome />
  }

  const admin = getSupabaseAdminClientCached()
  let requestsQuery = admin.from('private_coaching_requests').select('id').eq('status', 'payment_pending').is('archived_at', null)
  let bookingsQuery = admin.from('private_coaching_bookings').select('id').eq('status', 'booked').is('archived_at', null)
  let slotsQuery = admin.from('private_coaching_slots').select('id').eq('status', 'available')
  let passesQuery = admin.from('private_coaching_passes').select('remaining_sessions').eq('status', 'active')
  if (me.role === 'head_coach') {
    requestsQuery = requestsQuery.eq('coach_id', me.id)
    bookingsQuery = bookingsQuery.eq('coach_id', me.id)
    slotsQuery = slotsQuery.eq('coach_id', me.id)
    passesQuery = passesQuery.eq('coach_id', me.id)
  }

  const [requestsRes, bookingsRes, slotsRes, passesRes] = await Promise.all([requestsQuery, bookingsQuery, slotsQuery, passesQuery])
  const activeTokens = (passesRes.data ?? []).reduce((sum, row: any) => sum + Math.max(0, Number(row.remaining_sessions ?? 0)), 0)

  return <main>
    <PageHeader
      title="Private coaching"
      subtitle="Handle upcoming bookings and requests first, then manage availability and history."
      right={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/training-useful">Coach Today</Button>
          <Button asChild variant="outline" href="/private-coaching">Member view</Button>
        </div>
      }
    />
    <Section className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Upcoming bookings</div><div className="mt-1 text-2xl font-semibold">{bookingsRes.data?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Pending requests</div><div className="mt-1 text-2xl font-semibold">{requestsRes.data?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Available slots</div><div className="mt-1 text-2xl font-semibold">{slotsRes.data?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Sessions available</div><div className="mt-1 text-2xl font-semibold">{activeTokens}</div></CardContent></Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Action first</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Bookings, pending requests and new availability.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PRIMARY_WORKSPACES.map((item) => <Card key={item.href}><CardHeader><CardTitle>{item.title}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="min-h-[44px] text-sm text-[hsl(var(--muted))]">{item.description}</p><Button asChild href={item.href} className="w-full">Open</Button></CardContent></Card>)}
        </div>
      </section>

      <details className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <summary className="cursor-pointer text-sm font-semibold">More private coaching tools</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SECONDARY_WORKSPACES.map((item) => <Card key={item.href}><CardHeader><CardTitle>{item.title}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="min-h-[44px] text-sm text-[hsl(var(--muted))]">{item.description}</p><Button asChild href={item.href} className="w-full">Open</Button></CardContent></Card>)}
        </div>
      </details>
    </Section>
  </main>
}
