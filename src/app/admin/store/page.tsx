// src/app/admin/store/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import StoreCatalog from '@/components/StoreCatalog'
import { formatCurrency } from '@/lib/money'
import type { OrderStatus } from '@/lib/order'
import { humanStatus } from '@/lib/order'

const StoreProductForm = dynamicImport(() => import('@/components/StoreProductForm'), {
  loading: () => <div className="text-sm text-gray-500">Loading catalog management…</div>,
})

const AdminOrderStatusEditor = dynamicImport(() => import('@/components/store/AdminOrderStatusEditor'), {
  ssr: false,
  loading: () => <div className="text-xs text-gray-500">Loading status editor…</div>,
})

type ProfileMini = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  member_id: string | null
}

type OrderItem = {
  id: string
  product_id: string
  name: string | null
  qty: number
  unit_price_cents: number
  final_price_cents: number
  currency: string | null
}

type OrderRow = {
  id: string
  status: OrderStatus
  total_cents: number
  discount_percent?: number | null
  discount_pct?: number | null
  payment_method?: string | null
  preferred_payment?: string | null
  notes?: string | null
  note?: string | null
  created_at: string
  updated_at?: string | null
  member_id: string
  user_id: string
  created_by: string
  owner_uid?: string | null
  store_order_items?: OrderItem[] | null
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const ALLOWED_STATUSES = ['all', 'pending', 'confirmed', 'ready', 'delivered', 'canceled'] as const

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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
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

function displayName(p?: ProfileMini | null) {
  if (!p) return '—'
  const n = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
  return n || p.email || '—'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

function normalizeStatus(v: string) {
  const s = (v || '').trim()
  return (ALLOWED_STATUSES as readonly string[]).includes(s) ? s : 'all'
}

export default async function AdminStorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/store')

  if (me.role !== 'super_admin') {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, DEFAULT_PAGE_SIZE, 10, MAX_PAGE_SIZE)
  const status = normalizeStatus(strParam(searchParams?.status))
  const q = strParam(searchParams?.q).trim() // buyer name/email/member code or UUID
  const from = strParam(searchParams?.from).trim() // YYYY-MM-DD
  const to = strParam(searchParams?.to).trim() // YYYY-MM-DD

  const supa = createSupabaseAdminClient()

  // If q is not UUID, resolve it to matching profile IDs first (server-side).
  let qOwnerIds: string[] | null = null
  if (q && !isUuid(q)) {
    const safe = q.replace(/,/g, ' ').trim()
    if (safe.length >= 2) {
      const { data: people, error: perr } = await supa
        .from('profiles')
        .select('user_id')
        .or(
          [
            `first_name.ilike.%${safe}%`,
            `last_name.ilike.%${safe}%`,
            `email.ilike.%${safe}%`,
            `member_id.ilike.%${safe}%`,
          ].join(',')
        )
        .limit(200)

      if (!perr) {
        qOwnerIds = (people ?? []).map((p: any) => p.user_id).filter((x: any) => typeof x === 'string' && isUuid(x))
      } else {
        qOwnerIds = null
      }
    } else {
      qOwnerIds = []
    }
  }

  const fromRow = (page - 1) * pageSize
  const toRow = fromRow + pageSize - 1

  let qry = supa
    .from('store_orders')
    .select(
      `
        id,
        status,
        total_cents,
        discount_percent,
        discount_pct,
        payment_method,
        preferred_payment,
        notes,
        note,
        created_at,
        updated_at,
        member_id,
        user_id,
        created_by,
        owner_uid,
        store_order_items (
          id,
          product_id,
          name,
          qty,
          unit_price_cents,
          final_price_cents,
          currency
        )
      `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(fromRow, toRow)

  if (status !== 'all') qry = qry.eq('status', status)

  if (from) qry = qry.gte('created_at', `${from}T00:00:00.000Z`)
  if (to) qry = qry.lte('created_at', `${to}T23:59:59.999Z`)

  if (q) {
    if (isUuid(q)) {
      qry = qry.or([`id.eq.${q}`, `owner_uid.eq.${q}`, `created_by.eq.${q}`, `user_id.eq.${q}`, `member_id.eq.${q}`].join(','))
    } else if (Array.isArray(qOwnerIds)) {
      if (qOwnerIds.length === 0) {
        qry = qry.eq('id', '00000000-0000-0000-0000-000000000000')
      } else {
        qry = qry.in('owner_uid', qOwnerIds)
      }
    }
  }

  const { data, error, count } = await qry
  const orders: OrderRow[] = Array.isArray(data) ? (data as any) : []
  const total = Number(count ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Fetch buyer profiles (owner_uid preferred)
  const buyerIds = Array.from(
    new Set(
      orders
        .map((o) => o.owner_uid || o.created_by || o.user_id || o.member_id)
        .filter((x): x is string => typeof x === 'string' && isUuid(x))
    )
  )

  const profiles = new Map<string, ProfileMini>()
  if (buyerIds.length) {
    const { data: people } = (await supa
      .from('profiles')
      .select('user_id, first_name, last_name, email, member_id')
      .in('user_id', buyerIds)) as { data: ProfileMini[] | null }
    for (const p of people ?? []) profiles.set(p.user_id, p)
  }

  const baseParams = { q, status, from, to, page_size: String(pageSize) }

  return (
    <main>
      <PageHeader title="Store Admin" subtitle="Manage catalog and view all orders" />

      <Section className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-base font-semibold">Client Store</h2>
              <p className="text-sm text-gray-600">Open the client-facing shop view.</p>
            </div>
            <Link
              prefetch={false}
              href="/store"
              className="ml-auto inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open /store
            </Link>
          </CardContent>
        </Card>

        {/* Catalog management */}
        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">Catalog management</h2>
            <StoreProductForm />
          </CardContent>
        </Card>

        {/* Catalog */}
        <Card>
          <CardContent>
            <h2 className="text-base font-semibold mb-3">Catalog</h2>
            <StoreCatalog showAdd={false} canManage={true} />
          </CardContent>
        </Card>

        {/* All orders - server-first */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">All orders</h2>
            <div className="text-xs text-[hsl(var(--muted))]">Server-first list + tiny client editor for status.</div>
            <div className="ml-auto text-xs text-[hsl(var(--muted))]">
              {total > 0 ? (
                <>
                  Showing <b>{fromRow + 1}</b>–<b>{Math.min(fromRow + orders.length, total)}</b> of <b>{total}</b>
                </>
              ) : (
                <>No orders.</>
              )}
            </div>
          </div>

          <Card>
            <CardContent>
              <form action="/admin/store" method="get" className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[hsl(var(--muted))]">Search</label>
                  <input
                    name="q"
                    defaultValue={q}
                    className="rounded-xl border px-3 py-2 text-sm bg-white"
                    placeholder="Buyer name/email/member code or UUID"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[hsl(var(--muted))]">Status</label>
                  <select name="status" defaultValue={status} className="rounded-xl border px-3 py-2 text-sm bg-white">
                    {ALLOWED_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s === 'all' ? 'all' : humanStatus(s as any)}
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

                <Link prefetch={false} href="/admin/store" className="text-sm underline text-gray-700 hover:text-black">
                  Clear
                </Link>
              </form>
            </CardContent>
          </Card>

          {error ? (
            <div className="text-sm text-red-600">Failed to load orders: {error.message}</div>
          ) : orders.length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">No orders found.</div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const buyerId = (o.owner_uid || o.created_by || o.user_id || o.member_id) as string
                const buyer = buyerId && profiles.get(buyerId) ? profiles.get(buyerId)! : null
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

                      <div className="text-sm">
                        <span className="font-medium">Buyer:</span> {displayName(buyer)}
                        {buyer?.member_id ? <span className="text-xs text-[hsl(var(--muted))]"> · {buyer.member_id}</span> : null}
                      </div>

                      {/* Status editor (tiny client component) */}
                      <AdminOrderStatusEditor orderId={o.id} currentStatus={o.status} currentNote={noteTxt} />

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
                        <div className="text-sm text-gray-500">No items.</div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {!error && total > 0 && totalPages > 1 && (
            <div className="flex items-center gap-2 pt-2">
              <Link
                prefetch={false}
                href={buildUrl('/admin/store', { ...baseParams, page: String(Math.max(1, page - 1)) })}
                aria-disabled={page <= 1}
                className={`px-2 py-1 rounded border ${page <= 1 ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
              >
                Prev
              </Link>
              <div className="text-sm">
                Page <b>{page}</b> / {totalPages}
              </div>
              <Link
                prefetch={false}
                href={buildUrl('/admin/store', { ...baseParams, page: String(Math.min(totalPages, page + 1)) })}
                aria-disabled={page >= totalPages}
                className={`px-2 py-1 rounded border ${page >= totalPages ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
              >
                Next
              </Link>
            </div>
          )}
        </section>
      </Section>
    </main>
  )
}
