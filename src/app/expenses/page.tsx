// src/app/expenses/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUserCached } from '@/lib/requestCache'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import InlineAlert from '@/components/ui/InlineAlert'
import ExpensesTableClient, { type ExpenseRow } from '@/components/ExpensesTableClient'

type RangePreset = 'today' | '7d' | 'month' | 'custom'

const PER_PAGE = 50

function parsePositiveInt(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

function toISODate(d: Date) {
  // YYYY-MM-DD in local time (not UTC) to match typical date columns
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

function normalizeReturnQSForSave(returnQS: string) {
  const sp = new URLSearchParams(returnQS || '')
  sp.delete('page')
  return sp.toString()
}

function sanitizeSearch(v: string) {
  // Keep it simple & safe for Supabase .or() syntax
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function addExpenseAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/expenses')
  if (!isAdmin(me.role)) redirect('/expenses?error=Access%20denied')

  const return_qs = normalizeReturnQSForSave(safeStr(formData.get('return_qs')))

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

  // Validate payment method
  const allowedMethods = new Set(['cash', 'visa', 'instapay', 'bank_transfer'])
  if (!allowedMethods.has(payment_method)) {
    redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Please choose a payment method.')}`)
  }

  // Optional receipt upload
  let receipt_path: string | null = null
  let receipt_mime: string | null = null
  let receipt_filename: string | null = null

  if (receipt && typeof (receipt as any)?.arrayBuffer === 'function') {
    const file = receipt as File
    if (file.size > 0) {
      const max = 8 * 1024 * 1024 // 8MB
      if (file.size > max) {
        redirect(`/expenses?${return_qs}&error=${encodeURIComponent('Receipt file is too large (max 8MB).')}`)
      }

      const mime = (file.type || '').toLowerCase()
      const ok = mime.startsWith('image/') || mime === 'application/pdf'
      if (!ok) {
        redirect(
          `/expenses?${return_qs}&error=${encodeURIComponent('Receipt must be an image (JPG/PNG/WEBP) or PDF.')}`
        )
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

  const { error } = await admin.from('expenses').insert([
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

  if (error) {
    redirect(`/expenses?${return_qs}&error=${encodeURIComponent(error.message || 'Save failed.')}`)
  }

  redirect(`/expenses?${return_qs}&saved=1`)
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const user = await getSessionUserCached()
  if (!user) redirect('/login?next=/expenses')

  if (!isAdmin(user.role)) {
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
  const preset = parsePreset(typeof searchParams.preset === 'string' ? searchParams.preset : 'month')

  // Compute range
  let from = safeStr(searchParams.from)
  let to = safeStr(searchParams.to)

  if (preset === 'today') {
    from = toISODate(now)
    to = from
  } else if (preset === '7d') {
    to = toISODate(now)
    from = toISODate(addDays(now, -6))
  } else if (preset === 'month') {
    from = toISODate(startOfMonth(now))
    to = toISODate(endOfMonth(now))
  } else {
    // custom: fallback to current month if empty/invalid-ish
    if (!from) from = toISODate(startOfMonth(now))
    if (!to) to = toISODate(endOfMonth(now))
  }

  const category = typeof searchParams.category === 'string' ? searchParams.category : 'all'
  const paymentFilter = typeof searchParams.payment_method === 'string' ? searchParams.payment_method : 'all'
  const qTextRaw = typeof searchParams.q === 'string' ? searchParams.q : ''
  const qText = sanitizeSearch(qTextRaw)

  const page = parsePositiveInt(searchParams.page, 1)
  const offset = (page - 1) * PER_PAGE

  const saved = typeof searchParams.saved === 'string' ? searchParams.saved : ''
  const errorMsg = typeof searchParams.error === 'string' ? searchParams.error : ''

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

  const labelByKey = new Map<string, string>()
  categories.forEach((c) => labelByKey.set(c.key, c.label))
  const labelByKeyObj = Object.fromEntries(labelByKey.entries())

  let query = admin
    .from('expenses')
    .select('id,date,category_key,description,amount,payment_method,receipt_path,receipt_mime,receipt_filename', { count: 'exact' })
    .order('date', { ascending: false })

  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)
  if (category && category !== 'all') query = query.eq('category_key', category)
  if (paymentFilter && paymentFilter !== 'all') query = query.eq('payment_method', paymentFilter)

  // Server-side text search (fast, no client filtering)
  if (qText) {
    const like = `%${qText}%`
    query = query.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
  }

const { data: rows, error: rowsError, count } = await query
  .range(offset, offset + PER_PAGE - 1)

const expenses = (rows || []) as ExpenseRow[]
const pageTotal = expenses.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0)

const totalCount = typeof count === 'number' ? count : undefined
const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / PER_PAGE)) : undefined
const hasPrev = page > 1
const hasNext = totalPages ? page < totalPages : expenses.length === PER_PAGE

const returnQS = buildQS({ preset, from, to, category, payment_method: paymentFilter, q: qTextRaw, page: String(page) })
const exportQS = buildQS({ from, to, category, payment_method: paymentFilter, q: qTextRaw })
const basePageQS = { preset, from, to, category, payment_method: paymentFilter, q: qTextRaw }
const prevHref = hasPrev ? `/expenses?${buildQS({ ...basePageQS, page: String(page - 1) })}` : ''
const nextHref = hasNext ? `/expenses?${buildQS({ ...basePageQS, page: String(page + 1) })}` : ''

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-center">Atom Expenses</h1>

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
          Expense added. Showing first page.
        </InlineAlert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">
            Page total: <span className="font-medium text-[hsl(var(--fg))]">{formatEGP(pageTotal)}</span>
          </div>
        </CardHeader>

        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Preset</span>
              <select
                name="preset"
                defaultValue={preset}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="month">This month</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">From</span>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">To</span>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select
                name="category"
                defaultValue={category}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
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
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="visa">Visa card</option>
                <option value="instapay">Instapay</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Search</span>
              <input
                name="q"
                defaultValue={qTextRaw}
                placeholder="description, category key, payment…"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
              <span className="mt-1 block text-[11px] text-[hsl(var(--muted))]">Server-side filter (fast).</span>
            </label>

            <div className="sm:col-span-6 flex flex-wrap items-center gap-2 pt-2">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-black text-white hover:opacity-95 px-4 py-2 text-sm"
              >
                Apply
              </button>

              <a
                href="/expenses"
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80 px-4 py-2 text-sm"
              >
                Reset
              </a>

              <a
                href={`/api/expenses/export?${exportQS}`}
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80 px-4 py-2 text-sm"
              >
                Export CSV
              </a>



              <a
                href={`/api/expenses/export-pdf?${exportQS}`}
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80 px-4 py-2 text-sm"
              >
                Export PDF
              </a>
              <span className="text-xs text-[hsl(var(--muted))]">Tip: choose “Custom” if you want manual dates.</span>
            </div>
          </form>
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
          <ExpensesTableClient expenses={expenses} labelByKey={labelByKeyObj} />

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

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add expense</CardTitle>
          <div className="text-xs text-[hsl(var(--muted))]">Admin / Super Admin</div>
        </CardHeader>
        <CardContent>
          <form action={addExpenseAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="return_qs" value={returnQS} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Date</span>
              <input
                type="date"
                name="date"
                defaultValue=""
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Leave empty for today.</span>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select
                name="category_key"
                defaultValue=""
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
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
              <input
                name="amount"
                inputMode="decimal"
                placeholder="e.g. 250"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Payment method</span>
              <select
                name="payment_method"
                defaultValue="cash"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
                required
              >
                <option value="cash">Cash</option>
                <option value="visa">Visa card</option>
                <option value="instapay">Instapay</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>

            <label className="block sm:col-span-4">
              <span className="mb-1 block text-sm font-medium">Description</span>
              <input
                name="description"
                placeholder="Optional…"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
            </label>

            <label className="block sm:col-span-4">
              <span className="mb-1 block text-sm font-medium">Receipt (optional)</span>
              <input
                type="file"
                name="receipt"
                accept="image/*,application/pdf"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Max 8MB. JPG/PNG/WEBP or PDF.</span>
            </label>

            <div className="sm:col-span-4 flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-black text-white hover:opacity-95 px-4 py-2 text-sm"
              >
                Save
              </button>
              <span className="text-xs text-[hsl(var(--muted))]">After saving, you’ll return to the first page of the current filtered view.</span>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
