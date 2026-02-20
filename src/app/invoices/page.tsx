// src/app/invoices/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent } from '@/components/ui/Card'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { type Role } from '@/lib/session'

type InvoiceRow = {
  id: string
  invoice_number: string | null
  member_user_id: string
  amount: number | null
  currency: string | null
  paid_at: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  member_code: string | null
  total_count: number | null
}

const searchInvoicesCached = unstable_cache(
  async (q: string, from_date: string | null, to_date: string | null, page: number, page_size: number) => {
    const supa = getSupabaseAdminClientCached()
    const { data, error } = await supa.rpc('search_invoices', { q, from_date, to_date, page, page_size } as any)
    if (error) throw new Error(error.message)
    return (data ?? []) as InvoiceRow[]
  },
  ['search_invoices_v2'],
  { revalidate: 60, tags: ['invoices'] }
)


const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = Number(Array.isArray(v) ? v[0] : v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function displayName(row: InvoiceRow) {
  const n = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
  return n || row.email || '—'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  const nextPath = '/invoices'
  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  const isStaff = STAFF.includes(me.role)
  if (!isStaff) {
    return (
      <AccessDeniedPage
        title="Invoices"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can view invoices."
        allowed="reception, admin, super_admin"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, DEFAULT_PAGE_SIZE, 10, MAX_PAGE_SIZE)
  const q = strParam(searchParams?.q).trim()
  const from = strParam(searchParams?.from).trim() // YYYY-MM-DD
  const to = strParam(searchParams?.to).trim() // YYYY-MM-DD

  // RPC expects from_date/to_date (date). Passing '' will fail casts, so pass null.
  const from_date = from || null
  const to_date = to || null

  let rows: InvoiceRow[] = []
  let errorMsg: string | null = null
  try {
    rows = await searchInvoicesCached(q, from_date, to_date, page, pageSize)
} catch (e: any) {
    errorMsg = e?.message || String(e)
  }

  const total = rows.length ? Number(rows[0].total_count ?? 0) : 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const baseParams = { q, from, to, page_size: String(pageSize) }

  return (
    <main>
      <PageHeader title="Invoices" subtitle="Download receipts (PDF)" showReload={false} />

      <Section className="space-y-4">
        {/* Filters (server-first via GET) */}
        <Card>
          <CardContent>
            <form action="/invoices" method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[hsl(var(--muted))]">Search (invoice #, name, email, member code, or UUID)</label>
                <input
                  name="q"
                  defaultValue={q}
                  className="rounded-xl border px-3 py-2 text-sm bg-white"
                  placeholder="e.g. INV-123, Nazim, ATOM-000123, email, or UUID"
                />
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
                  {[20, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <button className="rounded-xl px-4 py-2 text-sm font-medium border hover:bg-gray-50" type="submit">
                Apply
              </button>

              <Link prefetch={false} href="/invoices" className="text-sm underline text-gray-700 hover:text-black">
                Clear
              </Link>

              <div className="ml-auto text-xs text-[hsl(var(--muted))]">
                {!errorMsg && total > 0 ? (
                  <>
                    Showing <b>{(page - 1) * pageSize + 1}</b>–<b>{Math.min((page - 1) * pageSize + rows.length, total)}</b> of <b>{total}</b>
                  </>
                ) : (
                  <>No invoices.</>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Table */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-3">
          {errorMsg ? (
            <div className="text-sm text-red-600">Failed to load invoices: {errorMsg}</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">No invoices yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[hsl(var(--muted))]">
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="text-left px-3 py-2">Invoice</th>
                    <th className="text-left px-3 py-2">Member</th>
                    <th className="text-left px-3 py-2">Paid at</th>
                    <th className="text-left px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[hsl(var(--border))]">
                      <td className="px-3 py-2">
                        <code className="text-xs">{row.invoice_number ?? '—'}</code>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span>{displayName(row)}</span>
                          {row.member_code ? <span className="text-xs text-[hsl(var(--muted))]">{row.member_code}</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">{fmtDate(row.paid_at)}</td>
                      <td className="px-3 py-2">
                        {row.amount ?? 0} {row.currency ?? 'EGP'}
                      </td>
                      <td className="px-3 py-2">
                        <a className="text-sm underline hover:opacity-80" href={`/api/invoices/${row.id}/download`}>
                          Download PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!errorMsg && total > 0 && totalPages > 1 && (
            <div className="flex items-center gap-2 pt-2">
              <Link
                prefetch={false}
                href={buildUrl('/invoices', { ...baseParams, page: String(Math.max(1, page - 1)) })}
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
                href={buildUrl('/invoices', { ...baseParams, page: String(Math.min(totalPages, page + 1)) })}
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
