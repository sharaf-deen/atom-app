// src/app/profile/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import QrImage from '@/components/QrImage'
import ProfileIdPhoto from '@/components/ProfileIdPhoto'
import type { Plan } from '@/components/SubscribeDialog'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'

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
  subscription_type: 'time' | 'sessions' | null
  plan: Plan | null
  status: 'active' | 'expired' | 'canceled' | 'paused' | null
  start_date: string | null
  end_date: string | null
  sessions_total: number | null
  sessions_used: number | null
  amount: number | null
  paid_at: string | null
}

function ageYears(dob?: string | null) {
  if (!dob) return null
  const dateOnly = dob.length === 10 ? dob : dob.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null
  const [y, m, d] = dateOnly.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(born.getTime())) return null

  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
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

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function daysLeft(endDate?: string | null) {
  if (!endDate) return null
  const t = todayDateOnlyUTC()
  const ms = new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${t}T00:00:00Z`).getTime()
  return Math.floor(ms / 86400000)
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
    .select('id, subscription_type, plan, status, start_date, end_date, sessions_total, sessions_used, amount, paid_at')
    .eq('member_id', me.id)
    .order('paid_at', { ascending: false })
    .limit(500)) as { data: SubRow[] | null }

  const canManagePhoto = ['member', 'coach', 'assistant_coach'].includes(me.role)

  return (
    <main>
      <PageHeader title="Profile" subtitle="Your account info" />

      <Section className="space-y-6">
        
        {/* Profile photo */}
        {canManagePhoto ? (
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="font-semibold">Profile photo</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Upload a square photo (JPG/PNG/WEBP). Max 5 MB.
            </p>
            <div className="mt-4">
              <ProfileIdPhoto userId={me.id} idPhotoPath={p.id_photo_path} />
            </div>
          </section>
        ) : null}
        
        {/* Identity + QR */}
        <section className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="font-semibold">Identity</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <div>
                <span className="text-[hsl(var(--muted))]">Name:</span>{' '}
                {(p.first_name || p.last_name) ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '—'}
              </div>
              <div>
                <span className="text-[hsl(var(--muted))]">Email:</span> {p.email ?? '—'}
              </div>
              <div>
                <span className="text-[hsl(var(--muted))]">Phone:</span> {p.phone ?? '—'}
              </div>
              <div>
                <span className="text-[hsl(var(--muted))]">Date of birth:</span> {fmtDate(p.date_of_birth)}
              </div>
              <div>
                <span className="text-[hsl(var(--muted))]">Category:</span>{' '}
                {ageGroup(p.date_of_birth) ? `${ageGroup(p.date_of_birth)} (${ageYears(p.date_of_birth)}y)` : '—'}
              </div>
              <div>
                <span className="text-[hsl(var(--muted))]">Role:</span> {p.role ?? 'member'}
              </div>
              {p.member_id ? (
                <div>
                  <span className="text-[hsl(var(--muted))]">Member ID:</span> {p.member_id}
                </div>
              ) : null}
              {p.created_at ? (
                <div>
                  <span className="text-[hsl(var(--muted))]">Joined:</span> {fmtDate(p.created_at)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft flex items-center justify-center">
            {p.qr_code ? (
              <div className="text-center">
                <QrImage value={p.qr_code} size={180} />
                <div className="text-xs text-[hsl(var(--muted))] mt-2">Show this code at reception</div>
              </div>
            ) : (
              <div className="text-sm text-[hsl(var(--muted))]">No QR code.</div>
            )}
          </div>
        </section>

        {/* Subscriptions (no attendance for member/coach/assistant coach) */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Subscriptions</h2>
          </div>

          {(subs ?? []).length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">No subscriptions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[hsl(var(--muted))]">
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Plan</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Start</th>
                    <th className="text-left px-3 py-2">End</th>
                    <th className="text-left px-3 py-2">Sessions</th>
                    <th className="text-left px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Paid at</th>
                    <th className="text-left px-3 py-2">Badges</th>
                  </tr>
                </thead>
                <tbody>
                  {(subs ?? []).map((s) => {
                    const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
                    const dleft = s.subscription_type === 'time' ? daysLeft(s.end_date) : null
                    const expired = s.status === 'expired' || (dleft !== null && dleft < 0)

                    return (
                      <tr key={s.id} className="border-t border-[hsl(var(--border))]">
                        <td className="px-3 py-2">{s.subscription_type ?? '—'}</td>
                        <td className="px-3 py-2">{humanPlan(s.plan)}</td>
                        <td className="px-3 py-2">{s.status ?? '—'}</td>
                        <td className="px-3 py-2">{fmtDate(s.start_date)}</td>
                        <td className="px-3 py-2">{fmtDate(s.end_date)}</td>
                        <td className="px-3 py-2">
                          {s.subscription_type === 'sessions'
                            ? `${s.sessions_used ?? 0}/${s.sessions_total ?? 0}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2">{s.amount ?? 0}</td>
                        <td className="px-3 py-2">{fmtDate(s.paid_at)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {s.subscription_type === 'time' && dleft !== null && dleft >= 0 && (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                                  dleft <= 7
                                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                }`}
                              >
                                {dleft} day(s) left
                              </span>
                            )}
                            {expired && (
                              <span className="text-[11px] px-2 py-0.5 rounded-2xl border bg-rose-50 border-rose-300 text-rose-900">
                                expired
                              </span>
                            )}
                            {s.subscription_type === 'sessions' && (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-2xl border ${
                                  remaining <= 2
                                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                }`}
                              >
                                {remaining} left
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Section>
    </main>
  )
}
