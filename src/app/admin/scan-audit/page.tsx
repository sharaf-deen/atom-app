export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { formatScanAuditMember, formatScanAuditScanner, getScanAuditData } from '@/lib/scanAudit'
import { canAccessScanAudit } from '@/lib/rbac'

type SearchParams = Record<string, string | string[] | undefined>

type ScanAuditRowView = {
  id: string
  scanned_at: string
  status: string
  valid: string
  device: string
  member: string
  scanned_by_role: string
  scanned_by: string
}

function spGet(sp: SearchParams, key: string): string {
  const v = sp[key]
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

function buildHref(base: string, current: SearchParams, patch: Record<string, string>) {
  const p = new URLSearchParams()
  for (const k of ['q', 'status', 'device', 'scanned_by_role', 'start', 'end', 'sort', 'page']) {
    const v = spGet(current, k)
    if (v) p.set(k, v)
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === '') p.delete(k)
    else p.set(k, v)
  }
  const s = p.toString()
  return s ? `${base}?${s}` : base
}

function buildCurrentViewLabel(params: {
  q: string
  status: string
  device: string
  scannedByRole: string
  start: string
  end: string
  sort: string
}) {
  const bits: string[] = []
  if (params.start || params.end) bits.push(`Period: ${params.start || '…'} → ${params.end || '…'}`)
  if (params.status) bits.push(`Status: ${params.status}`)
  if (params.scannedByRole) bits.push(`Role: ${params.scannedByRole}`)
  if (params.device) bits.push(`Device: ${params.device}`)
  if (params.q) bits.push(`Search: ${params.q}`)
  bits.push(`Sort: ${params.sort === 'recent' ? 'Most recent' : params.sort === 'device_asc' ? 'Device A → Z' : 'Device Z → A'}`)
  return bits.join(' · ')
}

const PER_PAGE = 50

