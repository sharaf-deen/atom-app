export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { canAccessPayments } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type BankMethod = 'instapay' | 'card' | 'bank_transfer'
type LineFilter = 'unmatched' | 'matched' | 'all'

type ImportRow = {
  id: string
  bank_name: string
  account_label: string | null
  statement_from: string
  statement_to: string
  original_filename: string
  file_size_bytes: number
  row_count: number
  skipped_row_count: number
  total_credit: number
  total_debit: number
  imported_at: string
}

type BankLine = {
  id: string
  import_id: string
  row_number: number
  transaction_date: string
  value_date: string | null
  description: string | null
  reference: string | null
  debit_amount: number
  credit_amount: number
  currency: string
}

type BatchRow = {
  id: string
  payment_method: BankMethod
  business_date: string
  expected_amount: number
  counted_amount: number
  difference_amount: number
  note: string | null
  validated_at: string
}

type MatchRow = {
  id: string
  batch_id: string
  statement_line_id: string
  matched_amount: number
  note: string | null
  matched_at: string
  released_at: string | null
  release_reason: string | null
}

function sp1(sp: Record<string, string | string[] | undefined>, key: string) {
  const value = sp[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

function safeFilter(value: string): LineFilter {
  return value === 'matched' || value === 'all' ? value : 'unmatched'
}

function safeFlash(value: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function formatEGP(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(Number(value ?? 0))
  } catch {
    return `${Number(value ?? 0).toFixed(2)} EGP`
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  }).format(date)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function formatFileSize(bytes?: number | null) {
  const value = Number(bytes ?? 0)
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function methodLabel(method: BankMethod) {
  if (method === 'instapay') return 'Instapay'
  if (method === 'card') return 'Card'
  return 'Bank transfer'
}

function methodClass(method: BankMethod) {
  if (method === 'instapay') return 'bg-sky-50 text-sky-700'
  if (method === 'card') return 'bg-violet-50 text-violet-700'
  return 'bg-amber-50 text-amber-800'
}

function dayDistance(a: string, b: string) {
  const left = Date.parse(`${a}T00:00:00Z`)
  const right = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 9999
  return Math.abs(Math.round((left - right) / 86400000))
}

function flashMessage(code: string) {
  const messages: Record<string, string> = {
    SUPER_ADMIN_REQUIRED: 'Only Super Admin can import statements or change bank matches.',
    FILE_REQUIRED: 'Select a CSV bank statement.',
    FILE_TOO_LARGE: 'CSV file is too large. Maximum size is 5 MB.',
    CSV_REQUIRED: 'Bank Statement Matching currently accepts CSV files.',
    CSV_EMPTY_OR_HEADER_ONLY: 'The CSV contains no transaction rows.',
    CSV_TRANSACTION_DATE_COLUMN_REQUIRED: 'No transaction-date column was recognized in the CSV.',
    CSV_AMOUNT_COLUMNS_REQUIRED: 'No Debit/Credit or signed Amount column was recognized in the CSV.',
    CSV_NO_ELIGIBLE_ROWS_FROM_BASELINE: 'No eligible bank transaction was found on or after 01/08/2026.',
    STATEMENT_ALREADY_IMPORTED: 'This exact bank statement file has already been imported.',
    MIGRATION_REQUIRED: 'Apply the Reconciliation 1D migration before importing a statement.',
    STATEMENT_UPLOAD_FAILED: 'The original statement file could not be stored.',
    STATEMENT_SAVE_FAILED: 'The statement import record could not be saved.',
    BANK_LINES_INSERT_FAILED: 'The normalized bank lines could not be saved. The import was rolled back.',
    INVALID_MATCH_TARGET: 'Select a valid reconciliation batch.',
    CREDIT_LINE_REQUIRED: 'Only bank credit lines can be matched to income reconciliation batches.',
    BANK_LINE_ALREADY_MATCHED: 'This bank line already has an active match.',
    BATCH_NOT_ELIGIBLE: 'The selected batch is not an eligible post-01/08 bank-method reconciliation batch.',
    MATCH_SAVE_FAILED: 'The bank match could not be saved.',
    RELEASE_REASON_REQUIRED: 'A reason is required to release a bank match.',
    MATCH_ALREADY_RELEASED: 'This bank match was already released.',
    MATCH_RELEASE_FAILED: 'The bank match could not be released.',
    PROFILE_LOOKUP_FAILED: 'Your staff profile could not be verified.',
    SERVICE_ROLE_MISSING: 'Server storage configuration is missing.',
    SERVER_ERROR: 'Unexpected server error.',
  }
  return messages[code] || code.replace(/_/g, ' ')
}

function coverageStatus(counted: number, bankMatched: number) {
  const delta = Math.round((bankMatched - counted) * 100) / 100
  if (Math.abs(delta) < 0.01) {
    return { label: 'Bank matched', className: 'bg-emerald-50 text-emerald-700', delta }
  }
  if (delta < 0) return { label: 'Partial', className: 'bg-amber-50 text-amber-800', delta }
  return { label: 'Bank over', className: 'bg-rose-50 text-rose-700', delta }
}

export default async function BankMatchingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/payments/reconciliation/bank-matching')

  if (!canAccessPayments(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Bank Statement Matching</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access bank reconciliation matching."
            nextPath="/admin/payments/reconciliation/bank-matching"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const canWrite = me.role === 'super_admin'
  const filter = safeFilter(sp1(searchParams, 'filter'))
  const errorCode = safeFlash(sp1(searchParams, 'error'))
  const imported = Number(sp1(searchParams, 'imported') || 0)
  const skipped = Number(sp1(searchParams, 'skipped') || 0)
  const matched = sp1(searchParams, 'matched') === '1'
  const released = sp1(searchParams, 'released') === '1'
  const admin = getSupabaseAdminClientCached()

  const [importsResult, linesResult, batchesResult, matchesResult] = await Promise.all([
    admin
      .from('reconciliation_bank_imports')
      .select('id,bank_name,account_label,statement_from,statement_to,original_filename,file_size_bytes,row_count,skipped_row_count,total_credit,total_debit,imported_at')
      .order('imported_at', { ascending: false })
      .limit(25),
    admin
      .from('reconciliation_bank_statement_lines')
      .select('id,import_id,row_number,transaction_date,value_date,description,reference,debit_amount,credit_amount,currency')
      .order('transaction_date', { ascending: false })
      .order('row_number', { ascending: false })
      .limit(500),
    admin
      .from('payment_validation_batches')
      .select('id,payment_method,business_date,expected_amount,counted_amount,difference_amount,note,validated_at')
      .is('deleted_at', null)
      .in('payment_method', ['instapay', 'card', 'bank_transfer'])
      .gte('business_date', '2026-08-01')
      .order('business_date', { ascending: false })
      .limit(350),
    admin
      .from('reconciliation_bank_matches')
      .select('id,batch_id,statement_line_id,matched_amount,note,matched_at,released_at,release_reason')
      .order('matched_at', { ascending: false })
      .limit(1000),
  ])

  const imports: ImportRow[] = ((importsResult.data ?? []) as any[]).map((row) => ({
    ...row,
    file_size_bytes: Number(row.file_size_bytes ?? 0),
    row_count: Number(row.row_count ?? 0),
    skipped_row_count: Number(row.skipped_row_count ?? 0),
    total_credit: Number(row.total_credit ?? 0),
    total_debit: Number(row.total_debit ?? 0),
  }))

  const lines: BankLine[] = ((linesResult.data ?? []) as any[]).map((row) => ({
    ...row,
    row_number: Number(row.row_number ?? 0),
    debit_amount: Number(row.debit_amount ?? 0),
    credit_amount: Number(row.credit_amount ?? 0),
  }))

  const batches: BatchRow[] = ((batchesResult.data ?? []) as any[]).map((row) => ({
    ...row,
    payment_method: row.payment_method as BankMethod,
    expected_amount: Number(row.expected_amount ?? 0),
    counted_amount: Number(row.counted_amount ?? 0),
    difference_amount: Number(row.difference_amount ?? 0),
  }))

  const matches: MatchRow[] = ((matchesResult.data ?? []) as any[]).map((row) => ({
    ...row,
    matched_amount: Number(row.matched_amount ?? 0),
  }))

  const activeMatches = matches.filter((row) => !row.released_at)
  const releasedMatches = matches.filter((row) => Boolean(row.released_at))
  const activeMatchByLine = new Map(activeMatches.map((row) => [row.statement_line_id, row]))
  const batchById = new Map(batches.map((row) => [row.id, row]))
  const lineById = new Map(lines.map((row) => [row.id, row]))
  const importById = new Map(imports.map((row) => [row.id, row]))

  const matchesByBatch = new Map<string, MatchRow[]>()
  const matchedAmountByBatch = new Map<string, number>()
  for (const match of activeMatches) {
    const list = matchesByBatch.get(match.batch_id) ?? []
    list.push(match)
    matchesByBatch.set(match.batch_id, list)
    matchedAmountByBatch.set(match.batch_id, (matchedAmountByBatch.get(match.batch_id) ?? 0) + match.matched_amount)
  }

  const creditLines = lines.filter((row) => row.credit_amount > 0)
  const unmatchedCredits = creditLines.filter((row) => !activeMatchByLine.has(row.id))
  const matchedCredits = creditLines.filter((row) => activeMatchByLine.has(row.id))
  const visibleCredits = filter === 'matched' ? matchedCredits : filter === 'all' ? creditLines : unmatchedCredits
  const bankMatchedBatches = batches.filter((batch) => Math.abs((matchedAmountByBatch.get(batch.id) ?? 0) - batch.counted_amount) < 0.01).length

  const loadError = importsResult.error?.message || linesResult.error?.message || batchesResult.error?.message || matchesResult.error?.message || ''

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">Reconciliation 1D</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${canWrite ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                {canWrite ? 'Super Admin · bank matching' : 'Admin · read-only'}
              </span>
            </div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Bank Statement Matching</h1>
            <p className="text-sm text-[hsl(var(--muted))] sm:text-base">
              Import the professional bank statement and link real bank credits to Instapay, Card and Bank Transfer reconciliation batches. Matching is an audit layer only: ATOM payments and reconciliation amounts remain unchanged.
            </p>
          </div>
          <Link prefetch={false} href="/admin/payments/reconciliation" className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
            ← Reconciliation
          </Link>
        </div>
      </section>

      {loadError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Bank Matching data could not be loaded: {loadError}</div> : null}
      {errorCode ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{flashMessage(errorCode)}</div> : null}
      {imported > 0 ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Bank statement imported: {imported} eligible transaction{imported === 1 ? '' : 's'} stored{skipped > 0 ? ` · ${skipped} invalid or pre-01/08 row${skipped === 1 ? '' : 's'} skipped` : ''}.</div> : null}
      {matched ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Bank line matched. No payment or reconciliation amount was modified.</div> : null}
      {released ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Bank match released. The previous match remains preserved in the audit trail.</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4"><div className="text-xs text-[hsl(var(--muted))]">Statements imported</div><div className="mt-1 text-2xl font-semibold">{imports.length}</div></div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4"><div className="text-xs text-[hsl(var(--muted))]">Bank credits loaded</div><div className="mt-1 text-2xl font-semibold">{creditLines.length}</div></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4"><div className="text-xs text-[hsl(var(--muted))]">Unmatched bank credits</div><div className="mt-1 text-2xl font-semibold">{unmatchedCredits.length}</div></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4"><div className="text-xs text-[hsl(var(--muted))]">Bank-matched batches</div><div className="mt-1 text-2xl font-semibold">{bankMatchedBatches}</div></div>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Import bank statement</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">CSV only in 1D. Common date, Debit/Credit and signed Amount headers are recognized. Rows before 01/08/2026 are ignored.</p>
        {canWrite ? (
          <form action="/api/payments/reconciliation/bank-matching" method="post" encType="multipart/form-data" className="mt-4 grid gap-4 lg:grid-cols-[0.6fr_1fr_1.4fr_auto] lg:items-end">
            <input type="hidden" name="action" value="import_statement" />
            <label className="text-sm font-medium">Bank<input name="bank_name" defaultValue="CIB" maxLength={80} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
            <label className="text-sm font-medium">Account label<input name="account_label" placeholder="ATOM business account" maxLength={120} className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
            <label className="text-sm font-medium">Statement CSV<input name="file" type="file" required accept=".csv,text/csv,application/csv,application/vnd.ms-excel,text/plain" className="mt-1 block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
            <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/85">Import</button>
          </form>
        ) : <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Read-only. Only Super Admin can import bank statements.</div>}
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">Recommended columns: <span className="font-semibold">Transaction Date, Value Date, Description, Reference, Debit, Credit</span>. Comma, semicolon and tab delimiters are accepted.</div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Bank credits</h2><p className="text-sm text-[hsl(var(--muted))]">One bank credit can have only one active match.</p></div>
          <div className="flex gap-2">
            {([['unmatched', 'Unmatched'], ['matched', 'Matched'], ['all', 'All']] as Array<[LineFilter, string]>).map(([value, label]) => (
              <Link key={value} prefetch={false} href={`/admin/payments/reconciliation/bank-matching?filter=${value}`} className={`rounded-xl border px-3 py-2 text-sm font-medium ${filter === value ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white hover:bg-black/[0.03]'}`}>{label}</Link>
            ))}
          </div>
        </div>

        {!visibleCredits.length ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-7 text-center text-sm text-[hsl(var(--muted))]">No bank credit matches this filter.</div> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleCredits.slice(0, 120).map((line) => {
              const activeMatch = activeMatchByLine.get(line.id) ?? null
              const matchedBatch = activeMatch ? batchById.get(activeMatch.batch_id) ?? null : null
              const statement = importById.get(line.import_id) ?? null
              const candidates = batches
                .map((batch) => {
                  const remaining = Math.round((batch.counted_amount - (matchedAmountByBatch.get(batch.id) ?? 0)) * 100) / 100
                  const amountDelta = Math.abs(remaining - line.credit_amount)
                  const dateDelta = dayDistance(batch.business_date, line.transaction_date)
                  return { batch, remaining, amountDelta, dateDelta, suggested: amountDelta < 0.01 && dateDelta <= 3 }
                })
                .filter((item) => item.dateDelta <= 7 && item.remaining > 0.009)
                .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.amountDelta - b.amountDelta || a.dateDelta - b.dateDelta)
                .slice(0, 10)

              return (
                <article key={line.id} className="rounded-3xl border border-black/10 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex gap-2"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Bank credit</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeMatch ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-800'}`}>{activeMatch ? 'Matched' : 'Unmatched'}</span></div><div className="mt-2 text-xl font-semibold">{formatEGP(line.credit_amount)}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">{formatDate(line.transaction_date)}{line.value_date ? ` · value ${formatDate(line.value_date)}` : ''}</div></div>
                    <div className="text-right text-xs text-[hsl(var(--muted))]">{statement?.bank_name || 'Bank'} · row {line.row_number}</div>
                  </div>
                  <div className="mt-3 rounded-2xl bg-black/[0.025] p-3 text-sm"><div><span className="text-[hsl(var(--muted))]">Description: </span>{line.description || '—'}</div><div className="mt-1"><span className="text-[hsl(var(--muted))]">Reference: </span>{line.reference || '—'}</div></div>

                  {activeMatch && matchedBatch ? <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"><div className="font-semibold">Matched to {methodLabel(matchedBatch.payment_method)} · {formatDate(matchedBatch.business_date)}</div><div className="mt-1 text-xs">Batch counted: {formatEGP(matchedBatch.counted_amount)} · this line: {formatEGP(activeMatch.matched_amount)}</div>{activeMatch.note ? <div className="mt-1 text-xs">Note: {activeMatch.note}</div> : null}</div> : null}

                  {!activeMatch && canWrite ? (
                    <form action="/api/payments/reconciliation/bank-matching" method="post" className="mt-4 space-y-3">
                      <input type="hidden" name="action" value="match_line" /><input type="hidden" name="line_id" value={line.id} />
                      <label className="block text-sm font-medium">Reconciliation batch<select name="batch_id" required defaultValue="" className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"><option value="" disabled>Select batch…</option>{candidates.map((candidate) => <option key={candidate.batch.id} value={candidate.batch.id}>{candidate.suggested ? 'Suggested · ' : ''}{methodLabel(candidate.batch.payment_method)} · {candidate.batch.business_date} · remaining {formatEGP(candidate.remaining)}</option>)}</select></label>
                      {!candidates.length ? <div className="text-xs text-amber-700">No candidate batch within ±7 days with a positive remaining amount.</div> : null}
                      <label className="block text-sm font-medium">Match note<input name="note" maxLength={500} placeholder="Optional bank matching note" className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" /></label>
                      <button type="submit" disabled={!candidates.length} className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40">Match bank credit</button>
                    </form>
                  ) : null}
                  {!canWrite ? <div className="mt-3 text-xs text-[hsl(var(--muted))]">Admin read-only.</div> : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold">Reconciliation batches · bank coverage</h2><p className="text-sm text-[hsl(var(--muted))]">Bank-matched amount is compared with the batch Counted amount, not Expected, so the original reconciliation result remains untouched.</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {batches.slice(0, 120).map((batch) => {
            const batchMatches = matchesByBatch.get(batch.id) ?? []
            const bankAmount = matchedAmountByBatch.get(batch.id) ?? 0
            const status = coverageStatus(batch.counted_amount, bankAmount)
            return (
              <article key={batch.id} className="rounded-3xl border border-black/10 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${methodClass(batch.payment_method)}`}>{methodLabel(batch.payment_method)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span></div><div className="mt-2 font-semibold">{formatDate(batch.business_date)}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Batch {batch.id.slice(0, 8)}</div></div>
                  <div className="text-right text-sm"><div><span className="text-[hsl(var(--muted))]">Counted </span><span className="font-semibold">{formatEGP(batch.counted_amount)}</span></div><div><span className="text-[hsl(var(--muted))]">Bank matched </span><span className="font-semibold">{formatEGP(bankAmount)}</span></div><div className="text-xs text-[hsl(var(--muted))]">Bank delta {formatEGP(status.delta)}</div></div>
                </div>
                {batchMatches.length ? <div className="mt-4 space-y-2">{batchMatches.map((match) => {
                  const line = lineById.get(match.statement_line_id)
                  return <div key={match.id} className="rounded-2xl border border-[hsl(var(--border))] bg-black/[0.015] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="text-sm"><div className="font-medium">{formatEGP(match.matched_amount)} · {formatDate(line?.transaction_date)}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">{line?.reference || line?.description || `Bank line ${match.statement_line_id.slice(0, 8)}`}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Matched {formatDateTime(match.matched_at)}</div></div>{canWrite ? <details className="min-w-[180px]"><summary className="cursor-pointer text-right text-xs font-semibold text-rose-700">Release match</summary><form action="/api/payments/reconciliation/bank-matching" method="post" className="mt-2 space-y-2"><input type="hidden" name="action" value="release_match" /><input type="hidden" name="match_id" value={match.id} /><input name="release_reason" minLength={3} maxLength={500} required placeholder="Reason required" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-xs" /><button type="submit" className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">Confirm release</button></form></details> : null}</div></div>
                })}</div> : <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted))]">No bank credit linked yet.</div>}
              </article>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold">Imported statements</h2><p className="text-sm text-[hsl(var(--muted))]">Original CSV files are stored privately and opened through short-lived signed URLs.</p></div>
        {!imports.length ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-6 text-center text-sm text-[hsl(var(--muted))]">No bank statement imported yet.</div> : (
          <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white"><table className="min-w-full text-sm"><thead className="bg-black/[0.025] text-left text-xs text-[hsl(var(--muted))]"><tr><th className="px-4 py-3">Statement</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Rows</th><th className="px-4 py-3">Credits</th><th className="px-4 py-3">Debits</th><th className="px-4 py-3">Imported</th><th className="px-4 py-3"></th></tr></thead><tbody>{imports.map((statement) => <tr key={statement.id} className="border-t border-black/10"><td className="px-4 py-3"><div className="font-medium">{statement.bank_name}{statement.account_label ? ` · ${statement.account_label}` : ''}</div><div className="max-w-[260px] truncate text-xs text-[hsl(var(--muted))]">{statement.original_filename} · {formatFileSize(statement.file_size_bytes)}</div></td><td className="px-4 py-3">{formatDate(statement.statement_from)} → {formatDate(statement.statement_to)}</td><td className="px-4 py-3">{statement.row_count}{statement.skipped_row_count ? ` + ${statement.skipped_row_count} skipped` : ''}</td><td className="px-4 py-3 font-medium">{formatEGP(statement.total_credit)}</td><td className="px-4 py-3">{formatEGP(statement.total_debit)}</td><td className="px-4 py-3 text-xs">{formatDateTime(statement.imported_at)}</td><td className="px-4 py-3 text-right"><a href={`/api/payments/reconciliation/bank-matching?statementId=${encodeURIComponent(statement.id)}`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">Open CSV</a></td></tr>)}</tbody></table></div>
        )}
      </section>

      {releasedMatches.length ? (
        <section className="space-y-3">
          <div><h2 className="text-lg font-semibold">Released match audit</h2><p className="text-sm text-[hsl(var(--muted))]">Released matches stay preserved and never disappear from the audit history.</p></div>
          <div className="grid gap-2 lg:grid-cols-2">{releasedMatches.slice(0, 30).map((match) => {
            const line = lineById.get(match.statement_line_id)
            const batch = batchById.get(match.batch_id)
            return <div key={match.id} className="rounded-2xl border border-black/10 bg-white p-3 text-sm"><div className="font-medium">{formatEGP(match.matched_amount)} · {batch ? methodLabel(batch.payment_method) : 'Batch'} · {formatDate(batch?.business_date)}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">Bank line: {line?.reference || line?.description || match.statement_line_id.slice(0, 8)}</div><div className="mt-1 text-xs text-rose-700">Released {formatDateTime(match.released_at)} · {match.release_reason || 'No reason recorded'}</div></div>
          })}</div>
        </section>
      ) : null}
    </main>
  )
}
