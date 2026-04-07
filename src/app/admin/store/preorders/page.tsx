export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreAdmin } from '@/lib/rbac'
import AdminPreorderQuickEdit from '@/components/store/AdminPreorderQuickEdit'

type PreorderStatus = 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'
type PreorderStatusFilter = 'all' | PreorderStatus

type PreorderRow = {
  id: string
  buyer_user_id: string
  buyer_full_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  product_id: string | null
  product_name: string
  product_category: 'kimono' | 'rashguard' | 'short' | 'belt' | null
  product_color: string | null
  product_size: string | null
  qty: number
  unit_price_cents: number
  total_cents: number
  deposit_cents: number
  balance_due_cents: number
  deposit_payment_method: 'cash' | 'instapay' | 'bank_transfer' | 'card' | null
  status: PreorderStatus
  note: string | null
  created_at: string
  updated_at: string
}

type Metrics = {
  total: number
  pending: number
  confirmed: number
  ready: number
  completed: number
  canceled: number
  demandValueCents: number
  depositsCents: number
  balanceCents: number
}

const PREORDER_STATUS_FILTERS: Array<{ value: PreorderStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'ordered_from_supplier', label: 'Ordered from supplier' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

function clampInt(v: unknown, def: number, min: number, max: number) {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function normalizeStatus(v: string): PreorderStatusFilter {
  return v === 'pending' || v === 'confirmed' || v === 'ordered_from_supplier' || v === 'ready' || v === 'completed' || v === 'canceled' ? v : 'all'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function paymentLabel(value: PreorderRow['deposit_payment_method']) {
  switch (value) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank transfer'
    case 'card':
      return 'Card'
    default:
      return '—'
  }
}

function preorderStatusPill(status: PreorderStatus) {
  switch (status) {
    case 'pending':
      return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">Pending</span>
    case 'confirmed':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Confirmed</span>
    case 'ordered_from_supplier':
      return <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">Ordered from supplier</span>
    case 'ready':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Ready</span>
    case 'completed':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Completed</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">Canceled</span>
  }
}

function computeMetrics(rows: PreorderRow[]): Metrics {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1
      if (row.status === 'pending') acc.pending += 1
      if (row.status === 'confirmed' || row.status === 'ordered_from_supplier') acc.confirmed += 1
      if (row.status === 'ready') acc.ready += 1
      if (row.status === 'completed') acc.completed += 1
      if (row.status === 'canceled') acc.canceled += 1
      acc.demandValueCents += Math.max(0, Number(row.total_cents ?? 0))
      acc.depositsCents += Math.max(0, Number(row.deposit_cents ?? 0))
      acc.balanceCents += Math.max(0, Number(row.balance_due_cents ?? 0))
      return acc
    },
    {
      total: 0,
      pending: 0,
      confirmed: 0,
      ready: 0,
      completed: 0,
      canceled: 0,
      demandValueCents: 0,
      depositsCents: 0,
      balanceCents: 0,
    } as Metrics
  )
}

