export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreAdmin } from '@/lib/rbac'
import AdminSaleForm from '@/components/store/AdminSaleForm'
import AdminSaleQuickEdit from '@/components/store/AdminSaleQuickEdit'
import StoreAdminNav from '@/components/store/StoreAdminNav'

type SearchParams = Record<string, string | string[] | undefined>

type SaleStatus = 'draft' | 'partial_paid' | 'paid' | 'delivered' | 'canceled'
type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'

type SaleRow = {
  id: string
  buyer_user_id: string | null
  buyer_member_id: string | null
  buyer_full_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  status: SaleStatus
  payment_method: PaymentMethod | null
  currency: string | null
  total_cents: number
  paid_cents: number
  debt_cents: number
  note: string | null
  delivered_at: string | null
  created_at: string
}

type SaleItemRow = {
  sale_id: string
  product_id: string
  product_name: string | null
  qty: number
  unit_price_cents: number
  line_total_cents: number
  currency: string | null
  delivered_stock_applied: boolean | null
}

type ProductOption = {
  id: string
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
}

const STATUSES: Array<{ value: 'all' | SaleStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'partial_paid', label: 'Partial paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'canceled', label: 'Canceled' },
]

const PAYMENTS: Array<{ value: 'all' | PaymentMethod; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
]

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
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

function humanStatus(s: SaleStatus) {
  switch (s) {
    case 'draft':
      return 'Draft'
    case 'partial_paid':
      return 'Partial paid'
    case 'paid':
      return 'Paid'
    case 'delivered':
      return 'Delivered'
    case 'canceled':
      return 'Canceled'
    default:
      return s
  }
}

function statusChipClass(status: SaleStatus) {
  switch (status) {
    case 'delivered':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    case 'paid':
      return 'border-sky-300 bg-sky-50 text-sky-900'
    case 'partial_paid':
      return 'border-amber-300 bg-amber-50 text-amber-900'
    case 'canceled':
      return 'border-rose-300 bg-rose-50 text-rose-900'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--fg))]'
  }
}

