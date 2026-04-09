// src/app/profile/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import QrImage from '@/components/QrImage'
import ProfileIdPhoto from '@/components/ProfileIdPhoto'
import AthleteProfileSection from '@/components/member-detail/AthleteProfileSection'
import type { Plan } from '@/components/SubscribeDialog'
import { hasLifetimeGymAccess } from '@/lib/rbac'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'
import { cairoToday, diffDays } from '@/lib/cairoDate'

type ProfileRow = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  member_id: string | null
  qr_code: string | null
  id_photo_path: string | null
  date_of_birth: string | null
  created_at: string | null
}

type SubRow = {
  id: string
  plan: Plan | null
  subscription_type: 'time' | 'sessions' | null
  status: 'active' | 'expired' | 'canceled' | 'paused' | null
  start_date: string | null
  end_date: string | null
  frozen_from: string | null
  frozen_until: string | null
  sessions_total: number | null
  sessions_used: number | null
  amount: number | null
  amount_due: number | null
  payment_method: string | null
  paid_at: string | null
}

type MembershipSummary = {
  tone: 'success' | 'warning' | 'neutral'
  eyebrow: string
  title: string
  meta: string
  extra?: string | null
  currentId: string | null
}

function ageYears(dob?: string | null) {
  if (!dob) return null
  const dateOnly = dob.length === 10 ? dob : dob.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null
  const [y, m, d] = dateOnly.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(born.getTime())) return null

  const [ty, tm, td] = cairoToday().split('-').map(Number)
  const today = new Date(Date.UTC(ty, tm - 1, td))
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  if (age < 0) return null
  return age
}

function ageGroup(dob?: string | null) {
  const age = ageYears(dob)
  if (age === null) return null
  return age < 17 ? 'Kid' : 'Adult'
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function daysLeft(endDate?: string | null) {
  if (!endDate) return null
  return diffDays(cairoToday(), endDate)
}

function shouldShowAthleteProfileOnSelfProfile(role?: Role | null) {
  return role === 'member' || role === 'coach' || role === 'assistant_coach' || role === 'vip' || role === 'champion'
}

function humanPlan(p?: Plan | null) {
  switch (p) {
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
      return '—'
  }
}

function fmtMoneyEGP(v?: number | null) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0 EGP'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function isFrozenNow(sub: Pick<SubRow, 'subscription_type' | 'frozen_from' | 'frozen_until'>, today: string) {
  const st = (sub.subscription_type ?? 'time') as 'time' | 'sessions'
  if (st !== 'time') return false
  const until = sub.frozen_until
  if (!until) return false
  const from = sub.frozen_from
  return from ? today >= from && today < until : today < until
}

function buildMembershipSummary(role: Role, subs: SubRow[], today: string): MembershipSummary {
  if (hasLifetimeGymAccess(role)) {
    return {
      tone: 'success',
      eyebrow: 'Always active access',
      title: 'Access active',
      meta: 'Your role keeps your gym access active without a standard renewal flow.',
      extra: null,
      currentId: null,
    }
  }

  const activeTime = subs.find((s) => {
    if (s.status !== 'active') return false
    if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'time') return false
    if (!s.end_date || s.end_date < today) return false
    if (isFrozenNow(s, today)) return false
    return true
  })

  if (activeTime) {
    const dleft = activeTime.end_date ? diffDays(today, activeTime.end_date) : null
    const due = Number(activeTime.amount_due ?? 0)
    return {
      tone: dleft !== null && dleft <= 7 ? 'warning' : 'success',
      eyebrow: dleft !== null && dleft <= 7 ? 'Ends soon' : 'Membership active',
      title: humanPlan(activeTime.plan),
      meta:
        dleft === null
          ? 'Membership active'
          : dleft === 0
            ? `Ends today · ${fmtDate(activeTime.end_date)}`
            : `${dleft} day(s) left · ends ${fmtDate(activeTime.end_date)}`,
      extra: due > 0 ? `Amount due: ${fmtMoneyEGP(due)}` : null,
      currentId: activeTime.id,
    }
  }

  const activeSessions = subs.find((s) => {
    if (s.status !== 'active') return false
    if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'sessions') return false
    const remaining = Math.max(Number(s.sessions_total ?? 0) - Number(s.sessions_used ?? 0), 0)
    return remaining > 0
  })

  if (activeSessions) {
    const remaining = Math.max(Number(activeSessions.sessions_total ?? 0) - Number(activeSessions.sessions_used ?? 0), 0)
    const total = Number(activeSessions.sessions_total ?? 0)
    const due = Number(activeSessions.amount_due ?? 0)
    return {
      tone: remaining <= 2 ? 'warning' : 'success',
      eyebrow: remaining <= 2 ? 'Low sessions left' : 'Sessions active',
      title: `${remaining} session(s) left`,
      meta: `${Math.max(total - remaining, 0)}/${total} used`,
      extra: due > 0 ? `Amount due: ${fmtMoneyEGP(due)}` : null,
      currentId: activeSessions.id,
    }
  }

  const latest = subs[0]
  if (latest) {
    return {
      tone: 'neutral',
      eyebrow: 'No active membership',
      title: humanPlan(latest.plan),
      meta: latest.end_date ? `Last ended ${fmtDate(latest.end_date)}` : `Last update ${fmtDate(latest.paid_at)}`,
      extra: Number(latest.amount_due ?? 0) > 0 ? `Amount due: ${fmtMoneyEGP(Number(latest.amount_due ?? 0))}` : null,
      currentId: null,
    }
  }

  return {
    tone: 'neutral',
    eyebrow: 'No subscription yet',
    title: 'Not started',
    meta: 'Contact reception to create or renew a subscription.',
    extra: null,
    currentId: null,
  }
}

