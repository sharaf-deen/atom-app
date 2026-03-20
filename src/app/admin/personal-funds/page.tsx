export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { randomUUID } from 'crypto'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import { Table } from '@/components/ui/Table'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type EntryKind = 'advance_to_gym' | 'expense_paid_personally' | 'reimbursement_from_gym'
type RangePreset = '30d' | '90d' | 'year' | 'all' | 'custom'

type PersonRow = {
  id: string
  label: string
  is_active: boolean
  sort_order: number
}

type EntryRow = {
  id: string
  entry_date: string
  person_id: string
  kind: EntryKind
  amount: number
  payment_method: string | null
  note: string | null
  created_at: string
  receipt_path: string | null
  receipt_mime: string | null
  receipt_filename: string | null
  receipt_size_bytes: number | null
}

const PER_PAGE = 25
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024

function isAdmin(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

function safeStr(v: unknown) {
  return typeof v === 'string' ? v : ''
}

function parsePositiveInt(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parsePreset(v: unknown): RangePreset {
  return v === '30d' || v === '90d' || v === 'year' || v === 'all' || v === 'custom' ? v : '90d'
}

function parseKind(v: unknown): EntryKind | 'all' {
  return v === 'advance_to_gym' || v === 'expense_paid_personally' || v === 'reimbursement_from_gym' ? v : 'all'
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

function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1)
}

function sanitizeSearch(v: string) {
  return (v || '').replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildQS(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) sp.set(k, String(v))
  }
  return sp.toString()
}

function withFlash(returnQS: string, params: Record<string, string>) {
  const sp = new URLSearchParams(returnQS)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) sp.set(k, String(v))
  }
  const qs = sp.toString()
  return `/admin/personal-funds${qs ? `?${qs}` : ''}`
}

function formatEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(safe)
}

function formatBytes(n?: number | null) {
  const size = Number(n ?? 0)
  if (!Number.isFinite(size) || size <= 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function paymentLabel(v?: string | null) {
  const s = (v || '').trim()
  if (!s) return '—'
  if (s === 'cash') return 'Cash'
  if (s === 'visa') return 'Visa card'
  if (s === 'instapay') return 'Instapay'
  if (s === 'bank_transfer') return 'Bank transfer'
  return s.replace(/_/g, ' ')
}

function kindLabel(kind: EntryKind) {
  if (kind === 'advance_to_gym') return 'Advance to gym'
  if (kind === 'expense_paid_personally') return 'Expense paid personally'
  return 'Reimbursement from gym'
}

function kindBadge(kind: EntryKind) {
  if (kind === 'advance_to_gym') {
    return <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Advance</span>
  }
  if (kind === 'expense_paid_personally') {
    return <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">Personal expense</span>
  }
  return <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Reimbursement</span>
}

function balanceImpact(kind: EntryKind, amount: number) {
  if (kind === 'reimbursement_from_gym') {
    return <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Gym repaid {formatEGP(amount)}</span>
  }
  return <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Gym owes {formatEGP(amount)}</span>
}

function actionLinkClass() {
  return 'inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm shadow-soft transition hover:bg-[hsl(var(--bg))]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]'
}

function normalizeFileName(name: string) {
  return (name || 'receipt').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function inferReceiptMime(file: File) {
  const typed = (file.type || '').toLowerCase()
  if (typed === 'application/pdf' || typed === 'image/jpeg' || typed === 'image/png' || typed === 'image/webp') return typed

  const lower = (file.name || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return ''
}

function proofBadge(entry: Pick<EntryRow, 'receipt_path' | 'receipt_filename' | 'receipt_size_bytes'>) {
  if (!entry.receipt_path) {
    return <span className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--muted))]">No receipt</span>
  }

  return (
    <div className="space-y-1">
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Receipt attached</span>
      <div className="text-xs text-[hsl(var(--muted))] break-all">
        {entry.receipt_filename || 'receipt'}{entry.receipt_size_bytes ? ` · ${formatBytes(entry.receipt_size_bytes)}` : ''}
      </div>
    </div>
  )
}

async function addPersonAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!isAdmin(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const label = safeStr(formData.get('label')).trim()

  if (!label) {
    redirect(withFlash(returnQS, { error: 'Please enter a person name.' }))
  }

  const admin = getSupabaseAdminClientCached()
  const { error } = await admin.from('personal_fund_people').insert([
    {
      label,
      created_by: me.id,
    },
  ])

  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? 'This person already exists.' : error.message || 'Could not add person.'
    redirect(withFlash(returnQS, { error: msg }))
  }

  redirect(withFlash(returnQS, { person_added: '1' }))
}

