// src/components/ProfileSubscriptions.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'
import ProfileSubscriptionsHistoryClient from './ProfileSubscriptionsHistoryClient'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'
export type SubRow = {
  id: number
  plan: Plan
  subscription_type: 'time' | 'sessions' | null
  status: 'active' | 'paused' | 'canceled' | 'expired' | string | null
  start_date: string | null // YYYY-MM-DD
  end_date: string | null   // YYYY-MM-DD
  amount: number | null
  paid_at: string | null    // ISO
  sessions_total: number | null
  sessions_used: number | null
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const date = d.length <= 10 ? new Date(d + 'T00:00:00Z') : new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtAmount(n?: number | null) {
  if (n == null) return '—'
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return Number(n).toFixed(2)
  }
}

function humanPlan(p: Plan) {
  const map: Record<Plan, string> = {
    '1m': '1 month',
    '3m': '3 months',
    '6m': '6 months',
    '12m': '12 months',
    'sessions': 'Per sessions',
  }
  return map[p] ?? p
}

function isActive(row: SubRow): { active: boolean; remaining?: number | null } {
  const todayStr = new Date().toISOString().slice(0, 10)

  if (row.plan === 'sessions') {
    const total = row.sessions_total ?? 0
    const used = row.sessions_used ?? 0
    const remaining = Math.max(total - used, 0)
    const active = (row.status === 'active') && remaining > 0
    return { active, remaining }
  }

  const active =
    row.status === 'active' &&
    (!!row.end_date && row.end_date >= todayStr)

  return { active }
}

function StatusPill({ row }: { row: SubRow }) {
  const { active } = isActive(row)
  const label = active ? 'Active' : (row.status ?? 'Inactive')
  const cls = active
    ? 'border-green-600 text-green-700 bg-green-50'
    : 'border-gray-400 text-gray-700 bg-gray-50'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  )
}

function RowSummary({ row }: { row: SubRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50">
        {humanPlan(row.plan)}
      </span>
      <span className="text-xs text-gray-500">
        {fmtDate(row.start_date)} → {fmtDate(row.end_date)}
      </span>
      <span className="ml-auto">
        <StatusPill row={row} />
      </span>
    </div>
  )
}

export default async function ProfileSubscriptions() {
  const user = await getSessionUser()
  if (!user) {
    return (
      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Subscriptions</h2>
        <div className="text-sm text-gray-600">Please sign in to view your subscriptions.</div>
      </section>
    )
  }

  const supa = createSupabaseRSC()
  const { data, error } = await supa
    .from('subscriptions')
    .select('id, plan, subscription_type, status, start_date, end_date, amount, paid_at, sessions_total, sessions_used')
    .eq('member_id', user.id)
    .order('start_date', { ascending: false }) as { data: SubRow[] | null, error: any }

  if (error) {
    return (
      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Subscriptions</h2>
        <div className="text-sm text-red-600">Failed to load subscriptions.</div>
      </section>
    )
  }

  const rows = (data ?? [])
  const activeRows = rows.filter((r) => isActive(r).active)
  const current = activeRows[0] ?? null
  const history = rows.filter((r) => !current || r.id !== current.id)

  return (
    <section className="mt-6 space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Subscriptions</h2>
        <p className="text-sm text-gray-500">Your membership status at a glance.</p>
      </header>

      {/* === Abonnement courant === */}
      {current ? (
        <article className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <RowSummary row={current} />
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-gray-500">Paid</dt>
                  <dd className="font-medium">{fmtAmount(current.amount)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Paid at</dt>
                  <dd className="font-medium">{fmtDate(current.paid_at)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Type</dt>
                  <dd className="font-medium capitalize">{current.subscription_type || '—'}</dd>
                </div>
              </dl>
            </div>

            {current.plan === 'sessions' && (
              <div className="ml-auto text-right">
                <div className="text-xs text-gray-600">Sessions remaining</div>
                <div className="text-3xl font-extrabold tabular-nums text-black">
                  {(() => {
                    const rem = isActive(current).remaining
                    return typeof rem === 'number' ? rem : '—'
                  })()}
                </div>
                <div className="text-xs text-gray-500">
                  used {current.sessions_used ?? 0} / {current.sessions_total ?? '—'}
                </div>
              </div>
            )}
          </div>
        </article>
      ) : (
        <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600">
          You don’t have an active subscription.
        </div>
      )}

      {/* === Historique (client; tronqué à 5 avec “Show more”) === */}
      {history.length > 0 && (
        <ProfileSubscriptionsHistoryClient
          rows={history}
          title="History"
          initiallyVisible={5}
        />
      )}
    </section>
  )
}
