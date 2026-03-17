// src/app/admin/payments/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Badge from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
import EditPaymentDateButton from '@/components/EditPaymentDateButton'
import { addDaysDateOnly, cairoDayBoundsUTC, cairoTodayDateOnly, isISODateOnly } from '@/lib/cairoTime'
import type { Role } from '@/lib/session'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

const ALLOWED: Role[] = ['admin', 'super_admin']
const PAGE_SIZE = 50

type ProfileLite = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

type PaymentRow = {
  id: string
  subscription_id: string
  member_id: string
  amount: number
  payment_method: string
  note: string | null
  paid_at: string
  created_at: string
  member: ProfileLite | null
  actor: { user_id: string; email: string | null; first_name: string | null; last_name: string | null } | null
}

function formatEGP(n: number) {
  const v = Number(n ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)
  } catch {
    return `${v.toFixed(2)} EGP`
  }
}

function labelMethod(m: string) {
  const s = String(m || 'cash')
  if (s === 'cash') return 'Cash'
  if (s === 'instapay') return 'Instapay'
  if (s === 'card') return 'Card'
  if (s === 'bank_transfer') return 'Bank transfer'
  if (s === 'visa') return 'Card'
  return s
}

function badgeClassForMethod(m: string) {
  const s = String(m || 'cash')
  if (s === 'cash') return 'bg-emerald-50 text-emerald-700'
  if (s === 'instapay') return 'bg-sky-50 text-sky-700'
  if (s === 'card' || s === 'visa') return 'bg-violet-50 text-violet-700'
  if (s === 'bank_transfer') return 'bg-amber-50 text-amber-800'
  return ''
}

function safeQ(v: unknown) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, 80)
}

function sp1(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = sp[key]
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}

