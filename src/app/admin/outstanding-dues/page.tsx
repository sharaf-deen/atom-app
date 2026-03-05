// src/app/admin/outstanding-dues/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Forbidden from '@/components/Forbidden'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { Table } from '@/components/ui/Table'

import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import type { OutstandingDueRow } from './types'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
const OPS: Role[] = ['admin', 'super_admin']

type SubRow = {
  id: string
  member_id: string | null
  plan: string | null
  status: string | null
  paid_at: string | null
  amount: number | null
  amount_due: number | null
  payment_method: string | null
  profiles?: {
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    member_id: string | null
  } | null
}

type PaymentMethod = 'all' | 'cash' | 'instapay' | 'card' | 'bank_transfer' | 'other'

type SortKey = 'due_desc' | 'due_asc' | 'paid_at_desc' | 'paid_at_asc' | 'name_asc'

const PER_PAGE = 50

function clampInt(v: unknown, def: number, min: number, max: number) {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function strParam(v: unknown) {
  const raw = Array.isArray(v) ? v[0] : v
  return typeof raw === 'string' ? raw : ''
}

function isSort(v: string): v is SortKey {
  return v === 'due_desc' || v === 'due_asc' || v === 'paid_at_desc' || v === 'paid_at_asc' || v === 'name_asc'
}

function isMethod(v: string): v is PaymentMethod {
  return v === 'all' || v === 'cash' || v === 'instapay' || v === 'card' || v === 'bank_transfer' || v === 'other'
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    sp.set(k, v)
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

function fmtMoneyEGP(v: any) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0'
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
  } catch {
    return `${n.toFixed(0)} EGP`
  }
}

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const dt = new Date(v)
  if (isNaN(dt.getTime())) return v
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function normMethod(v?: string | null) {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'cash' || s === 'instapay' || s === 'card' || s === 'bank_transfer') return s as Exclude<PaymentMethod, 'all' | 'other'>
  return 'other'
}

function humanMethod(v?: string | null) {
  const m = normMethod(v)
  switch (m) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'InstaPay'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return v || '—'
  }
}

