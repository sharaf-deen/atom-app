export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import StoreAdminNav from '@/components/store/StoreAdminNav'
import StoreSaleReconciliationForm from '@/components/store/StoreSaleReconciliationForm'
import StoreSaleReconciliationEdit from '@/components/store/StoreSaleReconciliationEdit'
import { formatCurrency } from '@/lib/money'
import { canAccessStoreReconciliation, canManageStoreReconciliation } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = Record<string, string | string[] | undefined>
type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
type FilterStatus = 'all' | 'pending' | 'matched' | 'difference' | 'needs_review'

type SaleRow = {
  id: string
  buyer_full_name: string | null
  buyer_member_id: string | null
  status: string | null
  payment_method: PaymentMethod | null
  currency: string | null
  total_cents: number | null
  paid_cents: number | null
  debt_cents: number | null
  purchase_date: string | null
  created_at: string | null
}

type ReconciliationRow = {
  id: string
  sale_id: string
  recorded_paid_cents_snapshot: number
  actual_received_cents: number
  variance_cents: number
  payment_method_snapshot: PaymentMethod | null
  received_date: string
  reference: string | null
  note: string | null
  validated_by: string
  validated_at: string
}

const RECONCILIATION_START_DATE = '2026-09-01'

function str(v: unknown) {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' ? raw : ''
}

function effectiveSaleDate(sale: SaleRow) {
  return sale.purchase_date || String(sale.created_at || '').slice(0, 10)
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function reconciliationStatus(sale: SaleRow, latest: ReconciliationRow | null): FilterStatus {
  if (!latest) return 'pending'
  const currentPaid = Math.max(0, Number(sale.paid_cents || 0))
  if (Number(latest.recorded_paid_cents_snapshot || 0) !== currentPaid) return 'needs_review'
  return Number(latest.variance_cents || 0) === 0 ? 'matched' : 'difference'
}

function statusBadge(status: FilterStatus) {
  if (status === 'matched') return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">Validated · Matched</span>
  if (status === 'difference') return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">Validated · Difference</span>
  if (status === 'needs_review') return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800">Needs review</span>
  return <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted))]">Pending</span>
}

function paymentLabel(value?: string | null) {
  if (value === 'cash') return 'Cash'
  if (value === 'instapay') return 'Instapay'
  if (value === 'bank_transfer') return 'Bank transfer'
  if (value === 'card') return 'Card'
  return '—'
}

