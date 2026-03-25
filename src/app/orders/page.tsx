// src/app/orders/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import type { OrderStatus } from '@/lib/order'
import { humanStatus } from '@/lib/order'
import AccessDeniedPage from '@/components/AccessDeniedPage'

const ALLOWED: Array<'member' | 'assistant_coach' | 'coach'> = ['member', 'assistant_coach', 'coach']
const ALLOWED_STATUSES = ['all', 'pending', 'confirmed', 'ready', 'delivered', 'canceled'] as const

type Item = {
  id: string
  name: string | null
  qty: number
  unit_price_cents: number
  currency: string | null
}

type OrderRow = {
  id: string
  status: OrderStatus
  total_cents: number
  discount_pct?: number | null
  discount_percent?: number | null
  preferred_payment?: string | null
  payment_method?: string | null
  note?: string | null
  notes?: string | null
  created_at: string
  store_order_items?: Item[] | null
}

const listMyOrdersCached = unstable_cache(
  async (
    user_id: string,
    status: string,
    from: string,
    to: string,
    fromRow: number,
    toRow: number
  ) => {
    const supa = getSupabaseAdminClientCached()

    let qry = supa
      .from('store_orders')
      .select(
        `
        id,
        status,
        total_cents,
        discount_pct,
        discount_percent,
        preferred_payment,
        payment_method,
        note,
        notes,
        created_at,
        store_order_items (
          id,
          name,
          qty,
          unit_price_cents,
          currency
        )
      `,
        
      )
      // Mine: match both columns to be safe (some setups use member_id; others use user_id)
      .or(`user_id.eq.${user_id},member_id.eq.${user_id}`)
      .order('created_at', { ascending: false })
      .range(fromRow, toRow + 1)

    if (status && status !== 'all') qry = qry.eq('status', status)
    if (from) qry = qry.gte('created_at', `${from}T00:00:00.000Z`)
    if (to) qry = qry.lte('created_at', `${to}T23:59:59.999Z`)

    const { data, error } = await qry
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as any[]
    const hasMore = rows.length > (toRow - fromRow + 1)
    const sliced = hasMore ? rows.slice(0, (toRow - fromRow + 1)) : rows
    return { orders: sliced as any, hasMore }
  },
  ['my_orders_v2'],
  { revalidate: 60, tags: ['orders'] }
)


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

function normalizeStatus(v: string) {
  const s = (v || '').trim()
  return (ALLOWED_STATUSES as readonly string[]).includes(s) ? s : 'all'
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/orders')

  if (!ALLOWED.includes(me.role as any)) {
    return (
      <AccessDeniedPage
        title="Orders"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for members only."
        allowed="member, assistant_coach, coach"
        nextPath="/orders"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 20, 10, 100)
  const status = normalizeStatus(strParam(searchParams?.status))
  const from = strParam(searchParams?.from).trim() // YYYY-MM-DD
  const to = strParam(searchParams?.to).trim() // YYYY-MM-DD
  const fromRow = (page - 1) * pageSize
  const toRow = fromRow + pageSize - 1

let orders: OrderRow[] = []
let errorMsg: string | null = null
let hasMore = false

try {
  const res = await listMyOrdersCached(me.id, status, from, to, fromRow, toRow)
  orders = res.orders as any
  hasMore = Boolean((res as any).hasMore)
} catch (e: any) {
  errorMsg = e?.message || String(e)
}

const baseParams = { status, from, to, page_size: String(pageSize) }

  return (
    <main>
      <PageHeader title="My orders" subtitle="Your order history" />

      <Section className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-gray-600">
              {orders.length > 0 ? (
                <>
                  Showing <b>{fromRow + 1}</b>–<b>{fromRow + orders.length}</b> of <b>{fromRow + orders.length}</b>
                </>
              ) : (
                <>No orders yet.</>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Link
                prefetch={false}
                href={buildUrl('/orders', { ...baseParams, page: String(page) })}
                className="inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Refresh
              </Link>
              <Link
                prefetch={false}
                href="/store"
                className="inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Store
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <form action="/orders" method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Status</label>
                <select name="status" defaultValue={status} className="rounded-xl border px-3 py-2 text-sm bg-white">
                  {ALLOWED_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s === 'all' ? 'All' : humanStatus(s as any)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">From</label>
                <input name="from" type="date" defaultValue={from} className="rounded-xl border px-3 py-2 text-sm bg-white" />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">To</label>
                <input name="to" type="date" defaultValue={to} className="rounded-xl border px-3 py-2 text-sm bg-white" />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Page size</label>
                <select name="page_size" defaultValue={String(pageSize)} className="rounded-xl border px-3 py-2 text-sm bg-white">
                  {[10, 20, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <button className="rounded-xl px-4 py-2 text-sm font-medium border hover:bg-gray-50" type="submit">
                Apply
              </button>

              <Link prefetch={false} href="/orders" className="text-sm underline text-gray-700 hover:text-black">
                Clear
              </Link>
            </form>
          </CardContent>
        </Card>

        {errorMsg ? (
          <Card>
            <CardContent>
              <div className="text-sm text-red-600">Failed to load orders: {errorMsg}</div>
            </CardContent>
          </Card>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">No orders for these filters.</div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const items = Array.isArray(o.store_order_items) ? o.store_order_items : []
              const discount = Number(o.discount_pct ?? o.discount_percent ?? 0)
              const payment = o.preferred_payment || o.payment_method || 'cash'
              const noteTxt = o.note || o.notes || ''
              const totalTxt = formatCurrency(o.total_cents ?? 0, 'en-EG', 'EGP')

              return (
                <Card key={o.id} hover={true}>
                  <CardContent className="py-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="font-semibold">#{shortId(o.id)}</div>
                      <div className="text-sm text-gray-600">
                        Status: <b>{humanStatus(o.status)}</b>
                      </div>
                      <div className="text-sm text-gray-600">
                        Total: <b>{totalTxt}</b>
                        {discount ? ` (−${discount}%)` : ''}
                      </div>
                      <div className="text-sm text-gray-600">Payment: {payment}</div>
                      <div className="ml-auto text-xs text-[hsl(var(--muted))]">{fmtDateTime(o.created_at)}</div>
                    </div>

                    {noteTxt ? <div className="text-sm">Note: {noteTxt}</div> : null}

                    {items.length ? (
                      <div className="text-sm">
                        <div className="font-medium mb-1">Items</div>
                        <ul className="list-disc ml-5 space-y-1">
                          {items.map((it) => (
                            <li key={it.id}>
                              {it.name || 'Item'} × {it.qty} — {formatCurrency(it.unit_price_cents, 'en-EG', it.currency || 'EGP')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">No items</div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {!errorMsg && (page > 1 || hasMore) && (
          <div className="flex items-center gap-2">
            <Link
              prefetch={false}
              href={buildUrl('/orders', { ...baseParams, page: String(Math.max(1, page - 1)) })}
              aria-disabled={page <= 1}
              className={`px-2 py-1 rounded border ${page <= 1 ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
            >
              Prev
            </Link>
            <div className="text-sm">
              Page <b>{page}</b>
            </div>
            <Link
              prefetch={false}
              href={buildUrl('/orders', { ...baseParams, page: String(page + 1) })}
              aria-disabled={!hasMore}
              className={`px-2 py-1 rounded border ${!hasMore ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
            >
              Next
            </Link>
          </div>
        )}
      </Section>
    </main>
  )
}
