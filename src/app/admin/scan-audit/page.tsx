export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { Table } from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = Record<string, string | string[] | undefined>

function spGet(sp: SearchParams, key: string): string {
  const v = sp[key]
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

function qs(sp: URLSearchParams, key: string, value: string) {
  if (!value) sp.delete(key)
  else sp.set(key, value)
}

function buildHref(base: string, current: SearchParams, patch: Record<string, string>) {
  const p = new URLSearchParams()
  // keep known keys
  for (const k of ['q','status','device','scanned_by_role','start','end','sort','page']) {
    const v = spGet(current, k)
    if (v) p.set(k, v)
  }
  for (const [k,v] of Object.entries(patch)) {
    if (v === '') p.delete(k)
    else p.set(k, v)
  }
  const s = p.toString()
  return s ? `${base}?${s}` : base
}

function fmtName(first?: string | null, last?: string | null) {
  return [first ?? '', last ?? ''].join(' ').trim()
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

const PER_PAGE = 50

export default async function ScanAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login')
  if (me.role !== 'admin' && me.role !== 'super_admin') return <AccessDeniedCard />

  const q = spGet(searchParams, 'q').trim()
  const status = spGet(searchParams, 'status').trim()
  const device = spGet(searchParams, 'device').trim()
  const scannedByRole = spGet(searchParams, 'scanned_by_role').trim()
  const start = spGet(searchParams, 'start').trim()
  const end = spGet(searchParams, 'end').trim()
  const sort = spGet(searchParams, 'sort').trim() || 'recent'
  const page = Math.max(1, Number(spGet(searchParams, 'page') || '1') || 1)

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const supabase = getSupabaseAdminClientCached()

  let qb = supabase
    .from('scan_audit')
    .select(
      'id,date,scanned_at,status,valid,device_tag,member_id,member_code,member_email,member_first_name,member_last_name,scanned_by,scanned_by_role,scanned_by_email,scanned_by_first_name,scanned_by_last_name',
      { count: 'exact' }
    )

  if (start) qb = qb.gte('date', start)
  if (end) qb = qb.lte('date', end)
  if (status) qb = qb.eq('status', status)
  if (device) qb = qb.eq('device_tag', device)
  if (scannedByRole) qb = qb.eq('scanned_by_role', scannedByRole)

  if (q) {
    const like = `%${q}%`
    qb = qb.or(
      [
        `member_code.ilike.${like}`,
        `member_email.ilike.${like}`,
        `member_first_name.ilike.${like}`,
        `member_last_name.ilike.${like}`,
        `scanned_by_email.ilike.${like}`,
        `scanned_by_first_name.ilike.${like}`,
        `scanned_by_last_name.ilike.${like}`,
        `device_tag.ilike.${like}`,
      ].join(',')
    )
  }

  // Sorting
  if (sort === 'device_asc') qb = qb.order('device_tag', { ascending: true }).order('scanned_at', { ascending: false })
  else if (sort === 'device_desc') qb = qb.order('device_tag', { ascending: false }).order('scanned_at', { ascending: false })
  else qb = qb.order('scanned_at', { ascending: false })

  const { data, count, error } = await qb.range(from, to)

  const rows = (data ?? []).map((r) => {
    const memberName = fmtName(r.member_first_name, r.member_last_name) || r.member_email || r.member_code || r.member_id
    const scannerName = fmtName(r.scanned_by_first_name, r.scanned_by_last_name) || r.scanned_by_email || (r.scanned_by ?? '—')
    return {
      id: r.id,
      scanned_at: fmtDateTime(r.scanned_at),
      status: r.status,
      device: r.device_tag ?? '—',
      member: memberName,
      scanned_by: scannerName,
      scanned_by_role: r.scanned_by_role ?? '—',
      valid: r.valid ? 'Yes' : 'No',
    }
  })

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const hasPrev = page > 1
  const hasNext = page < totalPages

  const exportHref = buildHref('/api/admin/scan-audit/export', searchParams, { page: '' })

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-white text-black">
      <section className="mx-auto max-w-6xl px-4 py-8 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scan Audit</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Kiosk scan history (attendance) with staff + device context.</p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={exportHref}
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
              title="Download CSV"
            >
              Export CSV
            </a>
          </div>
        </div>

        {/* Filters */}
        <form className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:grid-cols-2 lg:grid-cols-6" action="/admin/scan-audit" method="get">
          <input
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50 lg:col-span-2"
            name="q"
            defaultValue={q}
            placeholder="Search member / staff / device…"
          />

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

          <select
            name="scanned_by_role"
            defaultValue={scannedByRole}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
          >
            <option value="">Scanned by (any)</option>
            <option value="reception">reception</option>
            <option value="admin">admin</option>
            <option value="super_admin">super_admin</option>
          </select>

          <select
            name="sort"
            defaultValue={sort}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
          >
            <option value="recent">Most recent</option>
            <option value="device_asc">Device A → Z</option>
            <option value="device_desc">Device Z → A</option>
          </select>

          <input
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
            name="device"
            defaultValue={device}
            placeholder="Device tag"
          />

          <input
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
            type="date"
            name="start"
            defaultValue={start}
            title="Start date"
          />

          <input
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
            type="date"
            name="end"
            defaultValue={end}
            title="End date"
          />

          <div className="flex items-center gap-2 lg:col-span-6">
            <button
              type="submit"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Apply
            </button>

            <Link
              href="/admin/scan-audit"
              className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]"
              title="Reset filters"
            >
              Reset
            </Link>

            {error ? (
              <span className="text-sm text-red-700 ml-auto">{error.message}</span>
            ) : (
              <span className="text-sm text-[hsl(var(--muted))] ml-auto">
                {total} scan{total === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </form>

        {/* Table */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white shadow-soft">
          <Table
            keyField="id"
            rows={rows}
            columns={[
              { key: 'scanned_at', header: 'Scanned at' },
              { key: 'status', header: 'Status' },
              { key: 'valid', header: 'Valid', hideOnMobile: true },
              { key: 'device', header: 'Device' },
              { key: 'member', header: 'Member' },
              { key: 'scanned_by_role', header: 'Scanner role', hideOnMobile: true },
              { key: 'scanned_by', header: 'Scanned by' },
            ]}
          />
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[hsl(var(--muted))]">
            Page {page} / {totalPages}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={buildHref('/admin/scan-audit', searchParams, { page: String(Math.max(1, page - 1)) })}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                (hasPrev ? 'hover:bg-black/[0.03]' : 'opacity-50 pointer-events-none')
              }
            >
              Prev
            </Link>

            <Link
              href={buildHref('/admin/scan-audit', searchParams, { page: String(page + 1) })}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                (hasNext ? 'hover:bg-black/[0.03]' : 'opacity-50 pointer-events-none')
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
