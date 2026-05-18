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
import StoreFundingTableClient, { type StoreFundingRow } from '@/components/store/StoreFundingTableClient'
import { canAccessStoreFunding, canManageStoreFunding } from '@/lib/rbac'
import { formatCurrency, parsePriceToCents } from '@/lib/money'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

const STORE_FUNDING_BUCKET = 'store-funding-attachments'
const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [5, 10, 25] as const

const STORE_FUNDING_TYPES = [
  { value: 'loan_received', label: 'Loan received' },
  { value: 'loan_repayment', label: 'Loan repayment' },
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

function parsePageSize(value: unknown) {
  const n = parsePositiveInt(value, DEFAULT_PAGE_SIZE)
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE
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

function fundingTypeLabel(value?: string | null) {
  return STORE_FUNDING_TYPES.find((item) => item.value === value)?.label ?? value?.replaceAll('_', ' ') ?? '—'
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
  redirect(`/admin/store/funding?${search.toString()}`)
}

async function uploadAttachment(admin: ReturnType<typeof getSupabaseAdminClientCached>, file: File, fundingDate: string) {
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
  const path = `store-funding/${fundingDate}/${uuid}-${originalName}`
  const buffer = await file.arrayBuffer()

  const upload = await admin.storage.from(STORE_FUNDING_BUCKET).upload(path, buffer, {
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

async function addStoreFundingAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/funding')
  if (!canManageStoreFunding(me.role)) redirect('/admin/store/funding?error=Access%20denied')

  const returnQueryString = safeStr(formData.get('return_qs'))
  const fundingDateRaw = safeStr(formData.get('funding_date')).trim()
  const today = toISODate(new Date())
  const fundingDate = fundingDateRaw || today
  const type = safeStr(formData.get('type')).trim()
  const title = safeStr(formData.get('title')).trim()
  const amountRaw = safeStr(formData.get('amount')).trim()
  const paymentMethod = safeStr(formData.get('payment_method')).trim()
  const sourceName = safeStr(formData.get('source_name')).trim()
  const note = safeStr(formData.get('note')).trim()

  if (!isDateOnly(fundingDate)) redirectWithMessage(returnQueryString, 'error', 'Invalid funding date.')
  if (!STORE_FUNDING_TYPES.some((item) => item.value === type)) redirectWithMessage(returnQueryString, 'error', 'Please choose a valid funding type.')
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
        attachmentPayload = await uploadAttachment(admin, file, fundingDate)
      }
    }

    const { data, error } = await admin
      .from('store_external_funding')
      .insert({
        funding_date: fundingDate,
        type,
        title,
        amount_cents: amountCents,
        currency: 'EGP',
        payment_method: paymentMethod,
        source_name: sourceName || null,
        note: note || null,
        created_by: me.id,
        updated_by: me.id,
        ...attachmentPayload,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (error || !data?.id) {
      if (attachmentPayload.attachment_path) {
        await admin.storage.from(STORE_FUNDING_BUCKET).remove([attachmentPayload.attachment_path]).catch(() => null)
      }
      throw new Error(error?.message || 'Save failed.')
    }

    insertedId = data.id
  } catch (error: any) {
    redirectWithMessage(returnQueryString, 'error', error?.message || 'Save failed.')
  }

  revalidatePath('/admin/store/funding')
  revalidatePath('/admin/store/dashboard')

  const search = new URLSearchParams(returnQueryString || '')
  search.set('saved', '1')
  search.set('page', '1')
  if (insertedId) search.set('focus_id', insertedId)
  search.delete('error')
  redirect(`/admin/store/funding?${search.toString()}`)
}

export default async function StoreFundingPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store/funding')

  if (!canAccessStoreFunding(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Funding"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only admin and super admin roles can access store external funding."
        allowed="admin, super_admin"
        nextPath="/admin/store/funding"
        actions={[{ href: '/admin/store/dashboard', label: 'Go to Store Dashboard' }]}
        showBackHome
      />
    )
  }

  const canManage = canManageStoreFunding(me.role)
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

  const type = STORE_FUNDING_TYPES.some((item) => item.value === strParam(searchParams?.type))
    ? strParam(searchParams?.type)
    : 'all'
  const paymentMethod = PAYMENT_METHODS.some((item) => item.value === strParam(searchParams?.payment_method))
    ? strParam(searchParams?.payment_method)
    : 'all'
  const qRaw = strParam(searchParams?.q)
  const q = sanitizeSearch(qRaw)
  const pageSize = parsePageSize(searchParams?.page_size)
  const page = parsePositiveInt(searchParams?.page, 1)
  const offset = (page - 1) * pageSize

  const saved = strParam(searchParams?.saved)
  const updated = strParam(searchParams?.updated)
  const deleted = strParam(searchParams?.deleted)
  const errorMsg = strParam(searchParams?.error)
  const focusId = strParam(searchParams?.focus_id)

  const admin = getSupabaseAdminClientCached()

  let listQuery = admin
    .from('store_external_funding')
    .select('id,funding_date,type,title,amount_cents,currency,payment_method,source_name,note,attachment_path,attachment_mime,attachment_filename,created_at,updated_at', { count: 'exact' })
    .is('deleted_at', null)
    .gte('funding_date', from)
    .lte('funding_date', to)
    .order('funding_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (type !== 'all') listQuery = listQuery.eq('type', type)
  if (paymentMethod !== 'all') listQuery = listQuery.eq('payment_method', paymentMethod)
  if (q) {
    const like = `%${q}%`
    listQuery = listQuery.or(`title.ilike.${like},source_name.ilike.${like},note.ilike.${like}`)
  }

  const { data: rows, error: rowsError, count } = await listQuery.range(offset, offset + pageSize - 1)

  let summaryQuery = admin
    .from('store_external_funding')
    .select('id,amount_cents,payment_method,type')
    .is('deleted_at', null)
    .gte('funding_date', from)
    .lte('funding_date', to)
    .limit(100000)

  if (type !== 'all') summaryQuery = summaryQuery.eq('type', type)
  if (paymentMethod !== 'all') summaryQuery = summaryQuery.eq('payment_method', paymentMethod)
  if (q) {
    const like = `%${q}%`
    summaryQuery = summaryQuery.or(`title.ilike.${like},source_name.ilike.${like},note.ilike.${like}`)
  }

  const { data: summaryRows, error: summaryError } = await summaryQuery

  const fundingRows = (rows ?? []) as StoreFundingRow[]
  const summary = (summaryRows ?? []) as Array<{ id: string; amount_cents: number | null; payment_method: string | null; type: string | null }>
  const receivedCents = summary.reduce((sum, row) => row.type === 'loan_received' ? sum + Math.max(0, Number(row.amount_cents ?? 0)) : sum, 0)
  const repaymentCents = summary.reduce((sum, row) => row.type === 'loan_repayment' ? sum + Math.max(0, Number(row.amount_cents ?? 0)) : sum, 0)
  const netFundingCents = receivedCents - repaymentCents
  const outstandingDebtCents = Math.max(0, netFundingCents)
  const filteredCount = summary.length
  const currentPageTotalCents = fundingRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents ?? 0)), 0)

  const totalCount = typeof count === 'number' ? count : undefined
  const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / pageSize)) : undefined
  const hasPrev = page > 1
  const hasNext = totalPages ? page < totalPages : fundingRows.length === pageSize
  const showPagination = totalPages ? totalPages > 1 : hasPrev || hasNext

  const baseQS = { preset, from, to, type, payment_method: paymentMethod, q: qRaw, page_size: String(pageSize) }
  const filterReturnQS = buildQS(baseQS)
  const activeFilterChips = [
    `Period: ${from} → ${to}`,
    type !== 'all' ? `Type: ${fundingTypeLabel(type)}` : 'Type: All',
    paymentMethod !== 'all' ? `Payment: ${paymentLabel(paymentMethod)}` : 'Payment: All',
    q ? `Search: ${q}` : '',
    `Page size: ${pageSize}`,
  ].filter(Boolean)
  const prevHref = hasPrev ? `/admin/store/funding?${buildQS({ ...baseQS, page: String(page - 1) })}` : ''
  const nextHref = hasNext ? `/admin/store/funding?${buildQS({ ...baseQS, page: String(page + 1) })}` : ''

  const quickLinks = {
    today: `/admin/store/funding?${buildQS({ preset: 'today', from: today, to: today, type, payment_method: paymentMethod, q: qRaw, page_size: String(pageSize) })}`,
    seven: `/admin/store/funding?${buildQS({ preset: '7d', from: toISODate(addDays(now, -6)), to: today, type, payment_method: paymentMethod, q: qRaw, page_size: String(pageSize) })}`,
    month: `/admin/store/funding?${buildQS({ preset: 'month', from: thisMonthFrom, to: thisMonthTo, type, payment_method: paymentMethod, q: qRaw, page_size: String(pageSize) })}`,
    custom: `/admin/store/funding?${buildQS({ preset: 'custom', from, to, type, payment_method: paymentMethod, q: qRaw, page_size: String(pageSize) })}`,
  }

  return (
    <main>
      <PageHeader
        title="Store Funding"
        subtitle="External loans and repayments used for Store cash visibility. Not sales revenue."
        showReload
      />

      <Section className="space-y-4">
        <StoreAdminNav current="/admin/store/funding" role={me.role} />
      </Section>

      <Section className="space-y-6">
        {errorMsg ? <InlineAlert variant="error" title="Error">{errorMsg}</InlineAlert> : null}
        {rowsError ? <InlineAlert variant="warning" title="Funding">{rowsError.message || 'Failed to load store funding.'}</InlineAlert> : null}
        {summaryError ? <InlineAlert variant="warning" title="Summary">{summaryError.message || 'Failed to load store funding summary.'}</InlineAlert> : null}
        {saved ? <InlineAlert variant="success" title="Saved">Store funding entry added.</InlineAlert> : null}
        {updated ? <InlineAlert variant="success" title="Updated">Store funding entry updated.</InlineAlert> : null}
        {deleted ? <InlineAlert variant="success" title="Deleted">Store funding entry deleted from the active view. The audit record is kept.</InlineAlert> : null}

        <InlineAlert variant="info" title="Accounting note">
          External funding is not Store revenue. Loan received increases available cash and debt; loan repayment reduces available cash and debt.
        </InlineAlert>

        {!canManage ? (
          <InlineAlert variant="info" title="Read-only">
            Admin can review store funding. Only super admin can add, edit, or delete funding entries.
          </InlineAlert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">Refine external funding entries.</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <a href={quickLinks.today} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Today</a>
              <a href={quickLinks.seven} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Last 7 days</a>
              <a href={quickLinks.month} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">This month</a>
              <a href={quickLinks.custom} className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Custom</a>
              <a href="/admin/store/funding" className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]/80">Reset</a>
            </div>

            <form method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
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
                <span className="mb-1 block text-sm font-medium">Type</span>
                <select name="type" defaultValue={type} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="all">All</option>
                  {STORE_FUNDING_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
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
                <input name="q" defaultValue={qRaw} placeholder="title / lender / note" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Rows</span>
                <select name="page_size" defaultValue={String(pageSize)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={String(size)}>{size}</option>)}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-7">
                <button type="submit" className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white shadow-soft hover:opacity-95">
                  Apply filters
                </button>
              </div>
            </form>

            <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--border))] pt-3">
              {activeFilterChips.map((chip) => (
                <span key={chip} className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">
                  {chip}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Loan received</div>
              <div className="mt-1 text-xl font-semibold">{formatCurrency(receivedCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Loan repayment</div>
              <div className="mt-1 text-xl font-semibold">{formatCurrency(repaymentCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Net external funding</div>
              <div className="mt-1 text-xl font-semibold">{formatCurrency(netFundingCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Outstanding funding debt</div>
              <div className="mt-1 text-xl font-semibold">{formatCurrency(outstandingDebtCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">Filtered entries</div>
              <div className="mt-1 text-xl font-semibold">{filteredCount}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Page total {formatCurrency(currentPageTotalCents, 'en-EG', 'EGP')}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Store external funding</CardTitle>
                <div className="text-xs text-[hsl(var(--muted))]">
                  Showing {totalCount ? `${Math.min(offset + 1, totalCount)}–${Math.min(offset + fundingRows.length, totalCount)} of ${totalCount}` : `${fundingRows.length}`} active item{fundingRows.length === 1 ? '' : 's'}.
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {fundingRows.length > 0 ? (
              <StoreFundingTableClient
                fundingRows={fundingRows}
                fundingTypes={STORE_FUNDING_TYPES.map((item) => ({ value: item.value, label: item.label }))}
                paymentMethods={PAYMENT_METHODS.map((item) => ({ value: item.value, label: item.label }))}
                canManage={canManage}
                returnQueryString={filterReturnQS}
                focusFundingId={focusId}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-6 text-center">
                <div className="text-base font-medium">No store funding entries found.</div>
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
          <div id="add-store-funding">
            <Card>
              <CardHeader>
                <CardTitle>Add store funding</CardTitle>
                <div className="text-xs text-[hsl(var(--muted))]">Super admin only · EGP only · attachment optional.</div>
              </CardHeader>
              <CardContent>
                <form action={addStoreFundingAction} className="grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="return_qs" value={filterReturnQS} />
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">Date</span>
                    <input type="date" name="funding_date" defaultValue={today} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">Type</span>
                    <select name="type" defaultValue="loan_received" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {STORE_FUNDING_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">Amount (EGP)</span>
                    <input type="number" name="amount" min="0" step="0.01" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">Payment method</span>
                    <select name="payment_method" defaultValue="cash" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-sm font-medium">Title</span>
                    <input name="title" placeholder="Example: Loan from partner" required className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-sm font-medium">Source / lender</span>
                    <input name="source_name" placeholder="Optional" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring" />
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
                    <ExpenseSubmitButton idleLabel="Save store funding" pendingLabel="Saving…" />
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