export default async function ScanAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login')
  if (!canAccessScanAudit(me.role)) return <AccessDeniedCard />

  const q = spGet(searchParams, 'q').trim()
  const status = spGet(searchParams, 'status').trim()
  const device = spGet(searchParams, 'device').trim()
  const scannedByRole = spGet(searchParams, 'scanned_by_role').trim()
  const start = spGet(searchParams, 'start').trim()
  const end = spGet(searchParams, 'end').trim()
  const sort = spGet(searchParams, 'sort').trim() || 'recent'
  const page = Math.max(1, Number(spGet(searchParams, 'page') || '1') || 1)

  const supabase = getSupabaseAdminClientCached()

  let rows: ScanAuditRowView[] = []
  let total = 0
  let totalPages = 1
  let truncated = false
  let errorMessage = ''

  try {
    const data = await getScanAuditData(supabase, {
      q,
      status,
      device,
      scannedByRole,
      start,
      end,
      sort,
      page,
      perPage: PER_PAGE,
      maxFetch: 5000,
    })

    rows = data.rows.map((row) => ({
      id: row.id,
      scanned_at: row.scanned_at_cairo,
      status: row.status ?? '—',
      valid: row.valid ? 'Yes' : 'No',
      device: row.device_tag ?? '—',
      member: formatScanAuditMember(row),
      scanned_by_role: row.scanned_by_role ?? '—',
      scanned_by: formatScanAuditScanner(row),
    }))
    total = data.total
    totalPages = data.totalPages
    truncated = data.truncated
  } catch (error: any) {
    errorMessage = error?.message ?? 'Failed to load scan audit'
  }

  const hasPrev = page > 1
  const hasNext = page < totalPages
  const exportHref = buildHref('/api/admin/scan-audit/export', searchParams, { page: '' })
  const currentViewLabel = buildCurrentViewLabel({ q, status, device, scannedByRole, start, end, sort })

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-white text-black">
      <section className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scan Audit</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Kiosk scan history with staff and device context. Time shown in Egypt time.
            </p>
            {truncated ? (
              <p className="mt-1 text-xs text-amber-700">
                Showing the latest scan records only. Narrow the date range for a more complete audit.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Filters</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  Refine the audit, then review exactly this scan history.
                </p>
              </div>
              <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
                Egypt time
              </div>
            </div>

            <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" action="/admin/scan-audit" method="get">
              <label className="block xl:col-span-2">
                <span className="mb-1 block text-sm font-medium">Search</span>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                  name="q"
                  defaultValue={q}
                  placeholder="Member, staff or device"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Status</span>
                <select
                  name="status"
                  defaultValue={status}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                >
                  <option value="">All statuses</option>
                  <option value="ok">ok</option>
                  <option value="invalid">invalid</option>
                  <option value="expired">expired</option>
                  <option value="frozen">frozen</option>
                  <option value="error">error</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Scanner role</span>
                <select
                  name="scanned_by_role"
                  defaultValue={scannedByRole}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                >
                  <option value="">Any role</option>
                  <option value="reception">reception</option>
                  <option value="admin">admin</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Sort</span>
                <select
                  name="sort"
                  defaultValue={sort}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                >
                  <option value="recent">Most recent</option>
                  <option value="device_asc">Device A → Z</option>
                  <option value="device_desc">Device Z → A</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Device</span>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                  name="device"
                  defaultValue={device}
                  placeholder="Device tag"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Start date</span>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                  type="date"
                  name="start"
                  defaultValue={start}
                  title="Start date"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">End date</span>
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
                  type="date"
                  name="end"
                  defaultValue={end}
                  title="End date"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-3">
                <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  Apply filters
                </button>

                <Link
                  href="/admin/scan-audit"
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]"
                  title="Reset filters"
                >
                  Reset filters
                </Link>

                <div className="ml-auto rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
                  <span className="font-medium text-black">Current view:</span> {currentViewLabel}
                </div>
              </div>
            </form>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Export</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">Download exactly this audit view.</p>
            </div>

            <div className="mt-4 space-y-3">
              <a
                href={exportHref}
                className="inline-flex w-full items-center justify-center rounded-xl border bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                title="Download CSV"
              >
                Export CSV
              </a>
              <p className="text-xs text-[hsl(var(--muted))]">Uses current filters</p>
              {errorMessage ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
              ) : (
                <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm text-[hsl(var(--muted))]">
                  {total} scan{total === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white shadow-soft">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No results</div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 p-3 sm:hidden">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-soft"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="shrink-0 text-[11px] font-medium text-[hsl(var(--muted))]">Scanned at (EG)</div>
                        <div className="min-w-0 break-words text-right text-[13px] font-medium">{row.scanned_at}</div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <div className="shrink-0 text-[11px] font-medium text-[hsl(var(--muted))]">Status</div>
                        <div className="min-w-0 break-words text-right text-[13px] font-medium">{row.status}</div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <div className="shrink-0 text-[11px] font-medium text-[hsl(var(--muted))]">Device</div>
                        <div className="min-w-0 break-words text-right text-[13px] font-medium">{row.device}</div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <div className="shrink-0 text-[11px] font-medium text-[hsl(var(--muted))]">Member</div>
                        <div className="min-w-0 break-words text-right text-[13px] font-medium">{row.member}</div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <div className="shrink-0 text-[11px] font-medium text-[hsl(var(--muted))]">Scanned by</div>
                        <div className="min-w-0 break-words text-right text-[13px] font-medium">{row.scanned_by}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tablet / desktop table */}
              <div className="hidden sm:block">
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full text-left text-[13px] leading-5">
                    <thead>
                      <tr className="border-b border-[hsl(var(--border))] bg-white">
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Scanned at (EG)</th>
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Status</th>
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Valid</th>
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Device</th>
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Member</th>
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Scanner role</th>
                        <th className="px-3 py-3 font-semibold whitespace-nowrap">Scanned by</th>
                      </tr>
                    </thead>

                    <tbody>
                      {rows.map((row, index) => (
                        <tr
                          key={row.id}
                          className={index % 2 === 0 ? 'bg-white' : 'bg-[hsl(var(--bg))]'}
                        >
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top whitespace-nowrap">
                            {row.scanned_at}
                          </td>
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top whitespace-nowrap">
                            {row.status}
                          </td>
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top whitespace-nowrap">
                            {row.valid}
                          </td>
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top">
                            <div className="max-w-[220px] break-words">{row.device}</div>
                          </td>
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top">
                            <div className="min-w-[220px] break-words">{row.member}</div>
                          </td>
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top whitespace-nowrap">
                            {row.scanned_by_role}
                          </td>
                          <td className="border-t border-[hsl(var(--border))] px-3 py-3 align-top">
                            <div className="min-w-[220px] break-words">{row.scanned_by}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[hsl(var(--muted))]">
            Page {page} / {totalPages}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={buildHref('/admin/scan-audit', searchParams, { page: String(Math.max(1, page - 1)) })}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                (hasPrev ? 'hover:bg-black/[0.03]' : 'pointer-events-none opacity-50')
              }
            >
              Prev
            </Link>

            <Link
              href={buildHref('/admin/scan-audit', searchParams, { page: String(page + 1) })}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                (hasNext ? 'hover:bg-black/[0.03]' : 'pointer-events-none opacity-50')
              }
            >
              Next
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
