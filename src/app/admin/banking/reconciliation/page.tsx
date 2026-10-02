export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import BankPaymentMatcher, {
  type BankPaymentBatch,
  type BankPaymentMatch,
} from '@/components/admin/banking/BankPaymentMatcher'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type CreditRow = {
  id: string
  transaction_date: string
  description: string
  reference: string | null
  counterparty: string | null
  amount: number | string
  currency: string
  category_code: string | null
  classification_status: string
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function safeDate(value: unknown) {
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function cairoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((part) => part.type === 'year')?.value ?? ''
  const m = parts.find((part) => part.type === 'month')?.value ?? ''
  const d = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${y}-${m}-${d}`
}

function monthStart(today: string) {
  const [y, m] = today.split('-')
  return `${y}-${m}-01`
}

function fmtMoney(value: unknown, currency = 'EGP') {
  const amount = Number(value ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function fmtDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date)
}

export default async function BankingReconciliationPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/banking/reconciliation')

  if (me.role !== 'super_admin') {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Banking · Payment Reconciliation</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Super Admin can reconcile bank transactions."
            nextPath="/admin/banking/reconciliation"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const today = cairoToday()
  const from = safeDate(first(searchParams?.from)) || monthStart(today)
  const to = safeDate(first(searchParams?.to)) || today
  const statusFilter = String(first(searchParams?.status) ?? 'all')
  const q = String(first(searchParams?.q) ?? '').trim().toLowerCase()
  const admin = getSupabaseAdminClientCached() as any

  const [creditsResult, matchesResult, batchesResult, legacyResult] = await Promise.all([
    admin
      .from('bank_transactions')
      .select('id,transaction_date,description,reference,counterparty,amount,currency,category_code,classification_status')
      .eq('direction', 'credit')
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: false })
      .limit(2000),
    admin
      .from('bank_payment_matches')
      .select('id,bank_transaction_id,batch_id,matched_amount,note,matched_at')
      .is('released_at', null)
      .order('matched_at', { ascending: false }),
    admin
      .from('payment_validation_batches')
      .select('id,payment_method,business_date,expected_amount,counted_amount,difference_amount,validated_at,deleted_at,superseded_by_batch_id')
      .is('deleted_at', null)
      .is('superseded_by_batch_id', null)
      .gte('business_date', '2026-08-01')
      .order('business_date', { ascending: false })
      .limit(3000),
    admin
      .from('reconciliation_bank_matches')
      .select('batch_id')
      .is('released_at', null),
  ])

  const loadError =
    creditsResult.error?.message
    || matchesResult.error?.message
    || batchesResult.error?.message
    || legacyResult.error?.message
    || null

  const credits = (creditsResult.data ?? []) as CreditRow[]
  const matches = (matchesResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    bank_transaction_id: String(row.bank_transaction_id),
    batch_id: String(row.batch_id),
    matched_amount: Number(row.matched_amount ?? 0),
    note: row.note ?? null,
    matched_at: String(row.matched_at),
  })) as BankPaymentMatch[]

  const legacyBatchIds = new Set((legacyResult.data ?? []).map((row: any) => String(row.batch_id)))
  const activeMatchedByBatch = new Map<string, number>()
  for (const match of matches) {
    activeMatchedByBatch.set(match.batch_id, (activeMatchedByBatch.get(match.batch_id) ?? 0) + match.matched_amount)
  }

  const batches = (batchesResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    payment_method: String(row.payment_method),
    business_date: row.business_date ?? null,
    expected_amount: Number(row.expected_amount ?? 0),
    counted_amount: Number(row.counted_amount ?? 0),
    difference_amount: Number(row.difference_amount ?? 0),
    validated_at: String(row.validated_at),
    legacy_matched: legacyBatchIds.has(String(row.id)),
    active_matched_amount: activeMatchedByBatch.get(String(row.id)) ?? 0,
  })) as BankPaymentBatch[]

  const matchesByTransaction = new Map<string, BankPaymentMatch[]>()
  for (const match of matches) {
    const current = matchesByTransaction.get(match.bank_transaction_id) ?? []
    current.push(match)
    matchesByTransaction.set(match.bank_transaction_id, current)
  }

  function progress(row: CreditRow): {
    matched: number
    remaining: number
    status: 'unmatched' | 'partial' | 'matched'
  } {
    const active = matchesByTransaction.get(row.id) ?? []
    const matched = active.reduce((sum, match) => sum + match.matched_amount, 0)
    const amount = Number(row.amount ?? 0)
    const remaining = Math.max(0, amount - matched)
    const status: 'unmatched' | 'partial' | 'matched' =
      matched <= 0.009 ? 'unmatched' : remaining <= 0.009 ? 'matched' : 'partial'
    return { matched, remaining, status }
  }

  const visible = credits.filter((row) => {
    if (q) {
      const haystack = [row.description, row.reference, row.counterparty, row.amount]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    const state = progress(row).status
    if (statusFilter === 'unmatched' || statusFilter === 'partial' || statusFilter === 'matched') {
      return state === statusFilter
    }
    return true
  })

  const stats = credits.reduce(
    (acc, row) => {
      const p = progress(row)
      acc[p.status] += 1
      acc.total += Number(row.amount ?? 0)
      acc.matchedAmount += p.matched
      return acc
    },
    { unmatched: 0, partial: 0, matched: 0, total: 0, matchedAmount: 0 },
  )

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Banking · Payment Reconciliation</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            Match real bank credits from the Banking feed to validated ATOM payment batches. Matches are auditable and reversible.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/banking">Bank feed</Button>
          <Button asChild variant="outline" href="/admin/payments/reconciliation">Payments reconciliation</Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Could not load reconciliation data: {loadError}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={`/admin/banking/reconciliation?from=${from}&to=${to}&status=unmatched`} className="rounded-2xl border bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Unmatched</p>
          <p className="mt-1 text-2xl font-bold">{stats.unmatched}</p>
        </Link>
        <Link href={`/admin/banking/reconciliation?from=${from}&to=${to}&status=partial`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Partial</p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{stats.partial}</p>
        </Link>
        <Link href={`/admin/banking/reconciliation?from=${from}&to=${to}&status=matched`} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Matched</p>
          <p className="mt-1 text-2xl font-bold text-emerald-900">{stats.matched}</p>
        </Link>
        <div className="rounded-2xl border bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Matched value</p>
          <p className="mt-1 text-xl font-bold">{fmtMoney(stats.matchedAmount)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">of {fmtMoney(stats.total)} bank credits</p>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-soft">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_180px_auto] xl:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Search</span>
            <input name="q" defaultValue={String(first(searchParams?.q) ?? '')} placeholder="Description, reference, counterparty…" className="w-full rounded-xl border px-3 py-2.5" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">From</span>
            <input type="date" name="from" defaultValue={from} className="w-full rounded-xl border px-3 py-2.5" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">To</span>
            <input type="date" name="to" defaultValue={to} className="w-full rounded-xl border px-3 py-2.5" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Status</span>
            <select name="status" defaultValue={statusFilter} className="w-full rounded-xl border px-3 py-2.5">
              <option value="all">All</option>
              <option value="unmatched">Unmatched</option>
              <option value="partial">Partial</option>
              <option value="matched">Matched</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <Button asChild variant="outline" href="/admin/banking/reconciliation">Reset</Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        {visible.slice(0, 250).map((row) => {
          const p = progress(row)
          const active = matchesByTransaction.get(row.id) ?? []
          return (
            <article key={row.id} className="rounded-2xl border bg-white p-4 shadow-soft">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      p.status === 'matched'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : p.status === 'partial'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}>
                      {p.status === 'matched' ? 'Matched' : p.status === 'partial' ? 'Partial' : 'Unmatched'}
                    </span>
                    <span className="text-sm font-semibold">{fmtDate(row.transaction_date)}</span>
                    {row.category_code ? (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
                        {row.category_code.replaceAll('_', ' ')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-semibold">{row.description}</p>
                  <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {row.counterparty ? `Counterparty: ${row.counterparty}` : ''}
                    {row.counterparty && row.reference ? ' · ' : ''}
                    {row.reference ? `Ref: ${row.reference}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <p className="text-lg font-bold text-emerald-700">+{fmtMoney(row.amount, row.currency)}</p>
                  <p className="text-xs text-[hsl(var(--muted))]">
                    Matched {fmtMoney(p.matched)} · Remaining {fmtMoney(p.remaining)}
                  </p>
                </div>
              </div>

              <BankPaymentMatcher
                transactionId={row.id}
                transactionDate={row.transaction_date}
                transactionAmount={Number(row.amount ?? 0)}
                activeMatches={active}
                batches={batches}
              />
            </article>
          )
        })}

        {!visible.length ? (
          <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-[hsl(var(--muted))]">
            No bank credits match the current filters.
          </div>
        ) : null}

        {visible.length > 250 ? (
          <p className="text-xs text-[hsl(var(--muted))]">Showing first 250 results. Narrow the date range or status to continue.</p>
        ) : null}
      </section>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Banking reconciliation never edits the original bank transaction or ATOM payment batch. Releasing a match preserves its audit record.
      </div>
    </main>
  )
}
