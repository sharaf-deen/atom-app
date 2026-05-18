export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PrivateCoachingAdminClient from '@/components/private-coaching/PrivateCoachingAdminClient'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { formatPrivateCoachingMoney, privateCoachingMemberName } from '@/lib/privateCoaching'

type RequestRow = {
  id: string
  member_id: string
  coach_id: string
  package_sessions: number
  amount_cents: number
  payment_method: string
  status: string
  created_at: string
  confirmed_at: string | null
}

type ProfileRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

type PassRow = {
  id: string
  member_id: string
  coach_id: string
  total_sessions: number
  used_sessions: number
  remaining_sessions: number
  status: string
}

function profileMeta(profile: ProfileRow | undefined | null) {
  if (!profile) return 'No profile details'
  return [profile.member_id ? `ID ${profile.member_id}` : '', profile.email ?? '', profile.phone ?? '']
    .filter(Boolean)
    .join(' · ') || 'No profile details'
}

export default async function HeadCoachPrivateCoachingPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/head-coach/private-coaching')

  const canManage = me.role === 'head_coach' || me.role === 'super_admin'
  if (!canManage) {
    return (
      <AccessDeniedPage
        title="Private coaching"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Head Coach and Super Admin can manage private coaching requests."
        allowed="head_coach, super_admin"
        nextPath="/head-coach/private-coaching"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()

  let query = admin
    .from('private_coaching_requests')
    .select('id, member_id, coach_id, package_sessions, amount_cents, payment_method, status, created_at, confirmed_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (me.role === 'head_coach') query = query.eq('coach_id', me.id)

  const [requestsRes, passesRes] = await Promise.all([
    query,
    admin
      .from('private_coaching_passes')
      .select('id, member_id, coach_id, total_sessions, used_sessions, remaining_sessions, status')
      .eq('status', 'active')
      .limit(1000),
  ])

  const requests = (requestsRes.data ?? []) as RequestRow[]
  const passes = (passesRes.data ?? []) as PassRow[]
  const profileIds = Array.from(new Set(requests.flatMap((row) => [row.member_id, row.coach_id]).filter(Boolean)))
  const profilesById = new Map<string, ProfileRow>()

  if (profileIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, member_id, first_name, last_name, email, phone')
      .in('user_id', profileIds)
      .limit(1000)

    for (const profile of (profiles ?? []) as ProfileRow[]) {
      profilesById.set(profile.user_id, profile)
    }
  }

  const pendingCount = requests.filter((row) => row.status === 'payment_pending').length
  const activeCount = requests.filter((row) => row.status === 'active').length
  const pendingValueCents = requests
    .filter((row) => row.status === 'payment_pending')
    .reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0)
  const activeTokens = passes.reduce((sum, row) => sum + Math.max(0, Number(row.remaining_sessions ?? 0)), 0)

  const clientRows = requests.map((row) => {
    const member = profilesById.get(row.member_id)
    const coach = profilesById.get(row.coach_id)
    return {
      id: row.id,
      memberName: privateCoachingMemberName(member ?? {}),
      memberMeta: profileMeta(member),
      coachName: privateCoachingMemberName(coach ?? {}),
      packageSessions: Number(row.package_sessions ?? 0),
      amountCents: Number(row.amount_cents ?? 0),
      paymentMethod: row.payment_method,
      status: row.status,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    }
  })

  return (
    <main>
      <PageHeader
        title="Private coaching"
        subtitle="Confirm payments and unlock member session tokens."
        right={
          <Button asChild variant="outline" href="/private-coaching">
            Member view
          </Button>
        }
      />

      <Section className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Pending requests</div>
              <div className="mt-1 text-2xl font-semibold">{pendingCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Pending value</div>
              <div className="mt-1 text-2xl font-semibold">{formatPrivateCoachingMoney(pendingValueCents)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Confirmed requests</div>
              <div className="mt-1 text-2xl font-semibold">{activeCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Active tokens</div>
              <div className="mt-1 text-2xl font-semibold">{activeTokens}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Private coaching requests</CardTitle>
          </CardHeader>
          <CardContent>
            <PrivateCoachingAdminClient rows={clientRows} />
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
