export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

const WORKSPACES = [
  { href: '/head-coach/private-coaching/bookings', title: 'Private coaching bookings', description: 'Manage bookings, quick bookings and technical session content.' },
  { href: '/head-coach/private-coaching/requests', title: 'Private coaching requests', description: 'Review package requests, payments and member session requests.' },
  { href: '/head-coach/private-coaching/past-session', title: 'Record a completed past session', description: 'Add a session that already happened but was never recorded in ATOM.' },
  { href: '/head-coach/private-coaching/availability', title: 'Coach availability slots', description: 'Review upcoming, past, booked and cancelled availability.' },
  { href: '/head-coach/private-coaching/availability/new', title: 'Add availability', description: 'Publish a new coach slot or a controlled past correction slot.' },
  { href: '/head-coach/private-coaching/promo-codes', title: 'Private coaching promo codes', description: 'Create, activate and maintain private coaching discounts.' },
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
    <PageHeader title="Private coaching" subtitle="Bookings, requests, availability and session follow-up in separate workspaces." right={<Button asChild variant="outline" href="/private-coaching">Member view</Button>} />
    <Section className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Active tokens</div><div className="mt-1 text-2xl font-semibold">{activeTokens}</div></CardContent></Card>
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Pending requests</div><div className="mt-1 text-2xl font-semibold">{requestsRes.data?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Upcoming bookings</div><div className="mt-1 text-2xl font-semibold">{bookingsRes.data?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent><div className="text-sm text-[hsl(var(--muted))]">Available slots</div><div className="mt-1 text-2xl font-semibold">{slotsRes.data?.length ?? 0}</div></CardContent></Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {WORKSPACES.map((item) => <Card key={item.href}><CardHeader><CardTitle>{item.title}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="min-h-[44px] text-sm text-[hsl(var(--muted))]">{item.description}</p><Button asChild href={item.href} className="w-full">Open</Button></CardContent></Card>)}
      </div>
    </Section>
  </main>
}