export default async function StoreReconciliationPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/reconciliation')

  if (!canAccessStoreReconciliation(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Reconciliation"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Store sales reconciliation is restricted to Super Admin."
        allowed="super_admin"
        nextPath="/admin/store/reconciliation"
        actions={[{ href: '/admin/store', label: 'Back to Store' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()
  const rawStatus = str(searchParams?.status)
  const statusFilter = (['pending', 'matched', 'difference', 'needs_review'].includes(rawStatus) ? rawStatus : 'all') as FilterStatus
  const paymentFilter = str(searchParams?.payment)
  const from = str(searchParams?.from)
  const to = str(searchParams?.to)

  const [{ data: salesData, error: salesErr }, { data: recData, error: recErr }] = await Promise.all([
    admin
      .from('store_sales')
      .select('id,buyer_full_name,buyer_member_id,status,payment_method,currency,total_cents,paid_cents,debt_cents,purchase_date,created_at')
      .order('purchase_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('store_sale_reconciliations')
      .select('id,sale_id,recorded_paid_cents_snapshot,actual_received_cents,variance_cents,payment_method_snapshot,received_date,reference,note,validated_by,validated_at')
      .order('validated_at', { ascending: false })
      .limit(5000),
  ])

  const sales = (Array.isArray(salesData) ? salesData : []) as SaleRow[]
  const recs = (Array.isArray(recData) ? recData : []) as ReconciliationRow[]

  const latestBySale = new Map<string, ReconciliationRow>()
  for (const rec of recs) if (!latestBySale.has(rec.sale_id)) latestBySale.set(rec.sale_id, rec)

  const legacySales = sales.filter((sale) => effectiveSaleDate(sale) < RECONCILIATION_START_DATE)
  const currentSales = sales.filter((sale) => effectiveSaleDate(sale) >= RECONCILIATION_START_DATE)

  const allMapped = currentSales.map((sale) => {
    const latest = latestBySale.get(sale.id) ?? null
    return { sale, latest, recStatus: reconciliationStatus(sale, latest) }
  })

  const rows = allMapped.filter(({ sale, recStatus }) => {
    if (statusFilter !== 'all' && recStatus !== statusFilter) return false
    if (paymentFilter && paymentFilter !== 'all' && sale.payment_method !== paymentFilter) return false
    const date = effectiveSaleDate(sale)
    if (from && date < from) return false
    if (to && date > to) return false
    return true
  })

  const pendingCount = allMapped.filter((row) => row.recStatus === 'pending').length
  const matchedCount = allMapped.filter((row) => row.recStatus === 'matched').length
  const differenceCount = allMapped.filter((row) => row.recStatus === 'difference').length
  const reviewCount = allMapped.filter((row) => row.recStatus === 'needs_review').length
  const recordedCents = allMapped.reduce((sum, row) => sum + Math.max(0, Number(row.sale.paid_cents || 0)), 0)
  const actualCents = allMapped.reduce((sum, row) => (!row.latest || row.recStatus === 'needs_review') ? sum : sum + Math.max(0, Number(row.latest.actual_received_cents || 0)), 0)
  const reconciledRecordedCents = allMapped.reduce((sum, row) => (!row.latest || row.recStatus === 'needs_review') ? sum : sum + Math.max(0, Number(row.latest.recorded_paid_cents_snapshot || 0)), 0)
  const validatedVarianceCents = actualCents - reconciledRecordedCents
  const canManage = canManageStoreReconciliation(me.role)

  return (
    <main>
      <PageHeader
        title="Store Admin — Sales Reconciliation"
        subtitle="Confirm the amount actually received against Store sales. Active reconciliation starts 01 Sep 2026."
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/reconciliation" role={me.role} />

        {(salesErr || recErr) ? (
          <Card><CardContent className="text-sm text-rose-700">Could not load reconciliation data: {salesErr?.message || recErr?.message}</CardContent></Card>
        ) : null}

        <Card className="border-sky-200 bg-sky-50">
          <CardContent className="space-y-1 text-sm text-sky-950">
            <div className="font-semibold">Reconciliation baseline</div>
            <div>Sales before 01 Sep 2026 are considered historically validated and are excluded from the pending queue.</div>
            <div className="text-xs text-sky-800">Legacy validated sales detected: {legacySales.length}</div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Recorded paid</div><div className="text-xl font-semibold">{formatCurrency(recordedCents, 'en-EG', 'EGP')}</div><div className="text-xs text-[hsl(var(--muted))]">Since 01 Sep 2026</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Actual validated</div><div className="text-xl font-semibold">{formatCurrency(actualCents, 'en-EG', 'EGP')}</div><div className="text-xs text-[hsl(var(--muted))]">Current valid reconciliations</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Validated variance</div><div className={`text-xl font-semibold ${validatedVarianceCents === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{validatedVarianceCents > 0 ? '+' : ''}{formatCurrency(validatedVarianceCents, 'en-EG', 'EGP')}</div><div className="text-xs text-[hsl(var(--muted))]">Actual minus recorded snapshots</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-xs text-[hsl(var(--muted))]">Pending / review</div><div className="text-xl font-semibold">{pendingCount} / {reviewCount}</div><div className="text-xs text-[hsl(var(--muted))]">Matched {matchedCount} · Difference {differenceCount}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="space-y-3">
            <form method="get" action="/admin/store/reconciliation" className="grid gap-3 md:grid-cols-5">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Status</span>
                <select name="status" defaultValue={statusFilter} className="min-h-[42px] w-full rounded-xl border bg-white px-3 py-2 text-sm">
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="matched">Matched</option>
                  <option value="difference">Difference</option>
                  <option value="needs_review">Needs review</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment</span>
                <select name="payment" defaultValue={paymentFilter || 'all'} className="min-h-[42px] w-full rounded-xl border bg-white px-3 py-2 text-sm">
                  <option value="all">All</option>
                  <option value="cash">Cash</option>
                  <option value="instapay">Instapay</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="card">Card</option>
                </select>
              </label>
              <label className="block"><span className="mb-1 block text-sm font-medium">From</span><input name="from" type="date" min={RECONCILIATION_START_DATE} defaultValue={from} className="min-h-[42px] w-full rounded-xl border bg-white px-3 py-2 text-sm" /></label>
              <label className="block"><span className="mb-1 block text-sm font-medium">To</span><input name="to" type="date" min={RECONCILIATION_START_DATE} defaultValue={to} className="min-h-[42px] w-full rounded-xl border bg-white px-3 py-2 text-sm" /></label>
              <div className="flex items-end gap-2"><button type="submit" className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button><Link href="/admin/store/reconciliation" className="min-h-[42px] rounded-xl border bg-white px-4 py-2 text-sm font-medium leading-[26px]">Reset</Link></div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {rows.length === 0 ? (
            <Card><CardContent className="text-sm text-[hsl(var(--muted))]">No sales match the selected reconciliation filters.</CardContent></Card>
          ) : rows.map(({ sale, latest, recStatus }) => {
            const date = effectiveSaleDate(sale)
            const paid = Math.max(0, Number(sale.paid_cents || 0))
            const debt = Math.max(0, Number(sale.debt_cents || 0))
            const buyer = sale.buyer_full_name || sale.buyer_member_id || `Sale ${sale.id.slice(0, 8)}`
            const currentChangedAfterValidation = recStatus === 'needs_review'

            return (
              <Card key={sale.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{buyer}</div>
                        {statusBadge(recStatus)}
                        {sale.status === 'canceled' ? <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-800">Canceled</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">Sale {sale.id.slice(0, 8)} · {fmtDate(date)} · {paymentLabel(sale.payment_method)}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-right text-sm">
                      <div><div className="text-xs text-[hsl(var(--muted))]">Total</div><div className="font-medium">{formatCurrency(Number(sale.total_cents || 0), 'en-EG', sale.currency || 'EGP')}</div></div>
                      <div><div className="text-xs text-[hsl(var(--muted))]">Recorded paid</div><div className="font-medium">{formatCurrency(paid, 'en-EG', sale.currency || 'EGP')}</div></div>
                      <div><div className="text-xs text-[hsl(var(--muted))]">Debt</div><div className={debt > 0 ? 'font-medium text-amber-700' : 'font-medium text-emerald-700'}>{formatCurrency(debt, 'en-EG', sale.currency || 'EGP')}</div></div>
                    </div>
                  </div>

                  {latest ? (
                    <div className={`rounded-2xl border p-3 text-sm ${currentChangedAfterValidation ? 'border-rose-200 bg-rose-50' : Number(latest.variance_cents || 0) === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div><div className="text-xs opacity-70">Last actual received</div><div className="font-semibold">{formatCurrency(Number(latest.actual_received_cents || 0), 'en-EG', sale.currency || 'EGP')}</div></div>
                        <div><div className="text-xs opacity-70">Snapshot recorded</div><div className="font-semibold">{formatCurrency(Number(latest.recorded_paid_cents_snapshot || 0), 'en-EG', sale.currency || 'EGP')}</div></div>
                        <div><div className="text-xs opacity-70">Variance</div><div className="font-semibold">{Number(latest.variance_cents || 0) > 0 ? '+' : ''}{formatCurrency(Number(latest.variance_cents || 0), 'en-EG', sale.currency || 'EGP')}</div></div>
                        <div><div className="text-xs opacity-70">Validated</div><div className="font-semibold">{fmtDateTime(latest.validated_at)}</div></div>
                      </div>
                      {currentChangedAfterValidation ? <div className="mt-2 text-xs font-medium text-rose-800">Recorded paid amount changed after the last validation. Reconcile this sale again.</div> : null}
                      {latest.reference ? <div className="mt-2 text-xs">Reference: {latest.reference}</div> : null}
                      {latest.note ? <div className="mt-1 text-xs">Note: {latest.note}</div> : null}

                      {canManage ? (
                        <StoreSaleReconciliationEdit
                          reconciliationId={latest.id}
                          recordedPaidCents={Number(latest.recorded_paid_cents_snapshot || 0)}
                          actualReceivedCents={Number(latest.actual_received_cents || 0)}
                          paymentMethod={latest.payment_method_snapshot}
                          receivedDate={latest.received_date}
                          reference={latest.reference}
                          note={latest.note}
                          currency={sale.currency}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {canManage && sale.status !== 'canceled' && (recStatus === 'pending' || recStatus === 'needs_review') ? (
                    <StoreSaleReconciliationForm
                      saleId={sale.id}
                      buyerLabel={buyer}
                      recordedPaidCents={paid}
                      paymentMethod={sale.payment_method}
                      purchaseDate={date}
                      currency={sale.currency}
                    />
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </Section>
    </main>
  )
}
