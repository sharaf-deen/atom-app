// src/app/members/[id]/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'
import QrImage from '@/components/QrImage'
import SubscribeDialog, { type Plan } from '@/components/SubscribeDialog'

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}
function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
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
    case '1m': return '1 month'
    case '3m': return '3 months'
    case '6m': return '6 months'
    case '12m': return '12 months'
    case 'sessions': return 'Per sessions'
    default: return '—'
  }
}

export default async function MemberDetailPage({ params }: { params: { id: string } }) {
  const me = await getSessionUser()
  if (!me) {
    redirect(`/login?next=${encodeURIComponent(`/members/${params.id}`)}`)
  }

  const STAFF: Role[] = ['reception', 'admin', 'super_admin']
  const isStaff = STAFF.includes(me.role)
  const isSelf = me.id === params.id

  if (!isStaff && !isSelf) {
    return (
      <main>
        <PageHeader title="Member" subtitle="Access restricted" />
        <Section>
          <AccessDeniedCard
            title="Forbidden"
            message="You don’t have permission to view this member."
            nextPath={`/members/${params.id}`}
            showBackHome
          />
        </Section>
      </main>
    )
  }

  const supa = createSupabaseRSC()

  const { data: profile } = await supa
    .from('profiles')
    .select('user_id, email, first_name, last_name, phone, role, qr_code, created_at')
    .eq('user_id', params.id)
    .maybeSingle<{
      user_id: string
      email: string | null
      first_name: string | null
      last_name: string | null
      phone: string | null
      role: Role | null
      qr_code: string | null
      created_at: string | null
    }>()

  if (!profile) return notFound()

  const { data: subs } = await supa
    .from('subscriptions')
    .select('id, subscription_type, plan, status, start_date, end_date, sessions_total, sessions_used, amount, paid_at')
    .eq('member_id', profile.user_id)
    .order('paid_at', { ascending: false })
    .limit(500) as {
      data: Array<{
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
      }> | null
    }

  const today = todayDateOnlyUTC()
  const from = addDays(today, -30)
  const { data: attendance } = await supa
    .from('attendance')
    .select('id, date, valid, from_sessions, subscription_id')
    .eq('member_id', profile.user_id)
    .gte('date', from)
    .lte('date', today)
    .order('date', { ascending: false })
    .limit(1000) as {
      data: Array<{ id: string; date: string; valid: boolean | null; from_sessions: boolean | null; subscription_id: string | null }> | null
    }

  const subPlanById = new Map<string, Plan | null>((subs ?? []).map((s) => [s.id, s.plan]))

  const activeTime = (subs ?? []).filter((s) => s.subscription_type === 'time' && s.status === 'active')
  const activeSessions = (subs ?? []).filter((s) => s.subscription_type === 'sessions' && s.status === 'active')
  const alerts: Array<{ kind: 'time' | 'sessions'; text: string }> = []

  for (const s of activeTime) {
    const dl = daysLeft(s.end_date)
    if (dl !== null && dl <= 7) alerts.push({ kind: 'time', text: `Time plan ${humanPlan(s.plan)} expires in ${dl} day(s)` })
  }
  for (const s of activeSessions) {
    const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
    if (remaining <= 2) alerts.push({ kind: 'sessions', text: `Sessions plan: only ${remaining} session(s) left` })
  }

  return (
    <main>
      <PageHeader
        title="Member"
        subtitle="Profile, QR, subscriptions and attendance"
        right={
          isStaff ? (
            <Link href="/members" className="px-4 py-2 rounded-2xl border border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--bg))]/80 shadow-soft text-sm">
              Back to list
            </Link>
          ) : null
        }
      />

      <Section className="space-y-6">
        {/* Identity + QR */}
        <section className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="font-semibold">Identity</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <div>
                <span className="text-[hsl(var(--muted))]">Name:</span>{' '}
                {(profile.first_name || profile.last_name)
                  ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
                  : '—'}
              </div>
              <div><span className="text-[hsl(var(--muted))]">Email:</span> {profile.email ?? '—'}</div>
              <div><span className="text-[hsl(var(--muted))]">Phone:</span> {profile.phone ?? '—'}</div>
              <div><span className="text-[hsl(var(--muted))]">Role:</span> {profile.role ?? 'member'}</div>
              <div><span className="text-[hsl(var(--muted))]">Joined:</span> {fmtDate(profile.created_at)}</div>
              <div className="mt-2 text-[11px] text-[hsl(var(--muted))] break-all">
                <span className="text-[hsl(var(--muted))]">QR value:</span> {profile.qr_code ?? '—'}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft flex items-center justify-center">
            {profile.qr_code ? (
              <div className="text-center">
                <QrImage value={profile.qr_code} size={180} />
                <div className="text-xs text-[hsl(var(--muted))] mt-2">Show this code at reception</div>
              </div>
            ) : (
              <div className="text-sm text-[hsl(var(--muted))]">No QR code.</div>
            )}
          </div>
        </section>

        {/* Alerts */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <h2 className="font-semibold">Alerts</h2>
          {alerts.length === 0 ? (
            <div className="mt-2 text-sm text-[hsl(var(--muted))]">No alerts.</div>
          ) : (
            <ul className="mt-3 grid gap-2">
              {alerts.map((a, i) => (
                <li
                  key={i}
                  className={`text-sm px-3 py-2 rounded-2xl border
                  ${a.kind === 'time'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-rose-50 border-rose-300 text-rose-900'}`}
                >
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Subscriptions */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Subscriptions</h2>

            {isStaff && (
              <div className="ml-auto">
                <SubscribeDialog
                  member={{
                    user_id: profile.user_id,
                    email: profile.email,
                    first_name: profile.first_name,
                    last_name: profile.last_name,
                  }}
                  buttonLabel="New subscription"
                  defaultPlan="1m"
                  defaultSessions={10}
                />
              </div>
            )}
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
                    const isTime = s.subscription_type === 'time'
                    const remaining = Math.max((s.sessions_total ?? 0) - (s.sessions_used ?? 0), 0)
                    const dleft = daysLeft(s.end_date)
                    const soon = isTime && dleft !== null && dleft <= 7 && dleft >= 0
                    const expired = s.status === 'expired' || (isTime && (dleft ?? -999) < 0)

                    return (
                      <tr key={s.id} className="border-t border-[hsl(var(--border))]">
                        <td className="px-3 py-2">{s.subscription_type ?? '—'}</td>
                        <td className="px-3 py-2">{humanPlan(s.plan)}</td>
                        <td className="px-3 py-2">{s.status ?? '—'}</td>
                        <td className="px-3 py-2">{fmtDate(s.start_date)}</td>
                        <td className="px-3 py-2">{fmtDate(s.end_date)}</td>
                        <td className="px-3 py-2">
                          {s.subscription_type === 'sessions'
                            ? `${s.sessions_used ?? 0}/${s.sessions_total ?? 0} (left ${remaining})`
                            : '—'}
                        </td>
                        <td className="px-3 py-2">{s.amount ?? 0}</td>
                        <td className="px-3 py-2">{fmtDate(s.paid_at)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {isTime && typeof dleft === 'number' && dleft >= 0 && (
                              <span className={`text-[11px] px-2 py-0.5 rounded-2xl border
                                ${soon ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-300 text-emerald-900'}`}>
                                {dleft} day(s) left
                              </span>
                            )}
                            {expired && (
                              <span className="text-[11px] px-2 py-0.5 rounded-2xl border bg-rose-50 border-rose-300 text-rose-900">
                                expired
                              </span>
                            )}
                            {s.subscription_type === 'sessions' && (
                              <span className={`text-[11px] px-2 py-0.5 rounded-2xl border
                                ${(remaining <= 2) ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-300 text-emerald-900'}`}>
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

        {/* Attendance */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <h2 className="font-semibold">Attendance (last 30 days)</h2>
          {(attendance ?? []).length === 0 ? (
            <div className="mt-2 text-sm text-[hsl(var(--muted))]">No attendance.</div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[hsl(var(--muted))]">
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Valid</th>
                    <th className="text-left px-3 py-2">From sessions</th>
                    <th className="text-left px-3 py-2">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {(attendance ?? []).map((a) => (
                    <tr key={a.id} className="border-t border-[hsl(var(--border))]">
                      <td className="px-3 py-2">{fmtDate(a.date)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded-2xl border
                          ${a.valid ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'}`}>
                          {a.valid ? 'valid' : 'invalid'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{a.from_sessions ? 'yes' : 'no'}</td>
                      <td className="px-3 py-2">
                        {a.subscription_id ? humanPlan(subPlanById.get(a.subscription_id) ?? null) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Section>
    </main>
  )
}
