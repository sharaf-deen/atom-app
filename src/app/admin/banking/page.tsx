export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import BankStatementImporter from '@/components/admin/banking/BankStatementImporter'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type Direction = 'all' | 'credit' | 'debit'

type BankAccountRow = {
  id: string
  code: string
  display_name: string
  bank_name: string | null
  account_reference: string | null
  currency: string
  is_active: boolean
}

type BankTransactionRow = {
  id: string
  account_id: string
  transaction_date: string
  value_date: string | null
  description: string
  reference: string | null
  counterparty: string | null
  amount: number | string
  direction: 'credit' | 'debit'
  running_balance: number | string | null
  currency: string
  source_row: number | null
  created_at: string
}

type ImportRow = {
  id: string
  account_id: string
  filename: string
  status: 'processing' | 'completed' | 'failed'
  row_count: number
  inserted_count: number
  duplicate_count: number
  skipped_count: number
  date_from: string | null
  date_to: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function safeDirection(value: unknown): Direction {
  return value === 'credit' || value === 'debit' ? value : 'all'
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

function defaultFrom(today: string) {
  const [y, m] = today.split('-')
  return `${y}-${m}-01`
}

function fmtMoney(value: unknown, currency = 'EGP') {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return '—'
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

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value)
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export default async function AdminBankingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/banking')

  if (me.role !== 'super_admin') {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Banking</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Super Admin can access ATOM banking data."
            nextPath="/admin/banking"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const today = cairoToday()
  const q = String(first(searchParams?.q) ?? '').trim()
  const direction = safeDirection(first(searchParams?.direction))
  const from = safeDate(first(searchParams?.from)) || defaultFrom(today)
  const to = safeDate(first(searchParams?.to)) || today
  const accountFilter = String(first(searchParams?.account) ?? '').trim()

  const admin = getSupabaseAdminClientCached() as any

  const { data: accountsData, error: accountsError } = await admin
    .from('bank_accounts')
    .select('id,code,display_name,bank_name,account_reference,currency,is_active')
    .eq('is_active', true)
    .order('display_name', { ascending: true })

  const accounts = (accountsData ?? []) as BankAccountRow[]
  const validAccountId = accounts.some((row) => row.id === accountFilter) ? accountFilter : ''
  const currency = accounts[0]?.currency || 'EGP'

  let txQuery = admin
    .from('bank_transactions')
    .select('id,account_id,transaction_date,value_date,description,reference,counterparty,amount,direction,running_balance,currency,source_row,created_at')
    .gte('transaction_date', from)
    .lte('transaction_date', to)
    .order('transaction_date', { ascending: false })
    .order('source_row', { ascending: false, nullsFirst: false })
    .limit(5000)

  if (validAccountId) txQuery = txQuery.eq('account_id', validAccountId)
  if (direction !== 'all') txQuery = txQuery.eq('direction', direction)

  const [txResult, importsResult] = await Promise.all([
    txQuery,
    admin
      .from('bank_statement_imports')
      .select('id,account_id,filename,status,row_count,inserted_count,duplicate_count,skipped_count,date_from,date_to,error_message,created_at,completed_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const transactions = (txResult.data ?? []) as BankTransactionRow[]
  const imports = (importsResult.data ?? []) as ImportRow[]
  const loadError = accountsError?.message || txResult.error?.message || importsResult.error?.message || null

  const needle = q.toLowerCase()
  const filtered = needle
    ? transactions.filter((row) => [
        row.description,
        row.reference,
        row.counterparty,
        String(row.amount),
      ].filter(Boolean).join(' ').toLowerCase().includes(needle))
    : transactions

  let inflows = 0
  let outflows = 0
  for (const row of filtered) {
    const amount = Math.abs(Number(row.amount ?? 0))
    if (row.direction === 'credit') inflows += amount
    else outflows += amount
  }
  const net = inflows - outflows

  let latestBalance: BankTransactionRow | null = null
  if (accounts.length) {
    let balanceQuery = admin
      .from('bank_transactions')
      .select('id,account_id,transaction_date,value_date,description,reference,counterparty,amount,direction,running_balance,currency,source_row,created_at')
      .not('running_balance', 'is', null)
      .order('transaction_date', { ascending: false })
      .order('source_row', { ascending: false, nullsFirst: false })
      .limit(1)

    if (validAccountId) balanceQuery = balanceQuery.eq('account_id', validAccountId)
    const { data } = await balanceQuery
    latestBalance = (data?.[0] ?? null) as BankTransactionRow | null
  }

  const accountById = new Map(accounts.map((row) => [row.id, row]))

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Banking</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            Read-only bank feed for ATOM. Import statements, review inflows/outflows and maintain a clean transaction history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/payments/reconciliation">Payments reconciliation</Button>
          <Button asChild variant="outline" href="/admin">Admin</Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Could not load banking data: {loadError}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Inflows</p>
          <p className="mt-2 text-xl font-bold text-emerald-700">{fmtMoney(inflows, currency)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(from)} → {fmtDate(to)}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Outflows</p>
          <p className="mt-2 text-xl font-bold text-rose-700">{fmtMoney(outflows, currency)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(from)} → {fmtDate(to)}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Net movement</p>
          <p className={`mt-2 text-xl font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(net, currency)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">{filtered.length} transaction(s)</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Latest reported balance</p>
          <p className="mt-2 text-xl font-bold">{latestBalance ? fmtMoney(latestBalance.running_balance, latestBalance.currency) : '—'}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">
            {latestBalance ? `Statement row · ${fmtDate(latestBalance.transaction_date)}` : 'Import a Balance column to populate'}
          </p>
        </div>
      </section>

      <BankStatementImporter
        accounts={accounts.map((row) => ({
          id: row.id,
          display_name: row.display_name,
          bank_name: row.bank_name,
          currency: row.currency,
        }))}
      />

      <section className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Bank feed</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Search and review imported bank transactions.</p>
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_180px_220px_auto] xl:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Search</span>
            <input name="q" defaultValue={q} placeholder="Description, reference, counterparty…" className="w-full rounded-xl border px-3 py-2.5" />
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
            <span className="font-medium">Direction</span>
            <select name="direction" defaultValue={direction} className="w-full rounded-xl border px-3 py-2.5">
              <option value="all">All</option>
              <option value="credit">Inflows</option>
              <option value="debit">Outflows</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Account</span>
            <select name="account" defaultValue={validAccountId} className="w-full rounded-xl border px-3 py-2.5">
              <option value="">All accounts</option>
              {accounts.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <Button asChild variant="outline" href="/admin/banking">Reset</Button>
          </div>
        </form>

        <div className="mt-4 space-y-2">
          {filtered.slice(0, 300).map((row) => {
            const account = accountById.get(row.account_id)
            return (
              <article key={row.id} className="rounded-xl border border-[hsl(var(--border))] p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${row.direction === 'credit' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                        {row.direction === 'credit' ? 'IN' : 'OUT'}
                      </span>
                      <span className="text-sm font-semibold">{fmtDate(row.transaction_date)}</span>
                      <span className="text-xs text-[hsl(var(--muted))]">{account?.display_name ?? 'Bank account'}</span>
                    </div>
                    <p className="mt-1 break-words font-medium">{row.description}</p>
                    <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {row.counterparty ? `Counterparty: ${row.counterparty}` : ''}
                      {row.counterparty && row.reference ? ' · ' : ''}
                      {row.reference ? `Ref: ${row.reference}` : ''}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className={`text-lg font-bold ${row.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {row.direction === 'credit' ? '+' : '-'}{fmtMoney(row.amount, row.currency)}
                    </p>
                    {row.running_balance !== null ? (
                      <p className="mt-1 text-xs text-[hsl(var(--muted))]">Balance: {fmtMoney(row.running_balance, row.currency)}</p>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}

          {!filtered.length ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-[hsl(var(--muted))]">
              No bank transactions match the current filters.
            </div>
          ) : null}

          {filtered.length > 300 ? (
            <p className="text-xs text-[hsl(var(--muted))]">Showing the first 300 matching transactions. Narrow the filters to review older items.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <h2 className="font-semibold">Recent imports</h2>
        <div className="mt-3 space-y-2">
          {imports.map((row) => (
            <div key={row.id} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{row.filename}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : row.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                {fmtDateTime(row.created_at)}
                {' · '}{row.inserted_count} imported
                {' · '}{row.duplicate_count} duplicate(s)
                {' · '}{row.skipped_count} skipped
                {row.date_from || row.date_to ? ` · ${fmtDate(row.date_from)} → ${fmtDate(row.date_to)}` : ''}
              </p>
              {row.error_message ? <p className="mt-1 text-xs text-rose-700">{row.error_message}</p> : null}
            </div>
          ))}
          {!imports.length ? <p className="text-sm text-[hsl(var(--muted))]">No bank statements imported yet.</p> : null}
        </div>
      </section>

      <p className="text-xs text-[hsl(var(--muted))]">
        Banking 1A is read-only with respect to the bank and other ATOM finance modules. It never initiates transfers or modifies Payments, Expenses, Store or Payroll.
      </p>
    </main>
  )
}
