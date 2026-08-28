export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import QrImage from '@/components/QrImage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { cairoToday, diffDays } from '@/lib/cairoDate'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type PageProps = {
  searchParams?: {
    member?: string | string[]
  }
}

type GuardianRow = {
  family_id: string
  email: string
  first_name: string | null
  last_name: string | null
  relationship: string | null
  is_primary: boolean
}

type FamilyRow = {
  id: string
  name: string
}

type FamilyMemberLink = {
  family_id: string
  member_id: string
}

type MemberRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  role: string | null
  qr_code: string | null
}

type SubscriptionRow = {
  id: string
  member_id: string
  plan: string | null
  subscription_type: 'time' | 'sessions' | null
  status: 'active' | 'expired' | 'canceled' | 'paused' | null
  start_date: string | null
  end_date: string | null
  frozen_from: string | null
  frozen_until: string | null
  sessions_total: number | null
  sessions_used: number | null
  paid_at: string | null
}

type MembershipView = {
  label: string
  meta: string
  tone: 'success' | 'warning' | 'neutral'
}

function displayName(firstName?: string | null, lastName?: string | null, fallback = 'Member') {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || fallback
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function planLabel(plan?: string | null) {
  switch (plan) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return 'Per sessions'
    default:
      return plan || 'Membership'
  }
}

function isFrozenNow(sub: SubscriptionRow, today: string) {
  if ((sub.subscription_type ?? (sub.plan === 'sessions' ? 'sessions' : 'time')) !== 'time') return false
  if (!sub.frozen_until) return false
  return sub.frozen_from ? today >= sub.frozen_from && today < sub.frozen_until : today < sub.frozen_until
}

function effectiveStatus(sub: SubscriptionRow, today: string) {
  if (sub.status === 'canceled') return 'Canceled'
  if (sub.status === 'expired') return 'Expired'
  if (sub.status === 'paused') return 'Paused'

  const isSessions = (sub.subscription_type ?? (sub.plan === 'sessions' ? 'sessions' : 'time')) === 'sessions'
  if (isSessions) {
    const remaining = Math.max(Number(sub.sessions_total ?? 0) - Number(sub.sessions_used ?? 0), 0)
    return sub.status === 'active' && remaining > 0 ? 'Active' : 'Expired'
  }

  if (sub.end_date && sub.end_date < today) return 'Expired'
  if (isFrozenNow(sub, today)) return 'Frozen'
  return sub.status === 'active' ? 'Active' : 'Inactive'
}

function membershipView(subs: SubscriptionRow[], today: string): MembershipView {
  if (subs.length === 0) {
    return { label: 'No subscription', meta: 'No membership recorded yet.', tone: 'neutral' }
  }

  const current = subs.find((sub) => {
    const status = effectiveStatus(sub, today)
    return status === 'Active' || status === 'Frozen' || status === 'Paused'
  }) ?? subs[0]

  const status = effectiveStatus(current, today)
  const isSessions = (current.subscription_type ?? (current.plan === 'sessions' ? 'sessions' : 'time')) === 'sessions'

  if (isSessions) {
    const total = Number(current.sessions_total ?? 0)
    const used = Number(current.sessions_used ?? 0)
    const remaining = Math.max(total - used, 0)
    return {
      label: `${status} · ${planLabel(current.plan)}`,
      meta: `${remaining} session(s) remaining`,
      tone: status === 'Active' ? 'success' : status === 'Frozen' || status === 'Paused' ? 'warning' : 'neutral',
    }
  }

  const days = current.end_date ? diffDays(today, current.end_date) : null
  const endMeta = current.end_date
    ? status === 'Active' && days !== null && days >= 0
      ? `${days} day(s) left · ends ${fmtDate(current.end_date)}`
      : `End date ${fmtDate(current.end_date)}`
    : 'No end date'

  return {
    label: `${status} · ${planLabel(current.plan)}`,
    meta: endMeta,
    tone: status === 'Active' ? 'success' : status === 'Frozen' || status === 'Paused' ? 'warning' : 'neutral',
  }
}