function toneClasses(tone: MembershipSummary['tone']) {
  switch (tone) {
    case 'success':
      return 'border-emerald-300 bg-emerald-50 text-emerald-950'
    case 'warning':
      return 'border-amber-300 bg-amber-50 text-amber-950'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]'
  }
}

export default async function ProfilePage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/profile')

  const supa = createSupabaseRSC()

  const { data: profile } = await supa
    .from('profiles')
    .select('user_id, email, first_name, last_name, phone, role, member_id, qr_code, id_photo_path, date_of_birth, created_at')
    .eq('user_id', me.id)
    .maybeSingle()

  const p: ProfileRow = {
    user_id: me.id,
    email: profile?.email ?? me.email ?? null,
    first_name: profile?.first_name ?? me.first_name ?? null,
    last_name: profile?.last_name ?? me.last_name ?? null,
    phone: profile?.phone ?? me.phone ?? null,
    role: profile?.role ?? me.role ?? 'member',
    member_id: profile?.member_id ?? me.member_id ?? null,
    qr_code: profile?.qr_code ?? me.qr_code ?? null,
    id_photo_path: profile?.id_photo_path ?? me.id_photo_path ?? null,
    date_of_birth: (profile as any)?.date_of_birth ?? null,
    created_at: profile?.created_at ?? null,
  }

  const { data: subs } = (await supa
    .from('subscriptions')
    .select('id, plan, subscription_type, status, start_date, end_date, frozen_from, frozen_until, sessions_total, sessions_used, amount, amount_due, payment_method, paid_at')
    .eq('member_id', me.id)
    .order('paid_at', { ascending: false })
    .limit(500)) as { data: SubRow[] | null }

  const canManagePhoto = ['member', 'coach', 'assistant_coach'].includes(me.role)
  const rows = subs ?? []
  const summary = buildMembershipSummary(p.role ?? me.role ?? 'member', rows, cairoToday())
  const historyRows = summary.currentId ? rows.filter((s) => s.id !== summary.currentId) : rows

  return (
    <main>
      <PageHeader title="Profile" subtitle="Identity, access and QR." />

      <Section className="space-y-5">
        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {canManagePhoto ? (
              <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Profile photo</h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">Keep your photo clear and up to date.</p>
                  </div>
                </div>
                <div className="mt-4">
                  <ProfileIdPhoto userId={me.id} idPhotoPath={p.id_photo_path} />
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Identity</h2>
                  <p className="mt-1 text-sm text-[hsl(var(--muted))]">Your main details at a glance.</p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <dl className="grid gap-3 text-sm">
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Name</dt>
                    <dd className="font-medium">
                      {(p.first_name || p.last_name) ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Member ID</dt>
                    <dd className="font-medium">{p.member_id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Role</dt>
                    <dd className="font-medium">{p.role ?? 'member'}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Joined</dt>
                    <dd className="font-medium">{fmtDate(p.created_at)}</dd>
                  </div>
                </dl>

                <dl className="grid gap-3 text-sm">
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Email</dt>
                    <dd className="font-medium break-all">{p.email ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Phone</dt>
                    <dd className="font-medium">{p.phone ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Date of birth</dt>
                    <dd className="font-medium">{fmtDate(p.date_of_birth)}</dd>
                  </div>
                  <div>
                    <dt className="text-[hsl(var(--muted))]">Category</dt>
                    <dd className="font-medium">
                      {ageGroup(p.date_of_birth) ? `${ageGroup(p.date_of_birth)} (${ageYears(p.date_of_birth)}y)` : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className={`rounded-2xl border p-5 shadow-soft ${toneClasses(summary.tone)}`}>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-80">{summary.eyebrow}</div>
                <h2 className="text-lg font-semibold">{summary.title}</h2>
                <p className="text-sm opacity-90">{summary.meta}</p>
                {summary.extra ? <p className="text-sm font-medium">{summary.extra}</p> : null}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft flex items-center justify-center">
            {p.qr_code ? (
              <div className="text-center">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Gym QR</div>
                <div className="mt-3 inline-flex rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                  <QrImage value={p.qr_code} size={180} />
                </div>
                <div className="mt-3 text-sm text-[hsl(var(--muted))]">Show this code at reception when needed.</div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Gym QR</div>
                <div className="mt-3 text-sm text-[hsl(var(--muted))]">No QR code yet.</div>
              </div>
            )}
          </section>
        </section>

        {shouldShowAthleteProfileOnSelfProfile(p.role ?? me.role ?? 'member') ? (
          <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <summary className="cursor-pointer list-none">
              <div>
                <h2 className="font-semibold">Athlete profile</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">Training details, belts and competition history.</p>
              </div>
            </summary>
            <div className="mt-4">
              <AthleteProfileSection
                memberUserId={me.id}
                targetRole={p.role ?? me.role ?? 'member'}
                viewerRole={me.role}
                isSelf
                age={ageYears(p.date_of_birth)}
                nextPath="/profile"
                allowEdit={false}
              />
            </div>
          </details>
        ) : null}

        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-4">
          <div>
            <h2 className="font-semibold">Membership history</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Older plans and renewals.</p>
          </div>

          {historyRows.length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">Nothing else to show yet.</div>
          ) : (
            <details>
              <summary className="cursor-pointer list-none rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-3 text-sm font-medium shadow-soft">
                Show history ({historyRows.length})
              </summary>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {historyRows.map((s) => {
                  const isSessions = (s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) === 'sessions'
                  const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
                  const dleft = !isSessions ? daysLeft(s.end_date) : null
                  const due = Number(s.amount_due ?? 0)

                  return (
                    <article
                      key={s.id}
                      className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft space-y-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50">
                          {humanPlan(s.plan)}
                        </span>
                        <span className="text-xs text-[hsl(var(--muted))]">
                          {fmtDate(s.start_date)} → {fmtDate(s.end_date)}
                        </span>
                        <span className="ml-auto rounded-full border bg-gray-50 px-2 py-0.5 text-[11px]">
                          {s.status ?? '—'}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm">
                        {isSessions ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[hsl(var(--muted))]">Sessions</div>
                            <div className="font-medium">
                              {s.sessions_used ?? 0}/{s.sessions_total ?? 0} · {remaining} left
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[hsl(var(--muted))]">End</div>
                            <div className="font-medium">{fmtDate(s.end_date)}</div>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[hsl(var(--muted))]">Paid at</div>
                          <div className="font-medium">{fmtDate(s.paid_at)}</div>
                        </div>

                        {due > 0 ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[hsl(var(--muted))]">Amount due</div>
                            <div className="font-medium">{fmtMoneyEGP(due)}</div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {!isSessions && dleft !== null && dleft >= 0 ? (
                          <span className="rounded-2xl border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-900">
                            {dleft} day(s) left
                          </span>
                        ) : null}
                        {!isSessions && dleft !== null && dleft < 0 ? (
                          <span className="rounded-2xl border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-900">
                            expired
                          </span>
                        ) : null}
                        {isSessions ? (
                          <span
                            className={`rounded-2xl border px-2 py-0.5 text-[11px] ${
                              remaining <= 2
                                ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            }`}
                          >
                            {remaining} left
                          </span>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            </details>
          )}
        </section>
      </Section>
    </main>
  )
}
