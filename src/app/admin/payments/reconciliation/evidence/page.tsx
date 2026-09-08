export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { canAccessPayments } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type Method = 'cash' | 'instapay' | 'card' | 'bank_transfer'
type EvidenceFilter = 'all' | 'with_evidence' | 'missing'

type BatchRow = {
  id: string
  payment_method: Method
  validation_mode: 'cash_period' | 'daily'
  business_date: string | null
  period_from: string
  period_to: string
  expected_amount: number
  counted_amount: number
  difference_amount: number
  note: string | null
  validated_at: string
  validated_by: string | null
  validator: {
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

type EvidenceRow = {
  id: string
  batch_id: string
  reference: string | null
  proof_path: string | null
  original_filename: string | null
  mime_type: string | null
  file_size_bytes: number | null
  created_at: string
  created_by: string | null
  creator: {
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

const METHODS: Array<Method | 'all'> = [
  'all',
  'cash',
  'instapay',
  'card',
  'bank_transfer',
]

function sp1(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const value = sp[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

function safeMethod(value: string | null): Method | 'all' {
  return METHODS.includes(value as any) ? (value as Method | 'all') : 'all'
}

function safeEvidenceFilter(value: string | null): EvidenceFilter {
  return value === 'with_evidence' || value === 'missing' ? value : 'all'
}

function safeFlash(value: string | null) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function labelMethod(method: Method | 'all') {
  if (method === 'all') return 'All methods'
  if (method === 'cash') return 'Cash'
  if (method === 'instapay') return 'Instapay'
  if (method === 'card') return 'Card'
  return 'Bank transfer'
}

function methodClass(method: Method) {
  if (method === 'cash') return 'bg-emerald-50 text-emerald-700'
  if (method === 'instapay') return 'bg-sky-50 text-sky-700'
  if (method === 'card') return 'bg-violet-50 text-violet-700'
  return 'bg-amber-50 text-amber-800'
}

function formatEGP(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
    }).format(Number(value ?? 0))
  } catch {
    return `${Number(value ?? 0).toFixed(2)} EGP`
  }
}

function formatCairoDateTime(value?: string | null) {
  if (!value) return '—'
  const dt = new Date(value)
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

function formatDateOnly(value?: string | null) {
  if (!value) return '—'
  const dt = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return value

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)
}

function formatCairoDateFromTimestamp(value?: string | null) {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)
}

function batchScope(batch: BatchRow) {
  if (batch.validation_mode === 'daily') {
    return formatDateOnly(batch.business_date)
  }

  const from = formatCairoDateFromTimestamp(batch.period_from)
  const to = formatCairoDateFromTimestamp(batch.period_to)
  return from === to ? from : `${from} → ${to}`
}

function personLabel(person?: {
  email: string | null
  first_name: string | null
  last_name: string | null
} | null) {
  const name = `${person?.first_name ?? ''} ${person?.last_name ?? ''}`.trim()
  return name || person?.email || '—'
}

function formatFileSize(bytes?: number | null) {
  const value = Number(bytes ?? 0)
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function buildHref(method: Method | 'all', evidence: EvidenceFilter) {
  const params = new URLSearchParams()
  if (method !== 'all') params.set('method', method)
  if (evidence !== 'all') params.set('evidence', evidence)
  const qs = params.toString()
  return `/admin/payments/reconciliation/evidence${qs ? `?${qs}` : ''}`
}

function flashMessage(code: string) {
  if (!code) return ''
  if (code === 'SUPER_ADMIN_REQUIRED') return 'Only Super Admin can add reconciliation evidence.'
  if (code === 'INVALID_BATCH') return 'Invalid reconciliation batch.'
  if (code === 'BATCH_NOT_AVAILABLE') return 'This reconciliation batch is no longer available.'
  if (code === 'REFERENCE_OR_FILE_REQUIRED') return 'Add a reference, a proof file, or both.'
  if (code === 'FILE_TOO_LARGE') return 'Proof file is too large. Maximum size is 10 MB.'
  if (code === 'UNSUPPORTED_FILE_TYPE') return 'Allowed proof files: JPG, PNG, WEBP, or PDF.'
  if (code === 'MIGRATION_REQUIRED') return 'The reconciliation proof storage bucket is not available yet. Apply the 1C migration first.'
  if (code === 'UPLOAD_FAILED') return 'The proof file could not be uploaded.'
  if (code === 'EVIDENCE_SAVE_FAILED') return 'The evidence record could not be saved.'
  if (code === 'SERVICE_ROLE_MISSING') return 'Server storage configuration is missing.'
  if (code === 'PROFILE_LOOKUP_FAILED') return 'Your staff profile could not be verified.'
  if (code === 'BATCH_LOOKUP_FAILED') return 'The reconciliation batch could not be verified.'
  if (code === 'SERVER_ERROR') return 'Unexpected server error while saving evidence.'
  return code.replace(/_/g, ' ')
}

export default async function ReconciliationEvidencePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) {
    redirect('/login?next=/admin/payments/reconciliation/evidence')
  }

  if (!canAccessPayments(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Reconciliation · Evidence / Proof</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access reconciliation evidence."
            nextPath="/admin/payments/reconciliation/evidence"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const methodFilter = safeMethod(sp1(searchParams, 'method'))
  const evidenceFilter = safeEvidenceFilter(sp1(searchParams, 'evidence'))
  const saved = sp1(searchParams, 'saved') === '1'
  const flashBatch = safeFlash(sp1(searchParams, 'batch'))
  const errorCode = safeFlash(sp1(searchParams, 'error'))

  const canWrite = me.role === 'super_admin'
  const admin = getSupabaseAdminClientCached()

  let batchQuery = admin
    .from('payment_validation_batches')
    .select(
      'id, payment_method, validation_mode, business_date, period_from, period_to, expected_amount, counted_amount, difference_amount, note, validated_at, validated_by, validator:profiles!payment_validation_batches_validated_by_fkey(email,first_name,last_name)'
    )
    .is('deleted_at', null)
    .order('validated_at', { ascending: false })
    .limit(200)

  if (methodFilter !== 'all') {
    batchQuery = batchQuery.eq('payment_method', methodFilter)
  }

  const { data: batchesRaw, error: batchesErr } = await batchQuery

  const batches: BatchRow[] = ((batchesRaw ?? []) as any[]).map((row) => ({
    id: String(row.id),
    payment_method: row.payment_method as Method,
    validation_mode: row.validation_mode === 'cash_period' ? 'cash_period' : 'daily',
    business_date: row.business_date ?? null,
    period_from: String(row.period_from),
    period_to: String(row.period_to),
    expected_amount: Number(row.expected_amount ?? 0),
    counted_amount: Number(row.counted_amount ?? 0),
    difference_amount: Number(row.difference_amount ?? 0),
    note: row.note ?? null,
    validated_at: String(row.validated_at),
    validated_by: row.validated_by ? String(row.validated_by) : null,
    validator: (row.validator ?? null) as BatchRow['validator'],
  }))

  const batchIds = batches.map((row) => row.id)
  const { data: evidenceRaw, error: evidenceErr } = batchIds.length
    ? await admin
        .from('payment_validation_batch_evidence')
        .select(
          'id, batch_id, reference, proof_path, original_filename, mime_type, file_size_bytes, created_at, created_by, creator:profiles!payment_validation_batch_evidence_created_by_fkey(email,first_name,last_name)'
        )
        .in('batch_id', batchIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null as any }

  const evidenceRows: EvidenceRow[] = ((evidenceRaw ?? []) as any[]).map((row) => ({
    id: String(row.id),
    batch_id: String(row.batch_id),
    reference: row.reference ?? null,
    proof_path: row.proof_path ?? null,
    original_filename: row.original_filename ?? null,
    mime_type: row.mime_type ?? null,
    file_size_bytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    created_at: String(row.created_at),
    created_by: row.created_by ? String(row.created_by) : null,
    creator: (row.creator ?? null) as EvidenceRow['creator'],
  }))

  const evidenceByBatch = new Map<string, EvidenceRow[]>()
  for (const evidence of evidenceRows) {
    const list = evidenceByBatch.get(evidence.batch_id) ?? []
    list.push(evidence)
    evidenceByBatch.set(evidence.batch_id, list)
  }

  const visibleBatches = batches.filter((batch) => {
    const count = evidenceByBatch.get(batch.id)?.length ?? 0
    if (evidenceFilter === 'with_evidence') return count > 0
    if (evidenceFilter === 'missing') return count === 0
    return true
  })

  const withEvidenceCount = batches.filter(
    (batch) => (evidenceByBatch.get(batch.id)?.length ?? 0) > 0
  ).length
  const missingCount = batches.length - withEvidenceCount
  const proofCount = evidenceRows.filter((row) => Boolean(row.proof_path)).length

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Reconciliation 1C
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  canWrite
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {canWrite ? 'Super Admin · can add evidence' : 'Admin · read-only'}
              </span>
            </div>

            <h1 className="text-2xl font-semibold sm:text-3xl">
              Evidence / Proof
            </h1>
            <p className="text-sm text-[hsl(var(--muted))] sm:text-base">
              Attach immutable references and supporting files to existing
              reconciliation batches. Evidence does not change payments, batch
              amounts, differences, or reconciliation status.
            </p>
          </div>

          <Link
            prefetch={false}
            href="/admin/payments/reconciliation"
            className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            ← Back to Reconciliation
          </Link>
        </div>
      </section>

      {saved ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Evidence saved{flashBatch ? ` for batch ${flashBatch}` : ''}. The
          record is append-only and remains part of the reconciliation audit trail.
        </div>
      ) : null}

      {errorCode ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {flashMessage(errorCode)}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Batches loaded</div>
          <div className="mt-1 text-2xl font-semibold">{batches.length}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="text-xs text-[hsl(var(--muted))]">With evidence</div>
          <div className="mt-1 text-2xl font-semibold">{withEvidenceCount}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Without evidence</div>
          <div className="mt-1 text-2xl font-semibold">{missingCount}</div>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Proof files</div>
          <div className="mt-1 text-2xl font-semibold">{proofCount}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="space-y-3">
          <div>
            <h2 className="font-semibold">Filters</h2>
            <p className="text-xs text-[hsl(var(--muted))]">
              Showing up to the 200 most recent active reconciliation batches.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {METHODS.map((method) => (
              <Link
                key={method}
                prefetch={false}
                href={buildHref(method, evidenceFilter)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                  methodFilter === method
                    ? 'border-black bg-black text-white'
                    : 'border-[hsl(var(--border))] bg-white hover:bg-black/[0.03]'
                }`}
              >
                {labelMethod(method)}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'All evidence states'],
                ['with_evidence', 'With evidence'],
                ['missing', 'Without evidence'],
              ] as Array<[EvidenceFilter, string]>
            ).map(([value, label]) => (
              <Link
                key={value}
                prefetch={false}
                href={buildHref(methodFilter, value)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                  evidenceFilter === value
                    ? 'border-black bg-black text-white'
                    : 'border-[hsl(var(--border))] bg-white hover:bg-black/[0.03]'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {batchesErr || evidenceErr ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not load reconciliation evidence. Confirm the 1C migration has
          been applied, then refresh.
        </div>
      ) : null}

      <section className="space-y-4">
        {!visibleBatches.length ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-8 text-center text-sm text-[hsl(var(--muted))]">
            No reconciliation batch matches the current filters.
          </div>
        ) : null}

        {visibleBatches.map((batch) => {
          const evidence = evidenceByBatch.get(batch.id) ?? []
          const difference = batch.difference_amount
          const status =
            difference === 0 ? 'Matched' : difference > 0 ? 'Over' : 'Short'

          return (
            <article
              key={batch.id}
              className="overflow-hidden rounded-3xl border border-black/10 bg-white"
            >
              <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.35fr_0.9fr_0.9fr]">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${methodClass(
                        batch.payment_method
                      )}`}
                    >
                      {labelMethod(batch.payment_method)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        difference === 0
                          ? 'bg-emerald-50 text-emerald-700'
                          : difference > 0
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {evidence.length} evidence item{evidence.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div>
                    <div className="text-lg font-semibold">
                      {batch.validation_mode === 'cash_period'
                        ? 'Cash closure'
                        : 'Daily reconciliation'}
                    </div>
                    <div className="text-sm text-[hsl(var(--muted))]">
                      Scope: {batchScope(batch)}
                    </div>
                  </div>

                  <div className="text-xs text-[hsl(var(--muted))]">
                    Batch {batch.id.slice(0, 8)} · validated{' '}
                    {formatCairoDateTime(batch.validated_at)} by{' '}
                    {personLabel(batch.validator)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-[hsl(var(--muted))]">Expected</div>
                    <div className="font-semibold">{formatEGP(batch.expected_amount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[hsl(var(--muted))]">Counted</div>
                    <div className="font-semibold">{formatEGP(batch.counted_amount)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-[hsl(var(--muted))]">Difference</div>
                    <div className="font-semibold">{formatEGP(batch.difference_amount)}</div>
                  </div>
                </div>

                <div className="text-sm">
                  <div className="text-xs text-[hsl(var(--muted))]">Batch note</div>
                  <div className="mt-1 whitespace-pre-wrap">{batch.note || '—'}</div>
                </div>
              </div>

              <div className="border-t border-black/10 bg-black/[0.015] p-4 sm:p-5">
                <div className="space-y-3">
                  <div className="font-semibold">Evidence trail</div>

                  {!evidence.length ? (
                    <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm text-[hsl(var(--muted))]">
                      No supporting evidence attached yet.
                    </div>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {evidence.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-[hsl(var(--muted))]">
                                Added {formatCairoDateTime(item.created_at)} ·{' '}
                                {personLabel(item.creator)}
                              </div>

                              <div className="mt-2 text-sm">
                                <span className="text-[hsl(var(--muted))]">Reference: </span>
                                <span className="font-medium">
                                  {item.reference || '—'}
                                </span>
                              </div>

                              {item.proof_path ? (
                                <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                                  {item.original_filename || 'Proof file'}
                                  {item.file_size_bytes
                                    ? ` · ${formatFileSize(item.file_size_bytes)}`
                                    : ''}
                                </div>
                              ) : null}
                            </div>

                            {item.proof_path ? (
                              <a
                                href={`/api/payments/reconciliation/evidence?evidenceId=${encodeURIComponent(
                                  item.id
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex shrink-0 items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
                              >
                                View proof
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {canWrite ? (
                    <details className="rounded-2xl border border-[hsl(var(--border))] bg-white">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                        + Add evidence
                      </summary>

                      <form
                        action="/api/payments/reconciliation/evidence"
                        method="post"
                        encType="multipart/form-data"
                        className="space-y-4 border-t border-[hsl(var(--border))] p-4"
                      >
                        <input type="hidden" name="batch_id" value={batch.id} />

                        <div>
                          <label
                            htmlFor={`reference-${batch.id}`}
                            className="mb-1 block text-sm font-medium"
                          >
                            Reference
                          </label>
                          <input
                            id={`reference-${batch.id}`}
                            name="reference"
                            maxLength={250}
                            placeholder="CIB settlement ID, bank transfer reference, cash count reference…"
                            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor={`file-${batch.id}`}
                            className="mb-1 block text-sm font-medium"
                          >
                            Proof file
                          </label>
                          <input
                            id={`file-${batch.id}`}
                            name="file"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                          />
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            Optional if a reference is entered. JPG, PNG, WEBP or PDF · max 10 MB.
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-xs text-[hsl(var(--muted))]">
                            Evidence is append-only. Existing evidence is never replaced.
                          </div>
                          <button
                            type="submit"
                            className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/85"
                          >
                            Save evidence
                          </button>
                        </div>
                      </form>
                    </details>
                  ) : (
                    <div className="text-xs text-[hsl(var(--muted))]">
                      Read-only: only Super Admin can add reconciliation evidence.
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
