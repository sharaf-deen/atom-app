// src/app/orders/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { formatCurrency } from '@/lib/money'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'

const ALLOWED: Array<'member' | 'assistant_coach' | 'coach'> = ['member', 'assistant_coach', 'coach']
const PAGE_SIZE = 20

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
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
  status: string
  total_cents: number
  discount_pct: number
  preferred_payment: string | null
  note: string | null
  created_at: string
  store_order_items?: OrderItem[] | null
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUser()
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
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supa = createSupabaseAdminClient()

  const selectCols = `
    id,
    status,
    total_cents,
    discount_pct,
    preferred_payment,
    note,
    created_at,
    store_order_items (
      id,
      product_id,
      name,
      qty,
      unit_price_cents,
      final_price_cents,
      currency
    )
  `

  // Include legacy fields too (some rows might use member_id/created_by patterns)
  const ownerFilter = `user_id.eq.${me.id},member_id.eq.${me.id},created_by.eq.${me.id}`

  const { data, error, count } = await supa
    .from('store_orders')
    .select(selectCols, { count: 'exact' })
    .or(ownerFilter)
    .order('created_at', { ascending: false })
    .range(from, to)

  const rows: OrderRow[] = Array.isArray(data) ? (data as any) : []
  const total = Number(count ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">My orders</h1>
        <div className="text-xs text-gray-500">You see only your own orders.</div>
        <Link prefetch={false} href="/store" className="ml-auto text-sm underline text-gray-700 hover:text-black">
          Back to Store
        </Link>
      </div>

      {error && (
        <Card>
          <CardContent>
            <div className="text-sm text-red-600">Failed to load orders: {error.message}</div>
          </CardContent>
        </Card>
      )}

      {!error && rows.length === 0 && (
        <Card>
          <CardContent>
            <div className="text-sm text-gray-500">No orders yet.</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {rows.map((o) => {
          const totalTxt = formatCurrency(o.total_cents, 'en-EG', 'EGP')
          const createdTxt = o.created_at ? new Date(o.created_at).toLocaleString() : ''
          const items = Array.isArray(o.store_order_items) ? o.store_order_items : []
          return (
            <Card key={o.id} hover>
              <CardHeader className="items-start gap-2">
                <CardTitle className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">#{shortId(o.id)}</span>
                  <span className="text-sm text-gray-600">Status: <b>{o.status}</b></span>
                  <span className="text-sm text-gray-600">Total: <b>{totalTxt}</b>{o.discount_pct ? ` (−${o.discount_pct}%)` : ''}</span>
                  <span className="text-sm text-gray-600">Payment: {o.preferred_payment || 'cash'}</span>
                </CardTitle>
                <div className="text-xs text-gray-500">{createdTxt}</div>
              </CardHeader>

              <CardContent className="space-y-2">
                {o.note && <div className="text-sm"><span className="font-medium">Note:</span> {o.note}</div>}

                <div className="text-sm">
                  <div className="font-medium mb-1">Items</div>
                  {items.length === 0 ? (
                    <div className="text-gray-500 text-sm">No items.</div>
                  ) : (
                    <ul className="list-disc ml-5 space-y-1">
                      {items.map((it) => (
                        <li key={it.id}>
                          {it.name || 'Item'} × {it.qty} — {formatCurrency(it.unit_price_cents, 'en-EG', it.currency || 'EGP')}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Pagination */}
      {!error && total > 0 && (
        <div className="flex items-center gap-2 pt-2">
          <Link
            prefetch={false}
            href={`/orders?page=${Math.max(1, page - 1)}`}
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
            href={`/orders?page=${Math.min(totalPages, page + 1)}`}
            aria-disabled={page >= totalPages}
            className={`px-2 py-1 rounded border ${page >= totalPages ? 'opacity-50 pointer-events-none' : 'hover:bg-gray-50'}`}
          >
            Next
          </Link>
          <div className="ml-auto text-xs text-gray-500">Total: {total}</div>
        </div>
      )}
    </main>
  )
}
