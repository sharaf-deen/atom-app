export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import InlineAlert from '@/components/ui/InlineAlert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import ExpenseSubmitButton from '@/components/ExpenseSubmitButton'
import StoreAdminNav from '@/components/store/StoreAdminNav'
import StoreExpensesTableClient, { type StoreExpenseRow } from '@/components/store/StoreExpensesTableClient'
import { canAccessStoreExpenses, canManageStoreExpenses } from '@/lib/rbac'
import { formatCurrency, parsePriceToCents } from '@/lib/money'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

const STORE_EXPENSE_BUCKET = 'store-expense-attachments'
const PER_PAGE = 25

const STORE_EXPENSE_CATEGORIES = [
  { value: 'supplier_order', label: 'Supplier order' },
  { value: 'transport', label: 'Transport' },
  { value: 'customs_taxes', label: 'Customs / taxes' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'refund', label: 'Refund' },
  { value: 'other', label: 'Other' },
] as const

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
] as const

type SearchParams = Record<string, string | string[] | undefined>
type RangePreset = 'today' | '7d' | 'month' | 'custom'

function safeStr(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function strParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : ''
}

function parsePositiveInt(value: unknown, fallback: number) {
  const n = Number.parseInt(strParam(value), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parsePreset(value: unknown): RangePreset {
  const raw = strParam(value)
  return raw === 'today' || raw === '7d' || raw === 'month' || raw === 'custom' ? raw : 'month'
}

function toISODate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function sanitizeSearch(value: string) {
  return value.replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function categoryLabel(value?: string | null) {
  return STORE_EXPENSE_CATEGORIES.find((item) => item.value === value)?.label ?? value ?? '—'
}

function paymentLabel(value?: string | null) {
  return PAYMENT_METHODS.find((item) => item.value === value)?.label ?? value?.replaceAll('_', ' ') ?? '—'
}

function buildQS(params: Record<string, string>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return search.toString()
}

function redirectWithMessage(baseQuery: string, key: 'saved' | 'error', message: string) {
  const search = new URLSearchParams(baseQuery || '')
  if (key === 'saved') {
    search.set('saved', message)
    search.delete('error')
    search.delete('updated')
    search.delete('deleted')
    search.set('page', '1')
  } else {
    search.set('error', message)
  }
  redirect(`/admin/store/expenses?${search.toString()}`)
}

async function uploadAttachment(admin: ReturnType<typeof getSupabaseAdminClientCached>, file: File, expenseDate: string) {
  const maxSize = 8 * 1024 * 1024
  if (file.size > maxSize) {
    throw new Error('Attachment is too large. Max 8MB.')
  }

  const mime = (file.type || '').toLowerCase()
  const ok = mime.startsWith('image/') || mime === 'application/pdf'
  if (!ok) {
    throw new Error('Attachment must be an image or a PDF.')
  }

  const originalName = (file.name || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_')
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  const path = `store-expenses/${expenseDate}/${uuid}-${originalName}`
  const buffer = await file.arrayBuffer()

  const upload = await admin.storage.from(STORE_EXPENSE_BUCKET).upload(path, buffer, {
    contentType: mime || 'application/octet-stream',
    upsert: false,
  })

  if (upload.error) {
    throw new Error(upload.error.message || 'Attachment upload failed.')
  }

  return {
    attachment_path: path,
    attachment_mime: mime || null,
    attachment_filename: file.name || null,
  }
}

async function addStoreExpenseAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/expenses')
  if (!canManageStoreExpenses(me.role)) redirect('/admin/store/expenses?error=Access%20denied')

  const returnQueryString = safeStr(formData.get('return_qs'))
  const expenseDateRaw = safeStr(formData.get('expense_date')).trim()
  const today = toISODate(new Date())
  const expenseDate = expenseDateRaw || today
  const category = safeStr(formData.get('category')).trim()
  const title = safeStr(formData.get('title')).trim()
  const amountRaw = safeStr(formData.get('amount')).trim()
  const paymentMethod = safeStr(formData.get('payment_method')).trim()
  const vendorName = safeStr(formData.get('vendor_name')).trim()
  const note = safeStr(formData.get('note')).trim()

  if (!isDateOnly(expenseDate)) redirectWithMessage(returnQueryString, 'error', 'Invalid expense date.')
  if (!STORE_EXPENSE_CATEGORIES.some((item) => item.value === category)) redirectWithMessage(returnQueryString, 'error', 'Please choose a valid category.')
  if (!title) redirectWithMessage(returnQueryString, 'error', 'Title is required.')
  if (!PAYMENT_METHODS.some((item) => item.value === paymentMethod)) redirectWithMessage(returnQueryString, 'error', 'Please choose a valid payment method.')

  const amountCents = parsePriceToCents(amountRaw)
  if (!Number.isFinite(amountCents) || amountCents <= 0) redirectWithMessage(returnQueryString, 'error', 'Amount must be greater than 0.')

  const admin = getSupabaseAdminClientCached()
  const attachment = formData.get('attachment')
  let attachmentPayload: Record<string, string | null> = {}
  let insertedId = ''

  try {
    if (attachment && typeof (attachment as any)?.arrayBuffer === 'function') {
      const file = attachment as File
      if (file.size > 0) {
        attachmentPayload = await uploadAttachment(admin, file, expenseDate)
      }
    }

    const { data, error } = await admin
      .from('store_expenses')
      .insert({
        expense_date: expenseDate,
        category,
        title,
        amount_cents: amountCents,
        currency: 'EGP',
        payment_method: paymentMethod,
        vendor_name: vendorName || null,
        note: note || null,
        created_by: me.id,
        updated_by: me.id,
        ...attachmentPayload,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (error || !data?.id) {
      if (attachmentPayload.attachment_path) {
        await admin.storage.from(STORE_EXPENSE_BUCKET).remove([attachmentPayload.attachment_path]).catch(() => null)
      }
      throw new Error(error?.message || 'Save failed.')
    }

    insertedId = data.id
  } catch (error: any) {
    redirectWithMessage(returnQueryString, 'error', error?.message || 'Save failed.')
  }

  revalidatePath('/admin/store/expenses')
  revalidatePath('/admin/store/dashboard')

  const search = new URLSearchParams(returnQueryString || '')
  search.set('saved', '1')
  search.set('page', '1')
  if (insertedId) search.set('focus_id', insertedId)
  search.delete('error')
  redirect(`/admin/store/expenses?${search.toString()}`)

}

export default async function StoreExpensesPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/expenses')

  if (!canAccessStoreExpenses(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Expenses"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only admin and super admin roles can access store expenses."
        allowed="admin, super_admin"
        nextPath="/admin/store/expenses"
        actions={[{ href: '/admin/store/dashboard', label: 'Go to Store Dashboard' }]}
        showBackHome
      />
    )
  }

  const canManage = canManageStoreExpenses(me.role)
  const now = new Date()
  const today = toISODate(now)
  const thisMonthFrom = toISODate(startOfMonth(now))
  const thisMonthTo = toISODate(endOfMonth(now))
  const preset = parsePreset(searchParams?.preset)

  let from = strParam(searchParams?.from)
  let to = strParam(searchParams?.to)

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
    if (!isDateOnly(from)) from = thisMonthFrom
    if (!isDateOnly(to)) to = thisMonthTo
  }

  const category = STORE_EXPENSE_CATEGORIES.some((item) => item.value === strParam(searchParams?.category))
    ? strParam(searchParams?.category)
    : 'all'
  const paymentMethod = PAYMENT_METHODS.some((item) => item.value === strParam(searchParams?.payment_method))
    ? strParam(searchParams?.payment_method)
    : 'all'
  const qRaw = strParam(searchParams?.q)
  const q = sanitizeSearch(qRaw)
  const page = parsePositiveInt(searchParams?.page, 1)
  const offset = (page - 1) * PER_PAGE

  const saved = strParam(searchParams?.saved)
  const updated = strParam(searchParams?.updated)
  const deleted = strParam(searchParams?.deleted)
  const errorMsg = strParam(searchParams?.error)
  const focusId = strParam(searchParams?.focus_id)

  const admin = getSupabaseAdminClientCached()

  let listQuery = admin
    .from('store_expenses')
    .select('id,expense_date,category,title,amount_cents,currency,payment_method,vendor_name,note,attachment_path,attachment_mime,attachment_filename,created_at,updated_at', { count: 'exact' })
    .is('deleted_at', null)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (category !== 'all') listQuery = listQuery.eq('category', category)
  if (paymentMethod !== 'all') listQuery = listQuery.eq('payment_method', paymentMethod)
  if (q) {
    const like = `%${q}%`
    listQuery = listQuery.or(`title.ilike.${like},vendor_name.ilike.${like},note.ilike.${like}`)
  }

  const { data: rows, error: rowsError, count } = await listQuery.range(offset, offset + PER_PAGE - 1)

  let summaryQuery = admin
    .from('store_expenses')
    .select('id,amount_cents,payment_method,category')
    .is('deleted_at', null)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .limit(100000)

  if (category !== 'all') summaryQuery = summaryQuery.eq('category', category)
  if (paymentMethod !== 'all') summaryQuery = summaryQuery.eq('payment_method', paymentMethod)
  if (q) {
    const like = `%${q}%`
    summaryQuery = summaryQuery.or(`title.ilike.${like},vendor_name.ilike.${like},note.ilike.${like}`)
  }

  const { data: summaryRows, error: summaryError } = await summaryQuery

  const expenses = (rows ?? []) as StoreExpenseRow[]
  const summary = (summaryRows ?? []) as Array<{ id: string; amount_cents: number | null; payment_method: string | null; category: string | null }>
  const filteredTotalCents = summary.reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents ?? 0)), 0)
  const currentPageTotalCents = expenses.reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents ?? 0)), 0)
  const filteredCount = summary.length
  const averageCents = filteredCount > 0 ? Math.round(filteredTotalCents / filteredCount) : 0
  const supplierAndTransportCents = summary.reduce((sum, row) => {
    return row.category === 'supplier_order' || row.category === 'transport'
      ? sum + Math.max(0, Number(row.amount_cents ?? 0))
      : sum
  }, 0)

  const totalCount = typeof count === 'number' ? count : undefined
  const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / PER_PAGE)) : undefined
  const hasPrev = page > 1
  const hasNext = totalPages ? page < totalPages : expenses.length === PER_PAGE
  const showPagination = totalPages ? totalPages > 1 : hasPrev || hasNext

  const baseQS = { preset, from, to, category, payment_method: paymentMethod, q: qRaw }
  const filterReturnQS = buildQS(baseQS)
  const prevHref = hasPrev ? `/admin/store/expenses?${buildQS({ ...baseQS, page: String(page - 1) })}` : ''
  const nextHref = hasNext ? `/admin/store/expenses?${buildQS({ ...baseQS, page: String(page + 1) })}` : ''

  const quickLinks = {
    today: `/admin/store/expenses?${buildQS({ preset: 'today', from: today, to: today, category, payment_method: paymentMethod, q: qRaw })}`,
    seven: `/admin/store/expenses?${buildQS({ preset: '7d', from: toISODate(addDays(now, -6)), to: today, category, payment_method: paymentMethod, q: qRaw })}`,
    month: `/admin/store/expenses?${buildQS({ preset: 'month', from: thisMonthFrom, to: thisMonthTo, category, payment_method: paymentMethod, q: qRaw })}`,
    custom: `/admin/store/expenses?${buildQS({ preset: 'custom', from, to, category, payment_method: paymentMethod, q: qRaw })}`,
  }

  return (
    <main>
      <PageHeader
        title="Store Expenses"
        subtitle="Simple store cash visibility: supplier orders, transport, customs, packaging, refunds, and other store costs."
        showReload
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/expenses" role={me.role} />
      </Section>

      <Section className="space-y-6">
        {errorMsg ? <InlineAlert variant="error" title="Error">{errorMsg}</InlineAlert> : null}
        {rowsError ? <InlineAlert variant="warning" title="Expenses">{rowsError.message || 'Failed to load store expenses.'}</InlineAlert> : null}
        {summaryError ? <InlineAlert variant="warning" title="Summary">{summaryError.message || 'Failed to load store expense summary.'}</InlineAlert> : null}
        {saved ? <InlineAlert variant="success" title="Saved">Store expense added.</InlineAlert> : null}
        {updated ? <InlineAlert variant="success" title="Updated">Store expense updated.</InlineAlert> : null}
        {deleted ? <InlineAlert variant="success" title="Deleted">Store expense deleted from the active view. The audit record is kept.</InlineAlert> : null}

        {!canManage ? (
          <InlineAlert variant="info" title="Read-only">
            Admin can review store expenses. Only super admin can add, edit, or delete store expenses.
          </InlineAlert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">Refine the active store expense view.</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <a href={quickLinks.today} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Today</a>
              <a href={quickLinks.seven} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Last 7 days</a>
              <a href={quickLinks.month} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">This month</a>
              <a href={quickLinks.custom} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Custom</a>
              <a href="/admin/store/expenses" className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Reset</a>
            </div>

            <form method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Preset</span>
                <select name="preset" defaultValue={preset} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                <select name="category" defaultValue={category} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="all">All</option>
                  {STORE_EXPENSE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment</span>
                <select name="payment_method" defaultValue={paymentMethod} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="all">All</option>
                  {PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>

              <label className="block sm:col-span-2 xl:col-span-1">
                <span className="mb-1 block text-sm font-medium">Search</span>
                <input name="q" defaultValue={qRaw} placeholder="title / vendor / note" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
              </label>

              <div className="sm:col-span-2 xl:col-span-6">
                <button type="submit" className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white shadow-soft hover:opacity-95">
                  Apply filters
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Filtered total</div>
              <div className="mt-1 text-xl font-semibold">{formatCurrency(filteredTotalCents, 'en-EG', 'EGP')}</div>
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
              <div className="mt-1 text-xl font-semibold">{formatCurrency(averageCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Supplier + transport</div>
              <div className="mt-1 text-xl font-semibold">{formatCurrency(supplierAndTransportCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Store expenses</CardTitle>
            <div className="text-xs text-[hsl(var(--muted))]">
              Showing {totalCount ? `${Math.min(offset + 1, totalCount)}–${Math.min(offset + expenses.length, totalCount)} of ${totalCount}` : `${expenses.length}`} active item{expenses.length === 1 ? '' : 's'}.
            </div>
          </CardHeader>
          <CardContent>
            {expenses.length > 0 ? (
              <StoreExpensesTableClient
                expenses={expenses}
                categories={STORE_EXPENSE_CATEGORIES.map((item) => ({ value: item.value, label: item.label }))}
                paymentMethods={PAYMENT_METHODS.map((item) => ({ value: item.value, label: item.label }))}
                canManage={canManage}
                returnQueryString={filterReturnQS}
                focusExpenseId={focusId}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-6 text-center">
                <div className="text-base font-medium">No store expenses found.</div>
                <p className="mt-2 text-sm text-[hsl(var(--muted))]">Try a broader date range or reset filters.</p>
              </div>
            )}

            {showPagination ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <a href={hasPrev ? prevHref : '#'} aria-disabled={!hasPrev} className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium shadow-soft ${hasPrev ? 'bg-white text-black hover:bg-[hsl(var(--bg))]/80' : 'pointer-events-none cursor-not-allowed bg-gray-100 text-gray-400'}`}>Prev</a>
                <div className="text-xs text-[hsl(var(--muted))]">Page <span className="font-medium text-[hsl(var(--fg))]">{page}</span>{totalPages ? <> / <span className="font-medium text-[hsl(var(--fg))]">{totalPages}</span></> : null}</div>
                <a href={hasNext ? nextHref : '#'} aria-disabled={!hasNext} className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium shadow-soft ${hasNext ? 'bg-white text-black hover:bg-[hsl(var(--bg))]/80' : 'pointer-events-none cursor-not-allowed bg-gray-100 text-gray-400'}`}>Next</a>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Add store expense</CardTitle>
              <div className="text-xs text-[hsl(var(--muted))]">Super admin only · EGP only · attachment optional.</div>
            </CardHeader>
            <CardContent>
              <form action={addStoreExpenseAction} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="return_qs" value={filterReturnQS} />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Date</span>
                  <input type="date" name="expense_date" defaultValue={today} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Category</span>
                  <select name="category" defaultValue="supplier_order" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {STORE_EXPENSE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Amount (EGP)</span>
                  <input type="number" name="amount" min="0" step="0.01" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Title</span>
                  <input name="title" placeholder="Example: Pakistan factory order" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Payment method</span>
                  <select name="payment_method" defaultValue="cash" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Vendor / supplier</span>
                  <input name="vendor_name" placeholder="Optional" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Note</span>
                  <input name="note" placeholder="Optional note…" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Attachment</span>
                  <input type="file" name="attachment" accept="image/*,application/pdf" className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-white" />
                  <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Accepted: JPG, PNG, WEBP, PDF. Max 8MB.</span>
                </label>
                <div className="sm:col-span-4">
                  <ExpenseSubmitButton idleLabel="Save store expense" pendingLabel="Saving…" />
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </Section>
    </main>
  )
}