export default async function AdminOutstandingDuesPage({
  searchParams,
}: {
  searchParams?: { q?: string; method?: string; minDue?: string; sort?: string; page?: string }
}) {
  const me = await getSessionUserCached()
  const nextPath = '/admin/outstanding-dues'
  if (!me) redirect('/login?next=/admin/outstanding-dues')

  const allowed = OPS.includes(me.role as Role)
  if (!allowed) {
    return (
      <Forbidden
        pageTitle="Outstanding Dues"
        subtitle="Admins only."
        nextPath={nextPath}
        allowed="admin, super_admin"
        signedInAs={me.email}
        actions={[{ href: '/admin', label: 'Admin' }]}
      />
    )
  }

  // Params
  const q = strParam(searchParams?.q).trim()
  const methodRaw = strParam(searchParams?.method).trim()
  const method: PaymentMethod = isMethod(methodRaw) ? methodRaw : 'all'
  const minDueRaw = strParam(searchParams?.minDue).trim()
  const minDue = Number(minDueRaw || 0)
  const sortRaw = strParam(searchParams?.sort).trim()
  const sort: SortKey = isSort(sortRaw) ? sortRaw : 'due_desc'
  const page = clampInt(searchParams?.page, 1, 1, 9999)

  const hasPrev = page > 1
  let hasNext = false
  let loadError: string | null = null

  // Fetch strategy:
  // - Normal case: server-side paging (PER_PAGE + 1) and DB sort
  // - If q is present OR method=other OR sort=name_asc: fetch (capped) and paginate in-memory
  const needsFullFetch = !!q || method === 'other' || sort === 'name_asc'

  let rows: OutstandingDueRow[] = []
  let shownCount = 0
  let shownMembers = 0
  let shownDue = 0

  try {
    const admin = getSupabaseAdminClientCached()

    let query = admin
      .from('subscriptions')
      .select(
        'id, member_id, plan, status, paid_at, amount, amount_due, payment_method, profiles:member_id(first_name,last_name,email,phone,member_id)',
      )
      .gt('amount_due', 0)
      .not('member_id', 'is', null)

    // Push-down filters
    if (Number.isFinite(minDue) && minDue > 0) {
      query = query.gte('amount_due', minDue)
    }
    if (method !== 'all' && method !== 'other') {
      // Case-insensitive match (pattern without wildcards is fine)
      query = query.ilike('payment_method', method)
    }

    // Sorting (DB when possible)
    if (!needsFullFetch) {
      if (sort === 'due_asc') query = query.order('amount_due', { ascending: true })
      else if (sort === 'paid_at_desc') query = query.order('paid_at', { ascending: false })
      else if (sort === 'paid_at_asc') query = query.order('paid_at', { ascending: true })
      else query = query.order('amount_due', { ascending: false })
    }

    // Limits
    if (needsFullFetch) {
      query = query.limit(5000)
    } else {
      const from = (page - 1) * PER_PAGE
      const to = from + PER_PAGE // inclusive => PER_PAGE + 1 rows
      query = query.range(from, to)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    let fetched = ((data ?? []) as unknown as SubRow[]) ?? []

    // In-memory method filter for "other"
    if (method === 'other') {
      fetched = fetched.filter((s) => normMethod(s.payment_method) === 'other')
    }

    // In-memory search (q)
    if (q) {
      const qq = q.toLowerCase()
      fetched = fetched.filter((s) => {
        const p = s.profiles
        const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim().toLowerCase()
        const email = String(p?.email ?? '').toLowerCase()
        const phone = String(p?.phone ?? '').toLowerCase()
        const memberCode = String(p?.member_id ?? '').toLowerCase()
        return (
          name.includes(qq) ||
          email.includes(qq) ||
          phone.includes(qq) ||
          memberCode.includes(qq) ||
          String(s.member_id ?? '').toLowerCase().includes(qq)
        )
      })
    }

    // In-memory sort when needed (q/method other/name_asc)
    if (needsFullFetch) {
      const byDate = (v?: string | null) => {
        const t = v ? new Date(v).getTime() : 0
        return Number.isFinite(t) ? t : 0
      }

      fetched.sort((a, b) => {
        const nameA = `${a.profiles?.first_name ?? ''} ${a.profiles?.last_name ?? ''}`.trim()
        const nameB = `${b.profiles?.first_name ?? ''} ${b.profiles?.last_name ?? ''}`.trim()

        const dueA = Number(a.amount_due ?? 0)
        const dueB = Number(b.amount_due ?? 0)

        switch (sort) {
          case 'due_asc':
            return dueA - dueB
          case 'paid_at_desc':
            return byDate(b.paid_at) - byDate(a.paid_at)
          case 'paid_at_asc':
            return byDate(a.paid_at) - byDate(b.paid_at)
          case 'name_asc':
            return nameA.localeCompare(nameB)
          case 'due_desc':
          default:
            return dueB - dueA
        }
      })

      const start = (page - 1) * PER_PAGE
      const end = start + PER_PAGE
      hasNext = end < fetched.length
      fetched = fetched.slice(start, end)
    } else {
      hasNext = fetched.length > PER_PAGE
      fetched = fetched.slice(0, PER_PAGE)
    }

    rows = fetched
      .filter((s) => !!s.member_id)
      .map((s) => {
        const uid = s.member_id as string
        const p = s.profiles
        const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || '—'
        const paid = Number(s.amount ?? 0)
        const due = Number(s.amount_due ?? 0)
        return {
          subscription_id: s.id,
          user_id: uid,
          member_code: p?.member_id ?? null,
          name,
          email: p?.email ?? null,
          phone: p?.phone ?? null,
          plan: s.plan ?? null,
          status: s.status ?? null,
          paid_at: s.paid_at ?? null,
          paid,
          due,
          total: paid + due,
          payment_method: s.payment_method ?? null,
        }
      })

    shownCount = rows.length
    shownMembers = new Set(rows.map((r) => r.user_id)).size
    shownDue = rows.reduce((acc, r) => acc + Number(r.due || 0), 0)
  } catch (e: any) {
    loadError = e?.message ?? String(e)
  }

  const baseQS = {
    q: q || undefined,
    method: method !== 'all' ? method : undefined,
    minDue: minDueRaw || undefined,
    sort: sort !== 'due_desc' ? sort : undefined,
  }

  const prevHref = nextPath + buildQS({ ...baseQS, page: hasPrev ? String(page - 1) : undefined })
  const nextHref = nextPath + buildQS({ ...baseQS, page: hasNext ? String(page + 1) : undefined })

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2">
      <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-xl hover:bg-gray-50">
        ← Admin
      </Link>
      <Link prefetch={false} href="/members" className="border px-4 py-2 rounded-xl hover:bg-gray-50">
        Members
      </Link>
    </div>
  )

  const columns = [
    { key: 'member', header: 'Member' },
    { key: 'contact', header: 'Contact', hideOnMobile: true },
    { key: 'plan', header: 'Plan' },
    { key: 'paid', header: 'Paid' },
    { key: 'due', header: 'Due' },
    { key: 'total', header: 'Total', hideOnMobile: true },
    { key: 'payment', header: 'Payment', hideOnMobile: true },
    { key: 'paid_at', header: 'Paid at', hideOnMobile: true },
    { key: 'open', header: 'Profile' },
  ]

  const tableRows = rows.map((r) => {
    const memberLabel = `${r.name}${r.member_code ? ` · ${r.member_code}` : ''}`
    const contact = [r.email ?? '', r.phone ?? ''].filter(Boolean).join(' · ') || '—'
    return {
      key: r.subscription_id,
      member: memberLabel,
      contact,
      plan: `${r.plan ?? '—'}${r.status ? ` · ${r.status}` : ''}`,
      paid: fmtMoneyEGP(r.paid),
      due: fmtMoneyEGP(r.due),
      total: fmtMoneyEGP(r.total),
      payment: humanMethod(r.payment_method),
      paid_at: fmtDate(r.paid_at),
      open: (
        <Link prefetch={false} className="underline" href={`/members/${r.user_id}`}>
          Open
        </Link>
      ),
    }
  })

  return (
    <main>
      <PageHeader title="Outstanding Dues" subtitle={`Signed in as ${me.email || 'unknown'} · Page ${page}`} right={headerRight} />

      <Section className="space-y-4">
        {loadError ? (
          <InlineAlert variant="error" title="Failed to load">
            {loadError}
          </InlineAlert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="text-sm text-[hsl(var(--muted))]">Members (shown)</div>
            <div className="mt-1 text-2xl font-semibold">{shownMembers}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="text-sm text-[hsl(var(--muted))]">Total due (shown)</div>
            <div className="mt-1 text-2xl font-semibold">{fmtMoneyEGP(shownDue)}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="text-sm text-[hsl(var(--muted))]">Rows (shown)</div>
            <div className="mt-1 text-2xl font-semibold">{shownCount}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <form action={nextPath} method="GET" className="grid gap-3 sm:grid-cols-12 items-end">
            <div className="sm:col-span-4">
              <Input name="q" defaultValue={q} label="Search" placeholder="Name / email / phone / member id" />
            </div>
            <div className="sm:col-span-3">
              <Select name="method" defaultValue={method} label="Payment">
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="instapay">InstaPay</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Input name="minDue" defaultValue={minDueRaw} label="Min due" placeholder="0" inputMode="decimal" />
            </div>
            <div className="sm:col-span-3">
              <Select name="sort" defaultValue={sort} label="Sort">
                <option value="due_desc">Due (high → low)</option>
                <option value="due_asc">Due (low → high)</option>
                <option value="paid_at_desc">Paid at (newest)</option>
                <option value="paid_at_asc">Paid at (oldest)</option>
                <option value="name_asc">Name (A → Z)</option>
              </Select>
            </div>

            <div className="sm:col-span-12 flex flex-wrap items-center gap-2">
              <Button type="submit">Apply</Button>
              <Link
                href={nextPath}
                className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Reset
              </Link>

              <div className="ml-auto flex items-center gap-2">
                <Link
                  aria-disabled={!hasPrev}
                  className={`inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium ${
                    hasPrev ? 'bg-white hover:bg-gray-50' : 'bg-gray-100 text-gray-400 pointer-events-none'
                  }`}
                  href={prevHref}
                >
                  ← Prev
                </Link>
                <Link
                  aria-disabled={!hasNext}
                  className={`inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium ${
                    hasNext ? 'bg-white hover:bg-gray-50' : 'bg-gray-100 text-gray-400 pointer-events-none'
                  }`}
                  href={nextHref}
                >
                  Next →
                </Link>
              </div>
            </div>
          </form>
        </div>

        <Table columns={columns as any} rows={tableRows as any} keyField="key" />
      </Section>
    </main>
  )
}