export default async function AdminStoreSalesPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/sales')

  if (!canAccessStoreAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Sales"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for super admins only."
        allowed="super_admin"
        nextPath="/admin/store/sales"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const supa = getSupabaseAdminClientCached()
  const q = strParam(searchParams?.q).trim()
  const statusRaw = strParam(searchParams?.status)
  const paymentRaw = strParam(searchParams?.payment)
  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, 12, 6, 50)

  const status = (STATUSES.map((s) => s.value) as string[]).includes(statusRaw) ? statusRaw : 'all'
  const payment = (PAYMENTS.map((p) => p.value) as string[]).includes(paymentRaw) ? paymentRaw : 'all'

  let productOptions: ProductOption[] = []
  let sales: SaleRow[] = []
  let itemsBySale = new Map<string, SaleItemRow[]>()
  let salesError: string | null = null
  let totalCount = 0
  let metrics = {
    totalSales: 0,
    deliveredCount: 0,
    collectedCents: 0,
    debtCents: 0,
  }

  try {
    const [{ data: productsData, error: productsErr }, { data: metricsData, error: metricsErr }] = await Promise.all([
      supa
        .from('store_products')
        .select('id,name,color,size,price_cents,currency,inventory_qty,is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(200),
      supa
        .from('store_sales')
        .select('status,total_cents,paid_cents,debt_cents')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (productsErr) throw new Error(productsErr.message)
    if (metricsErr) throw new Error(metricsErr.message)

    productOptions = Array.isArray(productsData) ? (productsData as ProductOption[]) : []

    const metricRows = Array.isArray(metricsData) ? metricsData : []
    metrics = metricRows.reduce(
      (acc, row: any) => {
        acc.totalSales += 1
        if (row?.status === 'delivered') acc.deliveredCount += 1
        acc.collectedCents += Number(row?.paid_cents || 0)
        acc.debtCents += Number(row?.debt_cents || 0)
        return acc
      },
      { totalSales: 0, deliveredCount: 0, collectedCents: 0, debtCents: 0 }
    )

    let countQ = supa.from('store_sales').select('id', { count: 'exact', head: true })
    let salesQ = supa
      .from('store_sales')
      .select('id,buyer_user_id,buyer_member_id,buyer_full_name,buyer_email,buyer_phone,status,payment_method,currency,total_cents,paid_cents,debt_cents,note,delivered_at,created_at')
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (status !== 'all') {
      countQ = countQ.eq('status', status)
      salesQ = salesQ.eq('status', status)
    }
    if (payment !== 'all') {
      countQ = countQ.eq('payment_method', payment)
      salesQ = salesQ.eq('payment_method', payment)
    }
    if (q) {
      const like = `%${q.replace(/,/g, ' ')}%`
      const orExpr = `buyer_full_name.ilike.${like},buyer_email.ilike.${like},buyer_phone.ilike.${like}`
      countQ = countQ.or(orExpr)
      salesQ = salesQ.or(orExpr)
    }

    const [{ count, error: countErr }, { data: salesData, error: salesErr }] = await Promise.all([countQ, salesQ])
    if (countErr) throw new Error(countErr.message)
    if (salesErr) throw new Error(salesErr.message)

    totalCount = Number(count || 0)
    sales = Array.isArray(salesData) ? (salesData as SaleRow[]) : []

    if (sales.length > 0) {
      const saleIds = sales.map((s) => s.id)
      const { data: itemsData, error: itemsErr } = await supa
        .from('store_sale_items')
        .select('sale_id,product_id,product_name,qty,unit_price_cents,line_total_cents,currency,delivered_stock_applied')
        .in('sale_id', saleIds)
        .order('created_at', { ascending: true })
      if (itemsErr) throw new Error(itemsErr.message)

      for (const item of Array.isArray(itemsData) ? (itemsData as SaleItemRow[]) : []) {
        const bucket = itemsBySale.get(item.sale_id) ?? []
        bucket.push(item)
        itemsBySale.set(item.sale_id, bucket)
      }
    }
  } catch (e: any) {
    salesError = e?.message || String(e)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const baseParams = {
    q,
    status,
    payment,
    page_size: String(pageSize),
  }

  return (
    <main>
      <PageHeader
        title="Store Sales"
        subtitle="Admin sales, debt, and delivery flow."
        right={
          <>
            <Button asChild variant="outline" size="sm" href="/admin/store/preorders">
              Open preorders
            </Button>
            <Button asChild variant="outline" size="sm" href="/admin/store">
              Back to store admin
            </Button>
          </>
        }
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/sales" role={me.role} />
      </Section>

      <Section className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Sales</div><div className="text-2xl font-semibold">{metrics.totalSales}</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Delivered</div><div className="text-2xl font-semibold">{metrics.deliveredCount}</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Collected</div><div className="text-2xl font-semibold">{formatCurrency(metrics.collectedCents, 'en-EG', 'EGP')}</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Outstanding debt</div><div className="text-2xl font-semibold">{formatCurrency(metrics.debtCents, 'en-EG', 'EGP')}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="space-y-4">
            <div>
              <div className="text-lg font-semibold">Create sale</div>
              <div className="text-sm text-[hsl(var(--muted))]">One product per sale for now. Keep it simple and stable.</div>
            </div>
            <AdminSaleForm products={productOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <form className="grid grid-cols-1 gap-3 md:grid-cols-4" action="/admin/store/sales" method="get">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-sm font-medium">Search buyer</span>
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Name, email, phone…"
                  className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Status</span>
                <select name="status" defaultValue={status} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment</span>
                <select name="payment" defaultValue={payment} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  {PAYMENTS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="page_size" value={String(pageSize)} />
              <div className="flex flex-wrap items-center gap-2 md:col-span-4">
                <Button type="submit">Apply filters</Button>
                <Button asChild variant="outline" href="/admin/store/sales">
                  Reset
                </Button>
                <div className="ml-auto text-sm text-[hsl(var(--muted))]">{totalCount} result{totalCount === 1 ? '' : 's'}</div>
              </div>
            </form>
          </CardContent>
        </Card>

        {salesError ? <InlineAlert variant="error">{salesError}</InlineAlert> : null}

        <div className="space-y-4">
          {sales.length === 0 && !salesError ? (
            <Card>
              <CardContent>
                <InlineAlert compact variant="info">No sales found for the current filters.</InlineAlert>
              </CardContent>
            </Card>
          ) : null}

          {sales.map((sale) => {
            const items = itemsBySale.get(sale.id) ?? []
            return (
              <Card key={sale.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold">{sale.buyer_full_name || 'Buyer'}</div>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${statusChipClass(sale.status)}`}>
                          {humanStatus(sale.status)}
                        </span>
                      </div>
                      <div className="text-sm text-[hsl(var(--muted))]">
                        {sale.buyer_email || 'No email'}{sale.buyer_phone ? ` · ${sale.buyer_phone}` : ''}
                      </div>
                      <div className="text-xs text-[hsl(var(--muted))]">Created {fmtDateTime(sale.created_at)}{sale.delivered_at ? ` · Delivered ${fmtDateTime(sale.delivered_at)}` : ''}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {sale.buyer_user_id ? (
                        <Button asChild variant="outline" size="sm" href={`/members/${sale.buyer_user_id}`}>
                          Open member
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
                      <div className="text-xs font-medium text-[hsl(var(--muted))]">Items</div>
                      <div className="mt-2 space-y-2">
                        {items.length === 0 ? <div className="text-sm text-[hsl(var(--muted))]">No items.</div> : null}
                        {items.map((item, index) => (
                          <div key={`${sale.id}-${item.product_id}-${index}`} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
                            <div className="font-medium">{item.product_name || 'Product'}</div>
                            <div className="mt-1 text-[hsl(var(--muted))]">
                              Qty {item.qty} · {formatCurrency(item.line_total_cents, 'en-EG', item.currency || sale.currency || 'EGP')}
                            </div>
                            {item.delivered_stock_applied ? (
                              <div className="mt-1 text-[11px] text-emerald-700">Stock already applied</div>
                            ) : (
                              <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Stock will be applied on delivery</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
                      <div className="text-xs font-medium text-[hsl(var(--muted))]">Money</div>
                      <div className="mt-2 space-y-2 text-sm">
                        <div>Total: <span className="font-medium">{formatCurrency(sale.total_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                        <div>Paid: <span className="font-medium">{formatCurrency(sale.paid_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                        <div>Debt: <span className="font-medium">{formatCurrency(sale.debt_cents, 'en-EG', sale.currency || 'EGP')}</span></div>
                        <div>Payment: <span className="font-medium">{sale.payment_method || '—'}</span></div>
                        {sale.note ? <div className="text-[hsl(var(--muted))]">Note: {sale.note}</div> : null}
                      </div>
                    </div>

                    <AdminSaleQuickEdit
                      id={sale.id}
                      totalCents={sale.total_cents}
                      paidCents={sale.paid_cents}
                      debtCents={sale.debt_cents}
                      paymentMethod={sale.payment_method}
                      status={sale.status}
                      note={sale.note}
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[hsl(var(--muted))]">Page {page} of {totalPages}</div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                href={buildUrl('/admin/store/sales', { ...baseParams, page: String(Math.max(1, page - 1)) })}
              >
                Previous
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                href={buildUrl('/admin/store/sales', { ...baseParams, page: String(Math.min(totalPages, page + 1)) })}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