export default async function AdminStorePreordersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/preorders')

  if (!canAccessStoreAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store/preorders"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 12, 6, 40)
  const q = strParam(searchParams?.q).trim()
  const status = normalizeStatus(strParam(searchParams?.status))

  const supa = getSupabaseAdminClientCached()
  let rows: PreorderRow[] = []
  let errorMsg: string | null = null

  try {
    let query = supa
      .from('store_preorders')
      .select('id, buyer_user_id, buyer_full_name, buyer_email, buyer_phone, product_id, product_name, product_category, product_color, product_size, qty, unit_price_cents, total_cents, deposit_cents, balance_due_cents, deposit_payment_method, status, note, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (status !== 'all') query = query.eq('status', status)
    if (q) {
      const safe = q.replace(/,/g, ' ').trim()
      query = query.or(`buyer_full_name.ilike.%${safe}%,buyer_email.ilike.%${safe}%,buyer_phone.ilike.%${safe}%,product_name.ilike.%${safe}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    rows = (Array.isArray(data) ? data : []) as PreorderRow[]
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const metrics = computeMetrics(rows)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const items = rows.slice(start, start + pageSize)
  const hasMore = safePage < totalPages

  const baseParams = {
    q,
    status: status === 'all' ? '' : status,
    page_size: String(pageSize),
  }

  return (
    <main>
      <PageHeader
        title="Store Admin — Preorders"
        subtitle="Track requests, record deposits, update status, and open the member file."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              prefetch={false}
              href="/admin/store"
              className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Back to /admin/store
            </Link>
            <Link
              prefetch={false}
              href="/store"
              className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open /store
            </Link>
          </div>
        }
      />

      <Section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <Card>
            <CardHeader><CardTitle>Preorders</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Total</span><span className="font-semibold">{metrics.total}</span></div>
              <div className="flex items-center justify-between"><span>Pending</span><span className="font-semibold">{metrics.pending}</span></div>
              <div className="flex items-center justify-between"><span>In progress</span><span className="font-semibold">{metrics.confirmed}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Fulfillment</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Ready</span><span className="font-semibold">{metrics.ready}</span></div>
              <div className="flex items-center justify-between"><span>Completed</span><span className="font-semibold">{metrics.completed}</span></div>
              <div className="flex items-center justify-between"><span>Canceled</span><span className="font-semibold">{metrics.canceled}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Money</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Demand value</span><span className="font-semibold">{formatCurrency(metrics.demandValueCents)}</span></div>
              <div className="flex items-center justify-between"><span>Deposits collected</span><span className="font-semibold">{formatCurrency(metrics.depositsCents)}</span></div>
              <div className="flex items-center justify-between"><span>Open balance</span><span className="font-semibold">{formatCurrency(metrics.balanceCents)}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Admin flow</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="text-[hsl(var(--muted))]">Use this page to record the deposit, update the preorder status, and jump directly to the member profile.</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Search</span>
                <input name="q" defaultValue={q} placeholder="Buyer, email, phone, product…" className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Status</span>
                <select name="status" defaultValue={status} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {PREORDER_STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button>
                <Link href="/admin/store/preorders" className="inline-flex min-h-[42px] items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">Reset</Link>
              </div>
            </form>
          </CardContent>
        </Card>

        {errorMsg ? (
          <Card>
            <CardContent className="text-sm text-red-700">Preorders query failed: {errorMsg}</CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Admin preorders</CardTitle>
              <div className="text-xs text-[hsl(var(--muted))]">{rows.length} preorder(s)</div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No preorders match the current filters.</div>
              ) : (
                items.map((row) => (
                  <div key={row.id} className="rounded-2xl border bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{row.product_name}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                          <span className="rounded-full border px-2 py-1">Preorder ID: {shortId(row.id)}</span>
                          {row.product_category ? <span className="rounded-full border px-2 py-1">{row.product_category}</span> : null}
                          {row.product_size ? <span className="rounded-full border px-2 py-1">Size: {row.product_size}</span> : null}
                          {row.product_color ? <span className="rounded-full border px-2 py-1">Color: {row.product_color}</span> : null}
                          <span className="rounded-full border px-2 py-1">Qty: {row.qty}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">{preorderStatusPill(row.status)}</div>
                    </div>

                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div><span className="text-[hsl(var(--muted))]">Buyer:</span> <span className="font-medium">{row.buyer_full_name || row.buyer_email || 'Member'}</span></div>
                      <div><span className="text-[hsl(var(--muted))]">Email:</span> <span className="font-medium">{row.buyer_email || '—'}</span></div>
                      <div><span className="text-[hsl(var(--muted))]">Phone:</span> <span className="font-medium">{row.buyer_phone || '—'}</span></div>
                      <div><span className="text-[hsl(var(--muted))]">Created:</span> <span className="font-medium">{formatDateTime(row.created_at)}</span></div>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div><span className="text-[hsl(var(--muted))]">Unit price:</span> <span className="font-medium">{formatCurrency(row.unit_price_cents)}</span></div>
                      <div><span className="text-[hsl(var(--muted))]">Total:</span> <span className="font-medium">{formatCurrency(row.total_cents)}</span></div>
                      <div><span className="text-[hsl(var(--muted))]">Deposit:</span> <span className="font-medium">{formatCurrency(row.deposit_cents)}</span></div>
                      <div><span className="text-[hsl(var(--muted))]">Balance due:</span> <span className="font-medium">{formatCurrency(row.balance_due_cents)}</span></div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                      <span className="rounded-full border px-2 py-1">Deposit payment: {paymentLabel(row.deposit_payment_method)}</span>
                      <span className="rounded-full border px-2 py-1">Updated: {formatDateTime(row.updated_at)}</span>
                    </div>

                    {row.note ? (
                      <div className="mt-3 rounded-2xl border border-dashed p-3 text-sm text-[hsl(var(--muted))]">
                        <span className="font-medium text-black">Customer note:</span> {row.note}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        prefetch={false}
                        href={`/members/${row.buyer_user_id}`}
                        className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                      >
                        Open member
                      </Link>
                    </div>

                    <div className="mt-4">
                      <AdminPreorderQuickEdit
                        id={row.id}
                        totalCents={row.total_cents}
                        depositCents={row.deposit_cents}
                        depositPaymentMethod={row.deposit_payment_method}
                        status={row.status}
                      />
                    </div>
                  </div>
                ))
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
                <div>Page {safePage} / {totalPages}</div>
                <div className="flex gap-2">
                  <Link href={buildUrl('/admin/store/preorders', { ...baseParams, page: String(Math.max(1, safePage - 1)) })} className={`rounded-xl border px-4 py-2 ${safePage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Previous</Link>
                  <Link href={buildUrl('/admin/store/preorders', { ...baseParams, page: String(safePage + 1) })} className={`rounded-xl border px-4 py-2 ${!hasMore ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Next</Link>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </Section>
    </main>
  )
}