function toneClasses(tone: MembershipView['tone']) {
  if (tone === 'success') return 'border-emerald-300 bg-emerald-50 text-emerald-950'
  if (tone === 'warning') return 'border-amber-300 bg-amber-50 text-amber-950'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]'
}

export default async function FamilyDashboardPage({ searchParams }: PageProps) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/family')

  const supabase = createSupabaseRSC()
  const { data: guardianData, error: guardianError } = await supabase
    .from('family_guardians')
    .select('family_id,email,first_name,last_name,relationship,is_primary')
    .eq('auth_user_id', me.id)
    .order('is_primary', { ascending: false })

  if (guardianError) {
    return (
      <main>
        <PageHeader title="My Family" subtitle="Your linked ATOM family members." />
        <Section>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Could not load your family account: {guardianError.message}
          </div>
        </Section>
      </main>
    )
  }

  const guardians = (guardianData ?? []) as GuardianRow[]
  if (guardians.length === 0) {
    return (
      <main>
        <PageHeader title="My Family" subtitle="Your linked ATOM family members." />
        <Section className="space-y-4">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="font-semibold">No family account linked</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Your login is not currently registered as a parent account for a family.
            </p>
          </div>
          {me.member_id ? (
            <Link href="/profile" className="inline-flex rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
              Back to my profile
            </Link>
          ) : null}
        </Section>
      </main>
    )
  }

  const familyIds = Array.from(new Set(guardians.map((guardian) => guardian.family_id)))
  const [{ data: familyData }, { data: linkData, error: linkError }] = await Promise.all([
    supabase.from('families').select('id,name').in('id', familyIds).order('name', { ascending: true }),
    supabase.from('family_members').select('family_id,member_id').in('family_id', familyIds),
  ])

  if (linkError) {
    return (
      <main>
        <PageHeader title="My Family" subtitle="Your linked ATOM family members." />
        <Section>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Could not load family members: {linkError.message}
          </div>
        </Section>
      </main>
    )
  }

  const families = (familyData ?? []) as FamilyRow[]
  const links = (linkData ?? []) as FamilyMemberLink[]
  const memberIds = Array.from(new Set(links.map((link) => link.member_id)))

  let members: MemberRow[] = []
  let subscriptions: SubscriptionRow[] = []

  if (memberIds.length > 0) {
    const [{ data: memberData }, { data: subscriptionData }] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,date_of_birth,role,qr_code')
        .in('user_id', memberIds),
      supabase
        .from('subscriptions')
        .select('id,member_id,plan,subscription_type,status,start_date,end_date,frozen_from,frozen_until,sessions_total,sessions_used,paid_at')
        .in('member_id', memberIds)
        .order('paid_at', { ascending: false }),
    ])

    members = (memberData ?? []) as MemberRow[]
    subscriptions = (subscriptionData ?? []) as SubscriptionRow[]
  }

  const familyById = new Map(families.map((family) => [family.id, family]))
  const familyIdByMember = new Map(links.map((link) => [link.member_id, link.family_id]))
  const subscriptionsByMember = new Map<string, SubscriptionRow[]>()

  for (const subscription of subscriptions) {
    const rows = subscriptionsByMember.get(subscription.member_id) ?? []
    rows.push(subscription)
    subscriptionsByMember.set(subscription.member_id, rows)
  }

  members.sort((a, b) => displayName(a.first_name, a.last_name).localeCompare(displayName(b.first_name, b.last_name)))

  const rawSelected = Array.isArray(searchParams?.member) ? searchParams?.member[0] : searchParams?.member
  const selected = members.find((member) => member.user_id === rawSelected) ?? members[0] ?? null
  const today = cairoToday()
  const primaryGuardian = guardians.find((guardian) => guardian.is_primary) ?? guardians[0]
  const selectedSubscriptions = selected ? subscriptionsByMember.get(selected.user_id) ?? [] : []
  const selectedMembership = selected ? membershipView(selectedSubscriptions, today) : null

  return (
    <main>
      <PageHeader title="My Family" subtitle="One login, all linked family members." />

      <Section className="space-y-5">
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Parent account</div>
              <h2 className="mt-1 text-lg font-semibold">
                {displayName(primaryGuardian.first_name, primaryGuardian.last_name, me.full_name ?? 'Parent')}
              </h2>
              <p className="text-sm text-[hsl(var(--muted))]">{primaryGuardian.email}</p>
            </div>
            <span className="rounded-full border bg-gray-50 px-3 py-1 text-xs font-medium">Read only</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {families.map((family) => (
              <span key={family.id} className="rounded-full border bg-white px-3 py-1 text-sm">
                {family.name}
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Family members</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Select a member to view their QR code and current membership.</p>
          </div>

          {members.length === 0 ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
              No members are linked to this family yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {members.map((member) => {
                const family = familyById.get(familyIdByMember.get(member.user_id) ?? '')
                const view = membershipView(subscriptionsByMember.get(member.user_id) ?? [], today)
                const active = selected?.user_id === member.user_id

                return (
                  <Link
                    key={member.user_id}
                    href={`/family?member=${encodeURIComponent(member.user_id)}`}
                    className={`rounded-2xl border p-4 shadow-soft transition hover:-translate-y-0.5 ${
                      active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
                    }`}
                  >
                    <div className="font-semibold">{displayName(member.first_name, member.last_name)}</div>
                    <div className={`mt-1 text-sm ${active ? 'text-white/70' : 'text-[hsl(var(--muted))]'}`}>
                      {member.member_id ?? 'Member ID pending'}
                    </div>
                    {family ? (
                      <div className={`mt-1 text-xs ${active ? 'text-white/60' : 'text-[hsl(var(--muted))]'}`}>{family.name}</div>
                    ) : null}
                    <div className={`mt-3 text-sm font-medium ${active ? 'text-white' : ''}`}>{view.label}</div>
                    <div className={`mt-0.5 text-xs ${active ? 'text-white/70' : 'text-[hsl(var(--muted))]'}`}>{view.meta}</div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {selected && selectedMembership ? (
          <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Selected member</div>
                <h2 className="mt-1 text-xl font-semibold">{displayName(selected.first_name, selected.last_name)}</h2>

                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Member ID</dt>
                    <dd className="font-medium">{selected.member_id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Date of birth</dt>
                    <dd className="font-medium">{fmtDate(selected.date_of_birth)}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Family</dt>
                    <dd className="font-medium">
                      {familyById.get(familyIdByMember.get(selected.user_id) ?? '')?.name ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Profile type</dt>
                    <dd className="font-medium">{selected.role ?? 'member'}</dd>
                  </div>
                </dl>
              </section>

              <section className={`rounded-2xl border p-5 shadow-soft ${toneClasses(selectedMembership.tone)}`}>
                <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-80">Current membership</div>
                <h2 className="mt-1 text-lg font-semibold">{selectedMembership.label}</h2>
                <p className="mt-1 text-sm opacity-90">{selectedMembership.meta}</p>
                <p className="mt-3 text-xs opacity-70">Membership management remains handled by the academy.</p>
              </section>
            </div>

            <section className="flex min-h-[280px] items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
              {selected.qr_code ? (
                <div className="text-center">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Gym QR</div>
                  <div className="mt-3 inline-flex rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                    <QrImage value={selected.qr_code} size={180} />
                  </div>
                  <div className="mt-3 text-sm text-[hsl(var(--muted))]">Show this code at reception when needed.</div>
                </div>
              ) : (
                <div className="text-center text-sm text-[hsl(var(--muted))]">No QR code available for this member.</div>
              )}
            </section>
          </section>
        ) : null}

        {me.member_id ? (
          <div>
            <Link href="/profile" className="inline-flex rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
              View my personal profile
            </Link>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
