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
import {
  buildQS,
  expensePaymentLabel,
  expensePresetLabel,
  parseExpenseFilters,
  safeStr,
  toISODate,
} from '@/lib/expenseFilters'

const PER_PAGE = 50

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

function formatEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(safe)
}

async function addExpenseAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/expenses')
  if (!isAdmin(me.role)) redirect('/expenses?error=Access%20denied')

  const category_key = safeStr(formData.get('category_key')).trim()
  const description = safeStr(formData.get('description')).trim()
  const dateRaw = safeStr(formData.get('date')).trim()
  const amountRaw = safeStr(formData.get('amount')).trim()
  const payment_method = safeStr(formData.get('payment_method')).trim()
  const preset = safeStr(formData.get('preset')).trim() || 'month'
  const from = safeStr(formData.get('from')).trim()
  const to = safeStr(formData.get('to')).trim()
  const category = safeStr(formData.get('category')).trim() || 'all'
  const paymentFilter = safeStr(formData.get('payment_method_filter')).trim() || 'all'
  const q = safeStr(formData.get('q')).trim()

  if (!category_key) {
    redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, saved: '', error: 'Please choose a category.' })}`)
  }

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount)) {
    redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, saved: '', error: 'Invalid amount.' })}`)
  }

  const today = toISODate(new Date())
  const date = dateRaw || today

  const admin = getSupabaseAdminClientCached()
  const allowedMethods = new Set(['cash', 'visa', 'instapay', 'bank_transfer'])
  if (!allowedMethods.has(payment_method)) {
    redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, saved: '', error: 'Please choose a payment method.' })}`)
  }

  const receipt = formData.get('receipt')
  let receipt_path: string | null = null
  let receipt_mime: string | null = null
  let receipt_filename: string | null = null

  if (receipt && typeof (receipt as any)?.arrayBuffer === 'function') {
    const file = receipt as File
    if (file.size > 0) {
      const max = 8 * 1024 * 1024
      if (file.size > max) {
        redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, error: 'Receipt file is too large (max 8MB).' })}`)
      }

      const mime = (file.type || '').toLowerCase()
      const ok = mime.startsWith('image/') || mime === 'application/pdf'
      if (!ok) {
        redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, error: 'Receipt must be an image (JPG/PNG/WEBP) or PDF.' })}`)
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
        redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, error: up.error.message || 'Receipt upload failed.' })}`)
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
    redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, error: error.message || 'Save failed.' })}`)
  }

  redirect(`/expenses?${buildQS({ preset, from, to, category, payment_method: paymentFilter, q, saved: '1' })}`)
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
  const filters = parseExpenseFilters(searchParams, now)
  const { preset, from, to, category, payment_method: paymentFilter, qRaw, qText, page } = filters
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

  const expenses = (rows || []) as ExpenseRow[]
  const pageTotal = expenses.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0)

  const totalCount = typeof count === 'number' ? count : undefined
  const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / PER_PAGE)) : undefined
  const hasPrev = page > 1
  const hasNext = totalPages ? page < totalPages : expenses.length === PER_PAGE

  const exportQS = buildQS({ preset, from, to, category, payment_method: paymentFilter, q: qRaw })
  const basePageQS = { preset, from, to, category, payment_method: paymentFilter, q: qRaw }
  const prevHref = hasPrev ? `/expenses?${buildQS({ ...basePageQS, page: String(page - 1) })}` : ''
  const nextHref = hasNext ? `/expenses?${buildQS({ ...basePageQS, page: String(page + 1) })}` : ''
  const activeCategoryLabel = category !== 'all' ? labelByKey.get(category) ?? category : 'All categories'

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Atom Expenses</h1>
        <p className="text-sm text-[hsl(var(--muted))]">
          {expensePresetLabel(preset)} · {from} → {to}
        </p>
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
          Expense added. Showing first page for the current filtered view.
        </InlineAlert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters & export</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">
            Current page total: <span className="font-medium text-[hsl(var(--fg))]">{formatEGP(pageTotal)}</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <a href="/expenses?preset=today" className="inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80">Today</a>
            <a href="/expenses?preset=7d" className="inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80">Last 7 days</a>
            <a href="/expenses?preset=month" className="inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80">This month</a>
            <a href="/expenses?preset=custom&from=${from}&to=${to}" className="inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80">Custom</a>
            <a href="/expenses" className="inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm shadow-soft hover:bg-[hsl(var(--bg))]/80">Reset all</a>
          </div>

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
                <option value="all">All categories</option>
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
                <option value="all">All payments</option>
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
                defaultValue={qRaw}
                placeholder="description, category key, payment…"
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
              <span className="mt-1 block text-[11px] text-[hsl(var(--muted))]">Use category or payment filters first, then search inside the result.</span>
            </label>

            <div className="sm:col-span-6 flex flex-wrap items-center gap-2 pt-2">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-black text-white hover:opacity-95 px-4 py-2 text-sm"
              >
                Apply filters
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
                Export current CSV
              </a>

              <a
                href={`/api/expenses/export-pdf?${exportQS}`}
                className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80 px-4 py-2 text-sm"
              >
                Export current PDF
              </a>
            </div>
          </form>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border px-3 py-1">Preset: {expensePresetLabel(preset)}</span>
            <span className="rounded-full border px-3 py-1">Range: {from} → {to}</span>
            <span className="rounded-full border px-3 py-1">Category: {activeCategoryLabel}</span>
            <span className="rounded-full border px-3 py-1">Payment: {expensePaymentLabel(paymentFilter)}</span>
            {qRaw ? <span className="rounded-full border px-3 py-1">Search: {qRaw}</span> : null}
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
            <input type="hidden" name="preset" value={preset} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <input type="hidden" name="category" value={category} />
            <input type="hidden" name="payment_method_filter" value={paymentFilter} />
            <input type="hidden" name="q" value={qRaw} />
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
              <span className="mb-1 block text-sm font-medium">Receipt (image or PDF)</span>
              <input
                type="file"
                name="receipt"
                accept="image/*,application/pdf"
                className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-white"
              />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Optional. Max 8MB.</span>
            </label>

            <div className="sm:col-span-4 flex justify-end">
              <button className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] bg-black text-white hover:opacity-95 px-4 py-2 text-sm">
                Save expense
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