async function deletePersonAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!isAdmin(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const personId = safeStr(formData.get('person_id')).trim()

  if (!personId) {
    redirect(withFlash(returnQS, { error: 'Missing person id.' }))
  }

  const admin = getSupabaseAdminClientCached()
  const linked = await admin
    .from('personal_fund_entries')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId)

  if ((linked.count ?? 0) > 0) {
    redirect(withFlash(returnQS, { error: 'This person already has entries and cannot be deleted.' }))
  }

  const { error } = await admin.from('personal_fund_people').delete().eq('id', personId)
  if (error) {
    redirect(withFlash(returnQS, { error: error.message || 'Could not delete person.' }))
  }

  redirect(withFlash(returnQS, { person_deleted: '1' }))
}

async function addEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!isAdmin(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const entry_date = safeStr(formData.get('entry_date')).trim() || toISODate(new Date())
  const person_id = safeStr(formData.get('person_id')).trim()
  const kind = safeStr(formData.get('kind')).trim() as EntryKind
  const amountRaw = safeStr(formData.get('amount')).trim()
  const payment_method = safeStr(formData.get('payment_method')).trim()
  const note = safeStr(formData.get('note')).trim()
  const receipt = formData.get('receipt')

  if (!person_id) {
    redirect(withFlash(returnQS, { error: 'Please choose a person.' }))
  }

  if (!['advance_to_gym', 'expense_paid_personally', 'reimbursement_from_gym'].includes(kind)) {
    redirect(withFlash(returnQS, { error: 'Please choose a valid entry type.' }))
  }

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(withFlash(returnQS, { error: 'Amount must be greater than 0.' }))
  }

  const allowedMethods = new Set(['cash', 'visa', 'instapay', 'bank_transfer'])
  if (!allowedMethods.has(payment_method)) {
    redirect(withFlash(returnQS, { error: 'Please choose a payment method.' }))
  }

  const admin = getSupabaseAdminClientCached()
  const entryId = randomUUID()

  let receipt_path: string | null = null
  let receipt_mime: string | null = null
  let receipt_filename: string | null = null
  let receipt_size_bytes: number | null = null

  if (receipt && typeof (receipt as any)?.arrayBuffer === 'function') {
    const file = receipt as File
    if (file.size > 0) {
      if (file.size > RECEIPT_MAX_BYTES) {
        redirect(withFlash(returnQS, { error: 'Receipt file is too large (max 8MB).' }))
      }

      const mime = inferReceiptMime(file)
      if (!mime) {
        redirect(withFlash(returnQS, { error: 'Receipt must be a PDF, JPG, PNG, or WEBP file.' }))
      }

      const safeName = normalizeFileName(file.name || 'receipt')
      const path = `personal-funds/${entryId}/${safeName}`
      const ab = await file.arrayBuffer()
      const up = await admin.storage.from('personal-fund-receipts').upload(path, ab, {
        contentType: mime,
        upsert: false,
      })

      if (up.error) {
        redirect(withFlash(returnQS, { error: up.error.message || 'Receipt upload failed.' }))
      }

      receipt_path = path
      receipt_mime = mime
      receipt_filename = file.name || safeName
      receipt_size_bytes = file.size
    }
  }

  const { error } = await admin.from('personal_fund_entries').insert([
    {
      id: entryId,
      entry_date,
      person_id,
      kind,
      amount,
      payment_method,
      note: note || null,
      receipt_path,
      receipt_mime,
      receipt_filename,
      receipt_size_bytes,
      created_by: me.id,
    },
  ])

  if (error) {
    if (receipt_path) {
      try {
        await admin.storage.from('personal-fund-receipts').remove([receipt_path])
      } catch {
        // best effort only
      }
    }
    redirect(withFlash(returnQS, { error: error.message || 'Could not save entry.' }))
  }

  redirect(withFlash(returnQS, { saved: '1' }))
}

