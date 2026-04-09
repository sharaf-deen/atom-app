// src/app/expenses/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import InlineAlert from '@/components/ui/InlineAlert'
import ExpensesTableClient, { type ExpenseRow } from '@/components/ExpensesTableClient'
import { canAccessExpenses } from '@/lib/rbac'
import ExpenseSubmitButton from '@/components/ExpenseSubmitButton'

type RangePreset = 'today' | '7d' | 'month' | 'custom'

const PER_PAGE = 50

function parsePositiveInt(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function toISODate(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(d: Date, days: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function parsePreset(v: unknown): RangePreset {
  return v === 'today' || v === '7d' || v === 'month' || v === 'custom' ? v : 'month'
}

function safeStr(v: unknown) {
  return typeof v === 'string' ? v : ''
}

function formatEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(safe)
}

function buildQS(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) sp.set(k, String(v))
  }
  return sp.toString()
}

function sanitizeSearch(v: string) {
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function paymentLabel(v?: string | null) {
  const s = (v || '').trim()
  if (!s) return '—'
  if (s === 'cash') return 'Cash'
  if (s === 'visa') return 'Visa card'
  if (s === 'instapay') return 'Instapay'
  if (s === 'bank_transfer') return 'Bank transfer'
  return s.replaceAll('_', ' ')
}

function categoryLabelByKey(categories: Array<{ key: string; label: string }>, key: string) {
  return categories.find((c) => c.key === key)?.label ?? key
}

async function addExpenseAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/expenses')
  if (!canAccessExpenses(me.role)) redirect('/expenses?error=Access%20denied')

  const return_qs = safeStr(formData.get('return_qs'))

  const category_key = safeStr(formData.get('category_key')).trim()
  const description = safeStr(formData.get('description')).trim()
  const dateRaw = safeStr(formData.get('date')).trim()
  const amountRaw = safeStr(formData.get('amount')).trim()
  const payment_method = safeStr(formData.get('payment_method')).trim()

  const receipt = formData.get('receipt')

  if (!category_key) {
    redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Please choose a category.')}`)
  }

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount)) {
    redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Invalid amount.')}`)
  }

  const today = toISODate(new Date())
  const date = dateRaw || today

  const admin = getSupabaseAdminClientCached()

  const allowedMethods = new Set(['cash', 'visa', 'instapay', 'bank_transfer'])
  if (!allowedMethods.has(payment_method)) {
    redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Please choose a payment method.')}`)
  }

  let receipt_path: string | null = null
  let receipt_mime: string | null = null
  let receipt_filename: string | null = null

  if (receipt && typeof (receipt as any)?.arrayBuffer === 'function') {
    const file = receipt as File
    if (file.size > 0) {
      const max = 8 * 1024 * 1024
      if (file.size > max) {
        redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Receipt file is too large (max 8MB).')}`)
      }

      const mime = (file.type || '').toLowerCase()
      const ok = mime.startsWith('image/') || mime === 'application/pdf'
      if (!ok) {
        redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Receipt must be an image (JPG/PNG/WEBP) or PDF.')}`)
      }

      const originalName = (file.name || 'receipt').replace(/[^a-zA-Z0-9._-]+/g, '_')
      const uuid = (globalThis as any)?.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      const path = `expenses/${date}/${uuid}-${originalName}`

      const ab = await file.arrayBuffer()
      const up = await admin.storage.from('expense-receipts').upload(path, ab, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      })

      if (up.error) {
        redirect(`/expenses?${return_qs}&error=${encodeURIComponent(up.error.message || 'Receipt upload failed.')}`)
      }

      receipt_path = path
      receipt_mime = mime || null
      receipt_filename = file.name || null
    }
  }

  const { data: inserted, error } = await admin
    .from('expenses')
    .insert([
      {
        date,
        category_key,
        description: description || null,
        amount,
        payment_method,
        receipt_path,
        receipt_mime,
        receipt_filename,
      },
    ])
    .select('id')
    .single<{ id: string }>()

  if (error) {
    redirect(`/expenses?${return_qs}&error=${encodeURIComponent(error.message || 'Save failed.')}`)
  }

  const sp = new URLSearchParams(return_qs)
  sp.set('saved', '1')
  sp.set('page', '1')
  if (inserted?.id) sp.set('focus_id', inserted.id)
  redirect(`/expenses?${sp.toString()}`)
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const user = await getSessionUserCached()
  if (!user) redirect('/login?next=/expenses')

  if (!canAccessExpenses(user.role)) {
    return (
      <AccessDeniedPage
        title="Expenses"
        subtitle="Access restricted."
        signedInAs={user.email}
        message="Only Admin / Super Admin can access expenses."
        allowed="admin, super_admin"
        nextPath="/expenses"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  const now = new Date()
  const today = toISODate(now)
  const thisMonthFrom = toISODate(startOfMonth(now))
  const thisMonthTo = toISODate(endOfMonth(now))
  const preset = parsePreset(typeof searchParams.preset === 'string' ? searchParams.preset : 'month')

  let from = safeStr(searchParams.from)
  let to = safeStr(searchParams.to)

  if (preset === 'today') {
    from = today
    to = today
  } else if (preset === '7d') {
    to = today
    from = toISODate(addDays(now, -6))
  } else if (preset === 'month') {
    from = thisMonthFrom
    to = thisMonthTo
  } else {
    if (!from) from = thisMonthFrom
    if (!to) to = thisMonthTo
  }

  const category = typeof searchParams.category === 'string' ? searchParams.category : 'all'
  const paymentFilter = typeof searchParams.payment_method === 'string' ? searchParams.payment_method : 'all'
  const qTextRaw = typeof searchParams.q === 'string' ? searchParams.q : ''
  const qText = sanitizeSearch(qTextRaw)

  const page = parsePositiveInt(searchParams.page, 1)
  const offset = (page - 1) * PER_PAGE

  const saved = typeof searchParams.saved === 'string' ? searchParams.saved : ''
  const updated = typeof searchParams.updated === 'string' ? searchParams.updated : ''
  const deleted = typeof searchParams.deleted === 'string' ? searchParams.deleted : ''
  const errorMsg = typeof searchParams.error === 'string' ? searchParams.error : ''
  const focusId = typeof searchParams.focus_id === 'string' ? searchParams.focus_id : ''

  const admin = getSupabaseAdminClientCached()

  const { data: cats, error: catsError } = await admin
    .from('expense_categories')
    .select('key,label,group_name,sort_order,is_active')
    .eq('is_active', true)
    .order('group_name', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  const categories = (cats || []) as Array<{
    key: string
    label: string
    group_name: string
    sort_order: number
    is_active: boolean
  }>

  const labelByKeyObj = Object.fromEntries(categories.map((c) => [c.key, c.label]))

  let query = admin
    .from('expenses')
    .select('id,date,category_key,description,amount,payment_method,receipt_path,receipt_mime,receipt_filename', { count: 'exact' })
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('id', { ascending: false })

  if (category && category !== 'all') query = query.eq('category_key', category)
  if (paymentFilter && paymentFilter !== 'all') query = query.eq('payment_method', paymentFilter)
  if (qText) {
    const like = `%${qText}%`
    query = query.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
  }

  const { data: rows, error: rowsError, count } = await query.range(offset, offset + PER_PAGE - 1)

  let summaryQuery = admin
    .from('expenses')
    .select('id,amount,payment_method')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .limit(100000)

  if (category && category !== 'all') summaryQuery = summaryQuery.eq('category_key', category)
  if (paymentFilter && paymentFilter !== 'all') summaryQuery = summaryQuery.eq('payment_method', paymentFilter)
  if (qText) {
    const like = `%${qText}%`
    summaryQuery = summaryQuery.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
  }

  const { data: summaryRows } = await summaryQuery

  const expenses = (rows || []) as ExpenseRow[]
  const pageTotal = expenses.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0)
  const filteredRows = (summaryRows || []) as Array<{ id: string; amount: number; payment_method?: string | null }>
  const filteredTotal = filteredRows.reduce((sum, r) => sum + (Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0), 0)
  const filteredCount = filteredRows.length
  const averageAmount = filteredCount > 0 ? filteredTotal / filteredCount : 0

  const totalsByMethod = {
    cash: 0,
    visa: 0,
    instapay: 0,
    bank_transfer: 0,
  }

  for (const row of filteredRows) {
    const method = String(row.payment_method || 'cash')
    const amt = Number(row.amount || 0)
    if (!Number.isFinite(amt)) continue
    if (method === 'visa') totalsByMethod.visa += amt
    else if (method === 'instapay') totalsByMethod.instapay += amt
    else if (method === 'bank_transfer') totalsByMethod.bank_transfer += amt
    else totalsByMethod.cash += amt
  }

  const totalCount = typeof count === 'number' ? count : undefined
  const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / PER_PAGE)) : undefined
  const hasPrev = page > 1
  const hasNext = totalPages ? page < totalPages : expenses.length === PER_PAGE
  const showPagination = totalPages ? totalPages > 1 : hasPrev || hasNext

  const filterReturnQS = buildQS({ preset, from, to, category, payment_method: paymentFilter, q: qTextRaw })
  const exportQS = buildQS({ from, to, category, payment_method: paymentFilter, q: qTextRaw })
  const basePageQS = { preset, from, to, category, payment_method: paymentFilter, q: qTextRaw }
  const prevHref = hasPrev ? `/expenses?${buildQS({ ...basePageQS, page: String(page - 1) })}` : ''
  const nextHref = hasNext ? `/expenses?${buildQS({ ...basePageQS, page: String(page + 1) })}` : ''

  const activeFilters = [
    `Range: ${from} → ${to}`,
    preset !== 'custom' ? `Preset: ${preset === '7d' ? 'Last 7 days' : preset === 'month' ? 'This month' : 'Today'}` : '',
    category !== 'all' ? `Category: ${categoryLabelByKey(categories, category)}` : '',
    paymentFilter !== 'all' ? `Payment: ${paymentLabel(paymentFilter)}` : '',
    qTextRaw.trim() ? `Search: ${qTextRaw.trim()}` : '',
  ].filter(Boolean)

  const quickLinks = {
    today: `/expenses?${buildQS({ preset: 'today', from: today, to: today, category, payment_method: paymentFilter, q: qTextRaw })}`,
    seven: `/expenses?${buildQS({ preset: '7d', from: toISODate(addDays(now, -6)), to: today, category, payment_method: paymentFilter, q: qTextRaw })}`,
    month: `/expenses?${buildQS({ preset: 'month', from: thisMonthFrom, to: thisMonthTo, category, payment_method: paymentFilter, q: qTextRaw })}`,
    custom: `/expenses?${buildQS({ preset: 'custom', from, to, category, payment_method: paymentFilter, q: qTextRaw })}`,
  }

  const hasCustomFilters = preset !== 'month' || category !== 'all' || paymentFilter !== 'all' || !!qTextRaw.trim()

  return (
    <main className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Atom Expenses</h1>
        <p className="text-sm text-[hsl(var(--muted))]">Mobile-first expense tracking with faster filters, clearer actions, and exports aligned with the current view.</p>
      </div>

      {errorMsg ? (
        <InlineAlert variant="error" title="Error">
          {errorMsg}
        </InlineAlert>
      ) : null}

      {catsError ? (
        <InlineAlert variant="warning" title="Categories">
          {catsError.message || 'Failed to load categories.'}
        </InlineAlert>
      ) : null}

      {rowsError ? (
        <InlineAlert variant="warning" title="Expenses">
          {rowsError.message || 'Failed to load expenses.'}
        </InlineAlert>
      ) : null}

      {saved ? (
        <InlineAlert variant="success" title="Saved">
          Expense added. Showing first page and scrolling to the new entry below.
        </InlineAlert>
      ) : null}

      {updated ? (
        <InlineAlert variant="success" title="Updated">
          Expense updated successfully.
        </InlineAlert>
      ) : null}

      {deleted ? (
        <InlineAlert variant="success" title="Deleted">
          Expense deleted successfully.
        </InlineAlert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Refine the view, then export exactly this selection.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <a href={quickLinks.today} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">Today</a>
            <a href={quickLinks.seven} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">Last 7 days</a>
            <a href={quickLinks.month} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">This month</a>
            <a href={quickLinks.custom} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">Custom</a>
            <a href="/expenses" className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">Reset filters</a>
          </div>

          <form method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Preset</span>
              <select
                name="preset"
                defaultValue={preset}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="month">This month</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">From</span>
              <input type="date" name="from" defaultValue={from} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">To</span>
              <input type="date" name="to" defaultValue={to} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select
                name="category"
                defaultValue={category}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.group_name} · {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Payment</span>
              <select
                name="payment_method"
                defaultValue={paymentFilter}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="visa">Visa card</option>
                <option value="instapay">Instapay</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>

            <label className="block sm:col-span-2 xl:col-span-1">
              <span className="mb-1 block text-sm font-medium">Search</span>
              <input
                name="q"
                defaultValue={qTextRaw}
                placeholder="description / category / payment"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <div className="sm:col-span-2 xl:col-span-6 flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" className="inline-flex items-center justify-center rounded-2xl shadow-soft bg-black text-white px-4 py-2 text-sm font-medium hover:opacity-95">
                Apply filters
              </button>
              <a href={`/api/expenses/export?${exportQS}`} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Export CSV
              </a>
              <a href={`/api/expenses/export-pdf?${exportQS}`} className="inline-flex items-center justify-center rounded-2xl shadow-soft border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Export PDF
              </a>
              <span className="text-xs text-[hsl(var(--muted))]">Uses current filters</span>
            </div>
          </form>

          {activeFilters.length ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Current view</div>
              <div className="flex flex-wrap gap-2">
              {activeFilters.map((label) => (
                <span key={label} className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">
                  {label}
                </span>
              ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Filtered total</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(filteredTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Filtered expenses</div>
            <div className="mt-1 text-xl font-semibold">{filteredCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Average amount</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(averageAmount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-[hsl(var(--muted))]">Current page total</div>
            <div className="mt-1 text-xl font-semibold">{formatEGP(pageTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Totals by payment method</CardTitle>
          <div className="text-xs text-[hsl(var(--muted))]">Based on the full current filtered result, not only the visible page.</div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(['cash', 'visa', 'instapay', 'bank_transfer'] as const).map((method) => (
              <div key={method} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
                <div className="text-xs text-[hsl(var(--muted))]">{paymentLabel(method)}</div>
                <div className="mt-1 text-lg font-semibold">{formatEGP(totalsByMethod[method])}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expenses</CardTitle>
          <div className="text-xs text-[hsl(var(--muted))]">
            Showing {totalCount ? `${Math.min(offset + 1, totalCount)}–${Math.min(offset + expenses.length, totalCount)} of ${totalCount}` : `${expenses.length}`} item{expenses.length === 1 ? '' : 's'}
          </div>
        </CardHeader>

        <CardContent>
          {expenses.length > 0 ? (
            <ExpensesTableClient expenses={expenses} labelByKey={labelByKeyObj} returnQueryString={filterReturnQS} focusExpenseId={focusId} />
          ) : (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-6 text-center">
              <div className="text-base font-medium">No expenses found for the current filters.</div>
              <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                Try a broader date range, remove one filter, or reset all filters.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {hasCustomFilters ? (
                  <a
                    href="/expenses"
                    className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80"
                  >
                    Reset filters
                  </a>
                ) : null}
                <a
                  href={quickLinks.month}
                  className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80"
                >
                  This month
                </a>
              </div>
            </div>
          )}

          {showPagination ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <a
                href={hasPrev ? prevHref : '#'}
                aria-disabled={!hasPrev}
                className={`inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium border shadow-soft ${
                  hasPrev
                    ? 'bg-white text-black border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80'
                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed pointer-events-none'
                }`}
              >
                Prev
              </a>

              <div className="text-xs text-[hsl(var(--muted))]">
                Page <span className="font-medium text-[hsl(var(--fg))]">{page}</span>
                {totalPages ? (
                  <>
                    {' '}
                    / <span className="font-medium text-[hsl(var(--fg))]">{totalPages}</span>
                  </>
                ) : null}
              </div>

              <a
                href={hasNext ? nextHref : '#'}
                aria-disabled={!hasNext}
                className={`inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium border shadow-soft ${
                  hasNext
                    ? 'bg-white text-black border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80'
                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed pointer-events-none'
                }`}
              >
                Next
              </a>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add expense</CardTitle>
          <div className="text-xs text-[hsl(var(--muted))]">Admin / Super Admin</div>
        </CardHeader>
        <CardContent>
          <form action={addExpenseAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="return_qs" value={filterReturnQS} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Date</span>
              <input type="date" name="date" defaultValue="" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Leave empty for today.</span>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select
                name="category_key"
                defaultValue=""
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                <option value="" disabled>
                  Choose…
                </option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.group_name} · {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Amount (EGP)</span>
              <input type="number" step="0.01" name="amount" min="0" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" required />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Payment method</span>
              <select
                name="payment_method"
                defaultValue="cash"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                <option value="cash">Cash</option>
                <option value="visa">Visa card</option>
                <option value="instapay">Instapay</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Description</span>
              <input name="description" placeholder="Optional note…" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Receipt (optional)</span>
              <input
                type="file"
                name="receipt"
                accept="image/*,application/pdf"
                className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-white"
              />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Accepted: JPG, PNG, WEBP, PDF. Max 8MB.</span>
            </label>

            <div className="sm:col-span-4">
              <ExpenseSubmitButton />
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