function formatCairoDateTime(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return '—'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt)
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/payments')

  if (!ALLOWED.includes(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Payments</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access this page."
            nextPath="/admin/payments"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const todayCairo = cairoTodayDateOnly()
  const fromRaw = sp1(searchParams, 'from')
  const toRaw = sp1(searchParams, 'to')
  const from = isISODateOnly(fromRaw) ? fromRaw! : todayCairo
  const to = isISODateOnly(toRaw) ? toRaw! : from

  const payment_method = sp1(searchParams, 'payment_method') ?? 'all'
  const q = safeQ(sp1(searchParams, 'q'))

  const page = Math.max(1, Number(sp1(searchParams, 'page') ?? '1') || 1)
  const fromIdx = (page - 1) * PAGE_SIZE
  const toIdx = fromIdx + PAGE_SIZE - 1

  const admin = getSupabaseAdminClientCached()

  const startISO = cairoDayBoundsUTC(from).startISO
  const endISO = cairoDayBoundsUTC(addDaysDateOnly(to, 1)).startISO

  let memberIds: string[] | null = null
  if (q) {
    const like = `%${q.replace(/%/g, '')}%`
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id')
      .or(
        `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},member_id.ilike.${like}`
      )
      .limit(200)

    memberIds = (profs ?? []).map((p: any) => p.user_id).filter(Boolean)
    if (!memberIds.length) memberIds = []
  }

  let query = admin
    .from('subscription_payments')
    .select(
      'id, subscription_id, member_id, amount, payment_method, note, paid_at, created_at, member:profiles!subscription_payments_member_id_fkey(user_id,member_id,email,first_name,last_name,phone), actor:profiles!subscription_payments_created_by_fkey(user_id,email,first_name,last_name)',
      { count: 'exact' }
    )
    .gte('paid_at', startISO)
    .lt('paid_at', endISO)
    .order('paid_at', { ascending: false })

  if (payment_method && payment_method !== 'all') query = query.eq('payment_method', payment_method)
  if (memberIds) {
    if (!memberIds.length) query = query.in('member_id', ['00000000-0000-0000-0000-000000000000'])
    else query = query.in('member_id', memberIds)
  }

  const { data: rowsRaw, error: err, count } = await query.range(fromIdx, toIdx)

  const rows: PaymentRow[] = ((rowsRaw ?? []) as any[]).map((r) => ({
    id: String(r.id),
    subscription_id: String(r.subscription_id),
    member_id: String(r.member_id),
    amount: Number(r.amount ?? 0),
    payment_method: String(r.payment_method ?? 'cash'),
    note: r.note ?? null,
    paid_at: String(r.paid_at ?? r.created_at),
    created_at: String(r.created_at),
    member: (r.member ?? null) as any,
    actor: (r.actor ?? null) as any,
  }))

  let totals = { all: 0, cash: 0, instapay: 0, card: 0, bank_transfer: 0 }

  try {
    let q2 = admin
      .from('subscription_payments')
      .select('amount, payment_method, member_id')
      .gte('paid_at', startISO)
      .lt('paid_at', endISO)
      .limit(10000)

    if (payment_method && payment_method !== 'all') q2 = q2.eq('payment_method', payment_method)
    if (memberIds) {
      if (!memberIds.length) q2 = q2.in('member_id', ['00000000-0000-0000-0000-000000000000'])
      else q2 = q2.in('member_id', memberIds)
    }

    const { data: allRows } = await q2
    for (const r of (allRows ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      totals.all += amt
      const pm = String(r.payment_method ?? 'cash')
      if (pm === 'cash') totals.cash += amt
      else if (pm === 'instapay') totals.instapay += amt
      else if (pm === 'card' || pm === 'visa') totals.card += amt
      else if (pm === 'bank_transfer') totals.bank_transfer += amt
    }
  } catch {
    // ignore totals failure
  }

  const totalPages = Math.max(1, Math.ceil(Number(count ?? 0) / PAGE_SIZE))

  const qsBase = new URLSearchParams({
    from,
    to,
    payment_method,
    q,
  })

  const navLink = (p: number) => {
    const sp = new URLSearchParams(qsBase)
    sp.set('page', String(p))
    return `/admin/payments?${sp.toString()}`
  }

  const tableColumns = [
    { key: 'paid_when', header: 'Paid at (EG)' },
    { key: 'recorded_when', header: 'Recorded at', hideOnMobile: true },
    { key: 'member', header: 'Member' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
    { key: 'note', header: 'Note', hideOnMobile: true },
    { key: 'by', header: 'By', hideOnMobile: true },
    { key: 'edit_date', header: '', tdClassName: 'whitespace-normal' },
    { key: 'open', header: '' },
  ]

  const tableRows = rows.map((r) => {
    const name = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || r.member?.email || '—'
    const by = `${r.actor?.first_name ?? ''} ${r.actor?.last_name ?? ''}`.trim() || r.actor?.email || '—'
    const memberLabel = `${name}${r.member?.member_id ? ` · ${r.member.member_id}` : ''}`
    return {
      id: r.id,
      paid_when: <span className="font-medium">{formatCairoDateTime(r.paid_at)}</span>,
      recorded_when: <span className="text-sm text-[hsl(var(--muted))]">{formatCairoDateTime(r.created_at)}</span>,
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-[hsl(var(--muted))]">{r.member?.member_id ?? ''}</div>
        </div>
      ),
      amount: <span className="font-semibold">{formatEGP(r.amount)}</span>,
      method: <Badge className={badgeClassForMethod(r.payment_method)}>{labelMethod(r.payment_method)}</Badge>,
      note: <span className="text-sm text-[hsl(var(--muted))]">{r.note ?? '—'}</span>,
      by: <span className="text-sm">{by}</span>,
      edit_date: (
        <EditPaymentDateButton
          paymentId={r.id}
          memberLabel={memberLabel}
          currentPaidAt={r.paid_at || r.created_at}
        />
      ),
      open: (
        <Link className="underline" href={`/members/${r.member_id}`} prefetch={false}>
          Open
        </Link>
      ),
    }
  })

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin · Payments</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            Signed in as <span className="font-medium">{me.email || 'unknown'}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href="/admin/cash-report" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Cash Report
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Egypt time (Africa/Cairo)</div>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">From</span>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">To</span>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Method</span>
              <select
                name="payment_method"
                defaultValue={payment_method}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="instapay">Instapay</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Search member</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="name / email / phone / ATOM-000123"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <div className="flex items-end">
              <button className="w-full rounded-xl bg-black text-white px-4 py-2 text-sm font-medium">Apply</button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="text-sm text-[hsl(var(--muted))]">
            <strong>Payment date</strong> is the real accounting date. <strong>Recorded at</strong> is when the payment was entered in ATOM App.
            Use <strong>Edit date</strong> for historical imports already entered with today&apos;s date.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Total</div>
          <div className="mt-1 text-xl font-semibold">{formatEGP(totals.all)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Cash</div>
          <div className="mt-1 text-xl font-semibold">{formatEGP(totals.cash)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Instapay</div>
          <div className="mt-1 text-xl font-semibold">{formatEGP(totals.instapay)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Card</div>
          <div className="mt-1 text-xl font-semibold">{formatEGP(totals.card)}</div>
        </Card>
        <Card>
          <div className="text-sm text-[hsl(var(--muted))]">Bank transfer</div>
          <div className="mt-1 text-xl font-semibold">{formatEGP(totals.bank_transfer)}</div>
        </Card>
      </div>

      {err ? <p className="text-sm text-rose-700">❌ Failed to load payments: {err.message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">
            {count ?? 0} result{Number(count ?? 0) === 1 ? '' : 's'}
          </div>
        </CardHeader>
        <CardContent>
          <Table columns={tableColumns} rows={tableRows as any} keyField="id" />

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-[hsl(var(--muted))]">
              Page {page} / {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Link
                prefetch={false}
                href={navLink(Math.max(1, page - 1))}
                aria-disabled={page <= 1}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${page <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-black/[0.03]'}`}
              >
                Prev
              </Link>
              <Link
                prefetch={false}
                href={navLink(Math.min(totalPages, page + 1))}
                aria-disabled={page >= totalPages}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${page >= totalPages ? 'pointer-events-none opacity-50' : 'hover:bg-black/[0.03]'}`}
              >
                Next
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
