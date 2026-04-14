export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Badge from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
import { canAccessPayments } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type Method = 'cash' | 'instapay' | 'card' | 'bank_transfer'
type ValidationMode = 'cash_period' | 'daily'

type OpenGroupRow = {
  payment_method: Method
  validation_mode: ValidationMode
  business_date: string | null
  period_from: string
  period_to: string
  first_business_date: string | null
  last_business_date: string | null
  line_count: number
  expected_amount: number
}

type OpenEventRow = {
  source_kind: 'subscription_payment' | 'external_income'
  source_id: string
  member_id: string | null
  source_key: string | null
  title: string
  note: string | null
  amount: number
  payment_method_norm: Method
  payment_method_raw: string | null
  business_date: string
  event_at: string
}

type ProfileMini = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
}

type BatchRow = {
  id: string
  payment_method: Method
  validation_mode: ValidationMode
  business_date: string | null
  period_from: string
  period_to: string
  expected_amount: number
  counted_amount: number
  difference_amount: number
  note: string | null
  validated_at: string
  validator: ProfileMini | null
}

const METHODS: Array<Method | 'all'> = ['all', 'cash', 'instapay', 'card', 'bank_transfer']

function formatEGP(n: number) {
  const v = Number(n ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)
  } catch {
    return `${v.toFixed(2)} EGP`
  }
}

function labelMethod(m: Method | string) {
  if (m === 'cash') return 'Cash'
  if (m === 'instapay') return 'Instapay'
  if (m === 'card') return 'Card'
  if (m === 'bank_transfer') return 'Bank transfer'
  return String(m || '—')
}

function badgeClassForMethod(m: Method | string) {
  if (m === 'cash') return 'bg-emerald-50 text-emerald-700'
  if (m === 'instapay') return 'bg-sky-50 text-sky-700'
  if (m === 'card') return 'bg-violet-50 text-violet-700'
  if (m === 'bank_transfer') return 'bg-amber-50 text-amber-800'
  return ''
}

function labelMode(mode: ValidationMode) {
  return mode === 'cash_period' ? 'Cash period' : 'Daily'
}

function safeMethod(v: string | null | undefined): Method | 'all' {
  return METHODS.includes(v as any) ? (v as Method | 'all') : 'all'
}

function formatCairoDateTime(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return '—'
  const dt = new Date(raw)
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

function formatDateOnly(isoDate?: string | null) {
  const raw = String(isoDate ?? '').trim()
  if (!raw) return '—'
  const dt = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return raw
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)
}

type RangeLabelRow = {
  validation_mode: ValidationMode
  business_date?: string | null
  first_business_date?: string | null
  last_business_date?: string | null
  period_from?: string | null
  period_to?: string | null
}

function formatRangeLabel(row: RangeLabelRow) {
  if (row.validation_mode === 'cash_period') {
    const fromRaw = row.first_business_date ?? row.period_from ?? null
    const toRaw = row.last_business_date ?? row.period_to ?? null
    const from = formatDateOnly(fromRaw)
    const to = formatDateOnly(toRaw)
    return from === to ? from : `${from} → ${to}`
  }
  return formatDateOnly(row.business_date)
}

function profileLabel(profile?: ProfileMini | null) {
  const full = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
  return full || profile?.email || '—'
}

function eventSourceLabel(row: OpenEventRow) {
  if (row.source_kind === 'subscription_payment') return 'Subscription'
  if (row.source_key === 'bar') return 'Other income · Bar'
  if (row.source_key === 'store') return 'Other income · Store'
  if (row.source_key === 'other') return 'Other income · Other'
  return 'Other income'
}

function buildQS(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const value = String(v ?? '')
    if (value.length) sp.set(k, value)
  }
  return sp.toString()
}

export default async function AdminPaymentsReconciliationPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/payments/reconciliation')

  if (!canAccessPayments(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Payments Reconciliation</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access this page."
            nextPath="/admin/payments/reconciliation"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const methodFilter = safeMethod(typeof searchParams.method === 'string' ? searchParams.method : null)
  const admin = getSupabaseAdminClientCached()

  let groupsQuery = admin
    .from('payment_validation_open_groups_v1')
    .select('payment_method, validation_mode, business_date, period_from, period_to, first_business_date, last_business_date, line_count, expected_amount')
    .order('payment_method', { ascending: true })
    .order('business_date', { ascending: false, nullsFirst: false })

  if (methodFilter !== 'all') groupsQuery = groupsQuery.eq('payment_method', methodFilter)

  const { data: groupsRaw, error: groupsErr } = await groupsQuery

  const openGroups: OpenGroupRow[] = ((groupsRaw ?? []) as any[]).map((row) => ({
    payment_method: row.payment_method as Method,
    validation_mode: row.validation_mode as ValidationMode,
    business_date: row.business_date ?? null,
    period_from: String(row.period_from),
    period_to: String(row.period_to),
    first_business_date: row.first_business_date ?? null,
    last_business_date: row.last_business_date ?? null,
    line_count: Number(row.line_count ?? 0),
    expected_amount: Number(row.expected_amount ?? 0),
  }))

  let openEventsQuery = admin
    .from('admin_income_events_open_v1')
    .select('source_kind, source_id, member_id, source_key, title, note, amount, payment_method_norm, payment_method_raw, business_date, event_at')
    .order('event_at', { ascending: false })
    .limit(100)

  if (methodFilter !== 'all') openEventsQuery = openEventsQuery.eq('payment_method_norm', methodFilter)

  const { data: eventsRaw, error: eventsErr } = await openEventsQuery

  const openEvents: OpenEventRow[] = ((eventsRaw ?? []) as any[]).map((row) => ({
    source_kind: row.source_kind,
    source_id: String(row.source_id),
    member_id: row.member_id ? String(row.member_id) : null,
    source_key: row.source_key ?? null,
    title: String(row.title ?? 'Untitled'),
    note: row.note ?? null,
    amount: Number(row.amount ?? 0),
    payment_method_norm: row.payment_method_norm as Method,
    payment_method_raw: row.payment_method_raw ?? null,
    business_date: String(row.business_date),
    event_at: String(row.event_at),
  }))

  let historyQuery = admin
    .from('payment_validation_batches')
    .select(
      'id, payment_method, validation_mode, business_date, period_from, period_to, expected_amount, counted_amount, difference_amount, note, validated_at, validator:profiles!payment_validation_batches_validated_by_fkey(user_id,email,first_name,last_name)'
    )
    .is('deleted_at', null)
    .order('validated_at', { ascending: false })
    .limit(50)

  if (methodFilter !== 'all') historyQuery = historyQuery.eq('payment_method', methodFilter)

  const { data: historyRaw, error: historyErr } = await historyQuery

  const historyRows: BatchRow[] = ((historyRaw ?? []) as any[]).map((row) => ({
    id: String(row.id),
    payment_method: row.payment_method as Method,
    validation_mode: row.validation_mode as ValidationMode,
    business_date: row.business_date ?? null,
    period_from: String(row.period_from),
    period_to: String(row.period_to),
    expected_amount: Number(row.expected_amount ?? 0),
    counted_amount: Number(row.counted_amount ?? 0),
    difference_amount: Number(row.difference_amount ?? 0),
    note: row.note ?? null,
    validated_at: String(row.validated_at),
    validator: (row.validator ?? null) as ProfileMini | null,
  }))

  const historyIds = historyRows.map((row) => row.id)
  const { data: batchItemsRaw, error: batchItemsErr } = historyIds.length
    ? await admin.from('payment_validation_batch_items').select('batch_id').in('batch_id', historyIds)
    : { data: [], error: null as any }

  const itemsCountByBatchId = new Map<string, number>()
  for (const row of (batchItemsRaw ?? []) as Array<{ batch_id: string }>) {
    const id = String(row.batch_id)
    itemsCountByBatchId.set(id, (itemsCountByBatchId.get(id) ?? 0) + 1)
  }

  const totalsByMethod: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  let openTotal = 0
  let openLines = 0
  for (const row of openGroups) {
    openTotal += row.expected_amount
    openLines += row.line_count
    totalsByMethod[row.payment_method] += row.expected_amount
  }

  const cashOpen = openGroups.find((row) => row.payment_method === 'cash' && row.validation_mode === 'cash_period') ?? null
  const dailyOpenRows = openGroups.filter((row) => row.validation_mode === 'daily')

  const filterQS = buildQS(methodFilter === 'all' ? {} : { method: methodFilter })
  const methodHref = (method: Method | 'all') =>
    method === 'all' ? '/admin/payments/reconciliation' : `/admin/payments/reconciliation?${buildQS({ method })}`

  const summaryCards: Array<{ label: string; value: string; sub: string }> = [
    {
      label: 'Open total',
      value: formatEGP(openTotal),
      sub: `${openGroups.length} open group${openGroups.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Open entries',
      value: String(openLines),
      sub: 'Unreconciled income lines',
    },
    {
      label: 'Cash',
      value: formatEGP(totalsByMethod.cash),
      sub: cashOpen ? `Open period · ${cashOpen.line_count} line${cashOpen.line_count === 1 ? '' : 's'}` : 'No open cash period',
    },
    {
      label: 'Instapay',
      value: formatEGP(totalsByMethod.instapay),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'instapay').length} daily group(s)`,
    },
    {
      label: 'Card',
      value: formatEGP(totalsByMethod.card),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'card').length} daily group(s)`,
    },
    {
      label: 'Bank transfer',
      value: formatEGP(totalsByMethod.bank_transfer),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'bank_transfer').length} daily group(s)`,
    },
  ]

  const openDailyColumns = [
    { key: 'date', header: 'Business date' },
    { key: 'method', header: 'Method' },
    { key: 'entries', header: 'Entries' },
    { key: 'expected', header: 'Expected amount' },
    { key: 'window', header: 'Event window', hideOnMobile: true },
  ]

  const openDailyTableRows = dailyOpenRows.map((row) => ({
    id: `${row.payment_method}:${row.business_date}`,
    date: <span className="font-medium">{formatDateOnly(row.business_date)}</span>,
    method: <Badge className={badgeClassForMethod(row.payment_method)}>{labelMethod(row.payment_method)}</Badge>,
    entries: <span className="font-medium">{row.line_count}</span>,
    expected: <span className="font-semibold">{formatEGP(row.expected_amount)}</span>,
    window: <span className="text-sm text-[hsl(var(--muted))]">{formatCairoDateTime(row.period_from)} → {formatCairoDateTime(row.period_to)}</span>,
  }))

  const openEventsColumns = [
    { key: 'event_at', header: 'Event at (EG)' },
    { key: 'business_date', header: 'Business date', hideOnMobile: true },
    { key: 'source', header: 'Source' },
    { key: 'title', header: 'Entry' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
    { key: 'note', header: 'Note', hideOnMobile: true },
    { key: 'open', header: '' },
  ]

  const openEventsTableRows = openEvents.map((row) => ({
    id: row.source_id,
    event_at: <span className="font-medium">{formatCairoDateTime(row.event_at)}</span>,
    business_date: <span className="text-sm text-[hsl(var(--muted))]">{formatDateOnly(row.business_date)}</span>,
    source: <span className="text-sm">{eventSourceLabel(row)}</span>,
    title: (
      <div className="space-y-0.5">
        <div className="font-medium">{row.title}</div>
        {row.payment_method_raw && row.payment_method_raw !== row.payment_method_norm ? (
          <div className="text-xs text-[hsl(var(--muted))]">Raw method: {row.payment_method_raw}</div>
        ) : null}
      </div>
    ),
    amount: <span className="font-semibold">{formatEGP(row.amount)}</span>,
    method: <Badge className={badgeClassForMethod(row.payment_method_norm)}>{labelMethod(row.payment_method_norm)}</Badge>,
    note: <span className="text-sm text-[hsl(var(--muted))]">{row.note ?? '—'}</span>,
    open: (
      <Link
        prefetch={false}
        className="inline-flex items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
        href={row.source_kind === 'subscription_payment' && row.member_id ? `/members/${row.member_id}` : '/admin/external-income'}
      >
        Open
      </Link>
    ),
  }))

  const historyColumns = [
    { key: 'validated_at', header: 'Validated at (EG)' },
    { key: 'method', header: 'Method' },
    { key: 'scope', header: 'Scope' },
    { key: 'expected', header: 'Expected' },
    { key: 'counted', header: 'Counted' },
    { key: 'difference', header: 'Difference' },
    { key: 'entries', header: 'Entries', hideOnMobile: true },
    { key: 'by', header: 'By', hideOnMobile: true },
    { key: 'note', header: 'Note', hideOnMobile: true },
  ]

  const historyTableRows = historyRows.map((row) => {
    const differenceTone = row.difference_amount === 0 ? 'text-emerald-700' : row.difference_amount > 0 ? 'text-sky-700' : 'text-rose-700'
    return {
      id: row.id,
      validated_at: <span className="font-medium">{formatCairoDateTime(row.validated_at)}</span>,
      method: <Badge className={badgeClassForMethod(row.payment_method)}>{labelMethod(row.payment_method)}</Badge>,
      scope: (
        <div className="space-y-0.5">
          <div className="font-medium">{labelMode(row.validation_mode)}</div>
          <div className="text-xs text-[hsl(var(--muted))]">{row.validation_mode === 'cash_period' ? formatRangeLabel(row) : formatDateOnly(row.business_date)}</div>
        </div>
      ),
      expected: <span className="font-semibold">{formatEGP(row.expected_amount)}</span>,
      counted: <span className="font-semibold">{formatEGP(row.counted_amount)}</span>,
      difference: <span className={`font-semibold ${differenceTone}`}>{formatEGP(row.difference_amount)}</span>,
      entries: <span className="text-sm">{itemsCountByBatchId.get(row.id) ?? 0}</span>,
      by: <span className="text-sm">{profileLabel(row.validator)}</span>,
      note: <span className="text-sm text-[hsl(var(--muted))]">{row.note ?? '—'}</span>,
    }
  })

  const hasErrors = groupsErr || eventsErr || historyErr || batchItemsErr

  return (
    <main className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Admin · Payments Reconciliation</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            Read-only reconciliation overview based on unreconciled income events and validated batches.
          </p>
          <p className="text-sm text-[hsl(var(--muted))]">
            Cash stays period-based since the last closure. Instapay, Card, and Bank transfer stay daily.
          </p>
          <p className="text-sm text-[hsl(var(--muted))]">
            Signed in as <span className="font-medium">{me.email || 'unknown'}</span>
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href="/admin/payments" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Payments
          </Link>
          <Link prefetch={false} href="/admin/external-income" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Other Income
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Method filter</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Keep the page read-only and narrow the view only when needed.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {METHODS.map((method) => {
              const active = method === methodFilter
              return (
                <Link
                  key={method}
                  prefetch={false}
                  href={methodHref(method)}
                  className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium ${active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--bg))]/80'}`}
                >
                  {method === 'all' ? 'All methods' : labelMethod(method)}
                </Link>
              )
            })}
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">
            Current filter: <span className="font-medium">{methodFilter === 'all' ? 'All methods' : labelMethod(methodFilter)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="py-4">
              <div className="text-xs text-[hsl(var(--muted))]">{card.label}</div>
              <div className="mt-1 text-xl font-semibold">{card.value}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{card.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {hasErrors ? (
        <Card>
          <CardContent className="py-4 space-y-1 text-sm text-rose-700">
            {groupsErr ? <div>Open groups failed to load: {groupsErr.message}</div> : null}
            {eventsErr ? <div>Open entries failed to load: {eventsErr.message}</div> : null}
            {historyErr ? <div>History failed to load: {historyErr.message}</div> : null}
            {batchItemsErr ? <div>History item counts failed to load: {batchItemsErr.message}</div> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Open cash period</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">One open cash window since the last cash validation.</div>
        </CardHeader>
        <CardContent>
          {cashOpen ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Business range</div>
                <div className="mt-1 font-semibold">{formatRangeLabel(cashOpen)}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Entries</div>
                <div className="mt-1 font-semibold">{cashOpen.line_count}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Expected amount</div>
                <div className="mt-1 font-semibold">{formatEGP(cashOpen.expected_amount)}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Event window</div>
                <div className="mt-1 text-sm text-[hsl(var(--muted))]">{formatCairoDateTime(cashOpen.period_from)} → {formatCairoDateTime(cashOpen.period_to)}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
              No open cash period right now for the current filter.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open daily groups</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Instapay, Card, and Bank transfer stay grouped by Cairo business date.</div>
        </CardHeader>
        <CardContent>
          {!openDailyTableRows.length ? (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
              No open daily groups right now for the current filter.
            </div>
          ) : null}
          <Table columns={openDailyColumns} rows={openDailyTableRows as any} keyField="id" stickyTopClassName="top-0" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest open entries</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Latest 100 unreconciled income lines to inspect before write actions are added in the next lot.</div>
        </CardHeader>
        <CardContent>
          {!openEventsTableRows.length ? (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
              No open entries right now for the current filter.
            </div>
          ) : null}
          <Table columns={openEventsColumns} rows={openEventsTableRows as any} keyField="id" stickyTopClassName="top-0" />
          <div className="mt-3 text-xs text-[hsl(var(--muted))]">
            Showing the latest 100 open lines{filterQS ? ` for ${labelMethod(methodFilter)}` : ''}. The future validation action will consume these lines into a batch without editing the source records.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent validation history</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Read-only list of the latest non-deleted validation batches.</div>
        </CardHeader>
        <CardContent>
          {!historyTableRows.length ? (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
              No validation history yet.
            </div>
          ) : null}
          <Table columns={historyColumns} rows={historyTableRows as any} keyField="id" stickyTopClassName="top-0" />
        </CardContent>
      </Card>
    </main>
  )
}