async function deleteEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!isAdmin(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = safeStr(formData.get('id')).trim()

  if (!id) {
    redirect(withFlash(returnQS, { error: 'Missing entry id.' }))
  }

  const admin = getSupabaseAdminClientCached()
  const { data: beforeDelete } = await admin
    .from('personal_fund_entries')
    .select('receipt_path')
    .eq('id', id)
    .maybeSingle<{ receipt_path: string | null }>()

  const { error } = await admin.from('personal_fund_entries').delete().eq('id', id)

  if (error) {
    redirect(withFlash(returnQS, { error: error.message || 'Could not delete entry.' }))
  }

  const receiptPath = String(beforeDelete?.receipt_path ?? '').trim()
  if (receiptPath) {
    try {
      await admin.storage.from('personal-fund-receipts').remove([receiptPath])
    } catch {
      // best effort only
    }
  }

  redirect(withFlash(returnQS, { deleted: '1' }))
}

export default async function PersonalFundsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')

  if (!isAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Personal Funds"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can access personal funds."
        allowed="admin, super_admin"
        nextPath="/admin/personal-funds"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()
  const now = new Date()
  const today = toISODate(now)
  const preset = parsePreset(typeof searchParams.preset === 'string' ? searchParams.preset : '90d')

  let from = safeStr(searchParams.from)
  let to = safeStr(searchParams.to)

  if (preset === '30d') {
    to = today
    from = toISODate(addDays(now, -29))
  } else if (preset === '90d') {
    to = today
    from = toISODate(addDays(now, -89))
  } else if (preset === 'year') {
    from = toISODate(startOfYear(now))
    to = today
  } else if (preset === 'all') {
    from = ''
    to = ''
  } else {
    if (!from) from = toISODate(addDays(now, -89))
    if (!to) to = today
  }

  const personFilter = typeof searchParams.person_id === 'string' ? searchParams.person_id : 'all'
  const kindFilter = parseKind(typeof searchParams.kind === 'string' ? searchParams.kind : 'all')
  const qRaw = typeof searchParams.q === 'string' ? searchParams.q : ''
  const qText = sanitizeSearch(qRaw)
  const page = parsePositiveInt(searchParams.page, 1)
  const offset = (page - 1) * PER_PAGE

  const personAdded = safeStr(searchParams.person_added)
  const personDeleted = safeStr(searchParams.person_deleted)
  const saved = safeStr(searchParams.saved)
  const deleted = safeStr(searchParams.deleted)
  const errorMsg = safeStr(searchParams.error)

  const returnQS = buildQS({
    preset,
    from,
    to,
    person_id: personFilter !== 'all' ? personFilter : '',
    kind: kindFilter !== 'all' ? kindFilter : '',
    q: qText,
  })

  const { data: rawPeople, error: peopleError } = await admin
    .from('personal_fund_people')
    .select('id,label,is_active,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  const people = (rawPeople ?? []) as PersonRow[]
  const personById = new Map(people.map((p) => [p.id, p]))
  const selectedPersonLabel = personById.get(personFilter)?.label ?? 'All people'

  const { data: summaryData, error: summaryError } = await admin
    .from('personal_fund_entries')
    .select('person_id,kind,amount')
    .limit(10000)

  const summaryRows = (summaryData ?? []) as Array<{ person_id: string; kind: EntryKind; amount: number }>

  let totalAdvanced = 0
  let totalPaidPersonally = 0
  let totalReimbursed = 0
  const perPerson = new Map<string, { advanced: number; paidPersonally: number; reimbursed: number; entries: number }>()

  for (const row of summaryRows) {
    const bucket = perPerson.get(row.person_id) ?? { advanced: 0, paidPersonally: 0, reimbursed: 0, entries: 0 }
    bucket.entries += 1
    if (row.kind === 'advance_to_gym') {
      totalAdvanced += Number(row.amount ?? 0)
      bucket.advanced += Number(row.amount ?? 0)
    } else if (row.kind === 'expense_paid_personally') {
      totalPaidPersonally += Number(row.amount ?? 0)
      bucket.paidPersonally += Number(row.amount ?? 0)
    } else {
      totalReimbursed += Number(row.amount ?? 0)
      bucket.reimbursed += Number(row.amount ?? 0)
    }
    perPerson.set(row.person_id, bucket)
  }

  const overallOutstanding = totalAdvanced + totalPaidPersonally - totalReimbursed

  let entriesQuery = admin
    .from('personal_fund_entries')
    .select(
      'id,entry_date,person_id,kind,amount,payment_method,note,created_at,receipt_path,receipt_mime,receipt_filename,receipt_size_bytes',
      { count: 'exact' }
    )
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (from) entriesQuery = entriesQuery.gte('entry_date', from)
  if (to) entriesQuery = entriesQuery.lte('entry_date', to)
  if (personFilter !== 'all') entriesQuery = entriesQuery.eq('person_id', personFilter)
  if (kindFilter !== 'all') entriesQuery = entriesQuery.eq('kind', kindFilter)
  if (qText) {
    const matchingPeople = people.filter((p) => p.label.toLowerCase().includes(qText.toLowerCase())).map((p) => p.id)
    const ors = [`note.ilike.%${qText}%`, `receipt_filename.ilike.%${qText}%`]
    if (matchingPeople.length > 0) ors.push(`person_id.in.(${matchingPeople.join(',')})`)
    entriesQuery = entriesQuery.or(ors.join(','))
  }

  const { data: rawEntries, error: entriesError, count } = await entriesQuery.range(offset, offset + PER_PAGE - 1)
  const entries = (rawEntries ?? []) as EntryRow[]
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE))

  const personCards = people
    .map((person) => {
      const bucket = perPerson.get(person.id) ?? { advanced: 0, paidPersonally: 0, reimbursed: 0, entries: 0 }
      const outstanding = bucket.advanced + bucket.paidPersonally - bucket.reimbursed
      return {
        ...person,
        outstanding,
        entriesCount: bucket.entries,
        advanced: bucket.advanced,
        paidPersonally: bucket.paidPersonally,
        reimbursed: bucket.reimbursed,
      }
    })
    .sort((a, b) => {
      if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding
      return a.label.localeCompare(b.label)
    })

  const activeFilters = [
    from && to ? `${from} → ${to}` : preset === 'all' ? 'All dates' : '',
    personFilter !== 'all' ? selectedPersonLabel : '',
    kindFilter !== 'all' ? kindLabel(kindFilter) : '',
    qText ? `Search: ${qText}` : '',
  ].filter(Boolean)

  const tableColumns = [
    { key: 'date', header: 'Date' },
    { key: 'person', header: 'Person' },
    { key: 'type', header: 'Type' },
    { key: 'impact', header: 'Balance impact' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method', hideOnMobile: true },
    { key: 'proof', header: 'Proof' },
    { key: 'note', header: 'Note' },
    { key: 'created', header: 'Recorded', hideOnMobile: true },
    { key: 'actions', header: '' },
  ]

  const tableRows = entries.map((entry) => ({
    id: entry.id,
    date: entry.entry_date,
    person: personById.get(entry.person_id)?.label ?? 'Unknown person',
    type: kindBadge(entry.kind),
    impact: balanceImpact(entry.kind, Number(entry.amount ?? 0)),
    amount: formatEGP(Number(entry.amount ?? 0)),
    method: paymentLabel(entry.payment_method),
    proof: proofBadge(entry),
    note: entry.note || '—',
    created: new Date(entry.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }),
    actions: (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {entry.receipt_path ? (
          <>
            <a
              href={`/api/admin/personal-funds/${entry.id}/receipt`}
              target="_blank"
              rel="noreferrer"
              className={actionLinkClass()}
            >
              View
            </a>
            <a
              href={`/api/admin/personal-funds/${entry.id}/receipt?download=1`}
              className={actionLinkClass()}
            >
              Download
            </a>
          </>
        ) : null}
        <form action={deleteEntryAction}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="return_qs" value={returnQS} />
          <Button variant="outline" size="sm" type="submit">
            Delete
          </Button>
        </form>
      </div>
    ),
  }))

  return (
    <main>
      <PageHeader
        title="Personal Funds"
        subtitle="Track partner advances, gym expenses paid personally, reimbursements, and attached proof. This V1.1 still stays separate from Cash Report for stability."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" href="/admin">
              Back to Admin
            </Button>
            <Button asChild variant="outline" href="/expenses">
              Expenses
            </Button>
            <Button asChild variant="outline" href="/admin/cash-report">
              Cash Report
            </Button>
          </div>
        }
      />

      <Section className="space-y-4">
        {peopleError ? (
          <InlineAlert variant="error" title="People">
            {peopleError.message}
          </InlineAlert>
        ) : null}
        {summaryError ? (
          <InlineAlert variant="error" title="Summary">
            {summaryError.message}
          </InlineAlert>
        ) : null}
        {entriesError ? (
          <InlineAlert variant="error" title="Entries">
            {entriesError.message}
          </InlineAlert>
        ) : null}
        {personAdded === '1' ? (
          <InlineAlert variant="success" title="Personal Funds">
            Person added.
          </InlineAlert>
        ) : null}
        {personDeleted === '1' ? (
          <InlineAlert variant="success" title="Personal Funds">
            Person deleted.
          </InlineAlert>
        ) : null}
        {saved === '1' ? (
          <InlineAlert variant="success" title="Personal Funds">
            Entry saved.
          </InlineAlert>
        ) : null}
        {deleted === '1' ? (
          <InlineAlert variant="success" title="Personal Funds">
            Entry deleted.
          </InlineAlert>
        ) : null}
        {errorMsg ? (
          <InlineAlert variant="error" title="Personal Funds">
            {errorMsg}
          </InlineAlert>
        ) : null}

        <InlineAlert variant="info" title="How balances work">
          <div className="space-y-1">
            <div><strong>Advance to gym</strong> and <strong>Expense paid personally</strong> increase what the gym owes to that person.</div>
            <div><strong>Reimbursement from gym</strong> decreases what the gym still owes.</div>
            <div><strong>Receipt / invoice</strong> is optional proof and stays private in storage.</div>
          </div>
        </InlineAlert>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Total advanced</div>
              <div className="mt-1 text-2xl font-semibold">{formatEGP(totalAdvanced)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">All time</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Total paid personally</div>
              <div className="mt-1 text-2xl font-semibold">{formatEGP(totalPaidPersonally)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">All time</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Total reimbursed</div>
              <div className="mt-1 text-2xl font-semibold">{formatEGP(totalReimbursed)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">All time</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Outstanding owed</div>
              <div className="mt-1 text-2xl font-semibold">{formatEGP(overallOutstanding)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">All time</div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Add entry</CardTitle>
            </CardHeader>
            <CardContent>
              {people.length === 0 ? (
                <InlineAlert variant="warning" title="No people yet">
                  Add at least one person first.
                </InlineAlert>
              ) : null}

              <form action={addEntryAction} className="space-y-4">
                <input type="hidden" name="return_qs" value={returnQS} />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Input label="Date" name="entry_date" type="date" defaultValue={today} />

                  <Select label="Person" name="person_id" defaultValue="" disabled={people.length === 0}>
                    <option value="">Choose person</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>{person.label}</option>
                    ))}
                  </Select>

                  <Select label="Type" name="kind" defaultValue="advance_to_gym" disabled={people.length === 0}>
                    <option value="advance_to_gym">Advance to gym</option>
                    <option value="expense_paid_personally">Expense paid personally</option>
                    <option value="reimbursement_from_gym">Reimbursement from gym</option>
                  </Select>

                  <Input label="Amount (EGP)" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" disabled={people.length === 0} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Select label="Payment method" name="payment_method" defaultValue="cash" disabled={people.length === 0}>
                    <option value="cash">Cash</option>
                    <option value="visa">Visa card</option>
                    <option value="instapay">Instapay</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </Select>
                  <Input
                    label="Receipt / invoice"
                    name="receipt"
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    hint="Optional proof. Accepted: PDF, JPG, PNG, WEBP. Max 8MB."
                    disabled={people.length === 0}
                    className="file:mr-3 file:rounded-xl file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                </div>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Note</span>
                  <textarea
                    name="note"
                    rows={3}
                    placeholder="Optional details: what was paid, partial reimbursement, reference..."
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
                    disabled={people.length === 0}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={people.length === 0}>Add entry</Button>
                  <div className="text-xs text-[hsl(var(--muted))]">This V1.1 records personal-funds movements and optional proof only. It does not change Cash Report yet.</div>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>People</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={addPersonAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <input type="hidden" name="return_qs" value={returnQS} />
                <div className="min-w-0 flex-1">
                  <Input label="Add person" name="label" placeholder="e.g. Charaf, Ahmed, Partner 2" />
                </div>
                <Button type="submit">Add person</Button>
              </form>

              {personCards.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
                  No people yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {personCards.map((person) => (
                    <div key={person.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{person.label}</div>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{person.entriesCount} entr{person.entriesCount === 1 ? 'y' : 'ies'}</div>
                        </div>
                        {person.entriesCount === 0 ? (
                          <form action={deletePersonAction}>
                            <input type="hidden" name="person_id" value={person.id} />
                            <input type="hidden" name="return_qs" value={returnQS} />
                            <Button type="submit" variant="outline" size="sm">Delete</Button>
                          </form>
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm">
                          <div className="text-[11px] text-[hsl(var(--muted))]">Outstanding owed</div>
                          <div className="mt-1 font-semibold">{formatEGP(person.outstanding)}</div>
                        </div>
                        <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm">
                          <div className="text-[11px] text-[hsl(var(--muted))]">Reimbursed</div>
                          <div className="mt-1 font-semibold">{formatEGP(person.reimbursed)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Link prefetch={false} href="/admin/personal-funds?preset=30d" className={`rounded-full border px-3 py-1.5 text-sm ${preset === '30d' ? 'bg-black text-white border-black' : 'bg-white hover:bg-gray-50'}`}>
                  Last 30 days
                </Link>
                <Link prefetch={false} href="/admin/personal-funds?preset=90d" className={`rounded-full border px-3 py-1.5 text-sm ${preset === '90d' ? 'bg-black text-white border-black' : 'bg-white hover:bg-gray-50'}`}>
                  Last 90 days
                </Link>
                <Link prefetch={false} href="/admin/personal-funds?preset=year" className={`rounded-full border px-3 py-1.5 text-sm ${preset === 'year' ? 'bg-black text-white border-black' : 'bg-white hover:bg-gray-50'}`}>
                  This year
                </Link>
                <Link prefetch={false} href="/admin/personal-funds?preset=all" className={`rounded-full border px-3 py-1.5 text-sm ${preset === 'all' ? 'bg-black text-white border-black' : 'bg-white hover:bg-gray-50'}`}>
                  All time
                </Link>
              </div>

              <input type="hidden" name="preset" value="custom" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Input label="From" name="from" type="date" defaultValue={from} />
                <Input label="To" name="to" type="date" defaultValue={to} />
                <Select label="Person" name="person_id" defaultValue={personFilter}>
                  <option value="all">All people</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{person.label}</option>
                  ))}
                </Select>
                <Select label="Type" name="kind" defaultValue={kindFilter}>
                  <option value="all">All types</option>
                  <option value="advance_to_gym">Advance to gym</option>
                  <option value="expense_paid_personally">Expense paid personally</option>
                  <option value="reimbursement_from_gym">Reimbursement from gym</option>
                </Select>
                <Input label="Search" name="q" defaultValue={qText} placeholder="Note, file name, or person" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="outline">Apply filters</Button>
                <Button asChild variant="outline" href="/admin/personal-funds?preset=90d">
                  Reset
                </Button>
                <div className="text-xs text-[hsl(var(--muted))]">Balances above stay all time. Filters apply to the entries list below.</div>
              </div>

              {activeFilters.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {activeFilters.map((item) => (
                    <span key={item} className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs text-[hsl(var(--muted))]">
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="text-[hsl(var(--muted))]">Showing {entries.length} of {count ?? 0} result(s)</div>
              <div className="text-[hsl(var(--muted))]">Page {Math.min(page, totalPages)} of {totalPages}</div>
            </div>

            <Table columns={tableColumns} rows={tableRows as any[]} keyField="id" stickyTopClassName="top-0" />

            {totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 pt-2">
                {page > 1 ? (
                  <Button asChild variant="outline" href={`/admin/personal-funds?${buildQS({ ...Object.fromEntries(new URLSearchParams(returnQS).entries()), page: String(page - 1) })}`}>
                    Previous
                  </Button>
                ) : <span />}
                {page < totalPages ? (
                  <Button asChild variant="outline" href={`/admin/personal-funds?${buildQS({ ...Object.fromEntries(new URLSearchParams(returnQS).entries()), page: String(page + 1) })}`}>
                    Next
                  </Button>
                ) : <span />}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
