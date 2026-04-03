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
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { canAccessPersonalFunds } from '@/lib/rbac'

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
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
  receipt_path: string | null
  receipt_mime: string | null
  receipt_filename: string | null
  receipt_size_bytes: number | null
}

type ProfileMini = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

const PER_PAGE = 25
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024

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

function roleLabel(v?: string | null) {
  const s = (v || '').trim()
  if (!s) return 'Unknown role'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function profileDisplayName(profile?: ProfileMini | null) {
  if (!profile) return 'Unknown staff'
  const full = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  if (full) return full
  if (profile.email) return profile.email
  return 'Unknown staff'
}

function profileMetaLine(profile?: ProfileMini | null) {
  if (!profile) return 'Unknown staff'
  const role = roleLabel(profile.role)
  const email = (profile.email || '').trim()
  return email ? `${role} · ${email}` : role
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

function cashEffectBadge(kind: EntryKind) {
  if (kind === 'advance_to_gym') {
    return <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Cash in</span>
  }
  if (kind === 'reimbursement_from_gym') {
    return <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">Cash out</span>
  }
  return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">Off-cash until reimbursed</span>
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


async function uploadReceiptFile(admin: any, entryId: string, receipt: FormDataEntryValue | null) {
  if (!(receipt && typeof (receipt as any)?.arrayBuffer === 'function')) {
    return {
      receipt_path: null as string | null,
      receipt_mime: null as string | null,
      receipt_filename: null as string | null,
      receipt_size_bytes: null as number | null,
    }
  }

  const file = receipt as File
  if (file.size <= 0) {
    return {
      receipt_path: null as string | null,
      receipt_mime: null as string | null,
      receipt_filename: null as string | null,
      receipt_size_bytes: null as number | null,
    }
  }

  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error('Receipt file is too large (max 8MB).')
  }

  const mime = inferReceiptMime(file)
  if (!mime) {
    throw new Error('Receipt must be a PDF, JPG, PNG, or WEBP file.')
  }

  const safeName = normalizeFileName(file.name || 'receipt')
  const path = `personal-funds/${entryId}/${Date.now()}-${safeName}`
  const ab = await file.arrayBuffer()
  const up = await admin.storage.from('personal-fund-receipts').upload(path, ab, {
    contentType: mime,
    upsert: false,
  })

  if (up.error) {
    throw new Error(up.error.message || 'Receipt upload failed.')
  }

  return {
    receipt_path: path,
    receipt_mime: mime,
    receipt_filename: file.name || safeName,
    receipt_size_bytes: file.size,
  }
}

async function removeReceiptPath(admin: any, path: string | null | undefined) {
  const safe = String(path ?? '').trim()
  if (!safe) return
  try {
    await admin.storage.from('personal-fund-receipts').remove([safe])
  } catch {
    // best effort only
  }
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

function proofCell(entry: Pick<EntryRow, 'id' | 'receipt_path' | 'receipt_filename' | 'receipt_size_bytes'>, viewHref: string) {
  if (!entry.receipt_path) return proofBadge(entry)

  return (
    <div className="space-y-2">
      {proofBadge(entry)}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={viewHref} prefetch={false} className={actionLinkClass()}>
          View
        </Link>
        <a
          href={`/api/admin/personal-funds/${entry.id}/receipt?download=1`}
          className={actionLinkClass()}
        >
          Download
        </a>
      </div>
    </div>
  )
}

async function addPersonAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!canAccessPersonalFunds(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

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
  if (!canAccessPersonalFunds(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

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
  if (!canAccessPersonalFunds(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

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

  try {
    const uploaded = await uploadReceiptFile(admin, entryId, receipt)
    receipt_path = uploaded.receipt_path
    receipt_mime = uploaded.receipt_mime
    receipt_filename = uploaded.receipt_filename
    receipt_size_bytes = uploaded.receipt_size_bytes
  } catch (e: any) {
    redirect(withFlash(returnQS, { error: e?.message || 'Receipt upload failed.' }))
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
      updated_by: me.id,
    },
  ])

  if (error) {
    await removeReceiptPath(admin, receipt_path)
    redirect(withFlash(returnQS, { error: error.message || 'Could not save entry.' }))
  }

  redirect(withFlash(returnQS, { saved: '1' }))
}

async function updateEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!canAccessPersonalFunds(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = safeStr(formData.get('id')).trim()
  const entry_date = safeStr(formData.get('entry_date')).trim() || toISODate(new Date())
  const person_id = safeStr(formData.get('person_id')).trim()
  const kind = safeStr(formData.get('kind')).trim() as EntryKind
  const amountRaw = safeStr(formData.get('amount')).trim()
  const payment_method = safeStr(formData.get('payment_method')).trim()
  const note = safeStr(formData.get('note')).trim()
  const removeReceipt = safeStr(formData.get('remove_receipt')) === '1'
  const receipt = formData.get('receipt')

  if (!id) {
    redirect(withFlash(returnQS, { error: 'Missing entry id.' }))
  }

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
  const { data: existing, error: existingError } = await admin
    .from('personal_fund_entries')
    .select('id,receipt_path,receipt_mime,receipt_filename,receipt_size_bytes')
    .eq('id', id)
    .maybeSingle<Pick<EntryRow, 'id' | 'receipt_path' | 'receipt_mime' | 'receipt_filename' | 'receipt_size_bytes'>>()

  if (existingError || !existing) {
    redirect(withFlash(returnQS, { error: existingError?.message || 'Entry not found.' }))
  }

  let receipt_path: string | null = existing.receipt_path
  let receipt_mime: string | null = existing.receipt_mime
  let receipt_filename: string | null = existing.receipt_filename
  let receipt_size_bytes: number | null = existing.receipt_size_bytes
  let uploadedNewPath: string | null = null

  try {
    const uploaded = await uploadReceiptFile(admin, id, receipt)
    if (uploaded.receipt_path) {
      uploadedNewPath = uploaded.receipt_path
      receipt_path = uploaded.receipt_path
      receipt_mime = uploaded.receipt_mime
      receipt_filename = uploaded.receipt_filename
      receipt_size_bytes = uploaded.receipt_size_bytes
    } else if (removeReceipt) {
      receipt_path = null
      receipt_mime = null
      receipt_filename = null
      receipt_size_bytes = null
    }
  } catch (e: any) {
    redirect(withFlash(returnQS, { error: e?.message || 'Receipt upload failed.' }))
  }

  const { error } = await admin
    .from('personal_fund_entries')
    .update({
      entry_date,
      person_id,
      kind,
      amount,
      payment_method,
      note: note || null,
      updated_by: me.id,
      receipt_path,
      receipt_mime,
      receipt_filename,
      receipt_size_bytes,
    })
    .eq('id', id)

  if (error) {
    await removeReceiptPath(admin, uploadedNewPath)
    redirect(withFlash(returnQS, { error: error.message || 'Could not update entry.' }))
  }

  if (uploadedNewPath && existing.receipt_path && existing.receipt_path !== uploadedNewPath) {
    await removeReceiptPath(admin, existing.receipt_path)
  } else if (!uploadedNewPath && removeReceipt && existing.receipt_path) {
    await removeReceiptPath(admin, existing.receipt_path)
  }

  redirect(withFlash(returnQS, { updated: '1' }))
}

async function deleteEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')
  if (!canAccessPersonalFunds(me.role)) redirect('/admin/personal-funds?error=Access%20denied')

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

  await removeReceiptPath(admin, beforeDelete?.receipt_path)

  redirect(withFlash(returnQS, { deleted: '1' }))
}

export default async function PersonalFundsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/personal-funds')

  if (!canAccessPersonalFunds(me.role)) {
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
  const updated = safeStr(searchParams.updated)
  const deleted = safeStr(searchParams.deleted)
  const errorMsg = safeStr(searchParams.error)
  const editId = safeStr(searchParams.edit).trim()
  const previewId = safeStr(searchParams.preview).trim()

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
      'id,entry_date,person_id,kind,amount,payment_method,note,created_at,created_by,updated_at,updated_by,receipt_path,receipt_mime,receipt_filename,receipt_size_bytes',
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

  let editEntry: EntryRow | null = null
  let editLoadError = ''
  if (editId) {
    const { data, error } = await admin
      .from('personal_fund_entries')
      .select('id,entry_date,person_id,kind,amount,payment_method,note,created_at,created_by,updated_at,updated_by,receipt_path,receipt_mime,receipt_filename,receipt_size_bytes')
      .eq('id', editId)
      .maybeSingle<EntryRow>()

    if (error || !data) {
      editLoadError = error?.message || 'Could not load the selected entry for editing.'
    } else {
      editEntry = data
    }
  }

  let previewEntry: EntryRow | null = null
  let previewLoadError = ''
  if (previewId) {
    const local = entries.find((entry) => entry.id === previewId)
    if (local) {
      previewEntry = local
    } else {
      const { data, error } = await admin
        .from('personal_fund_entries')
        .select('id,entry_date,person_id,kind,amount,payment_method,note,created_at,created_by,updated_at,updated_by,receipt_path,receipt_mime,receipt_filename,receipt_size_bytes')
        .eq('id', previewId)
        .maybeSingle<EntryRow>()

      if (error || !data) {
        previewLoadError = error?.message || 'Could not load the selected receipt preview.'
      } else {
        previewEntry = data
      }
    }
  }

  const profileIds = Array.from(new Set([
    ...entries.map((entry) => entry.created_by).filter(Boolean),
    ...entries.map((entry) => entry.updated_by).filter(Boolean),
    editEntry?.created_by || '',
    editEntry?.updated_by || '',
    previewEntry?.created_by || '',
    previewEntry?.updated_by || '',
  ].filter(Boolean))) as string[]

  let profileById = new Map<string, ProfileMini>()
  if (profileIds.length > 0) {
    const { data: profileRows } = await admin
      .from('profiles')
      .select('user_id,role,first_name,last_name,email')
      .in('user_id', profileIds)

    profileById = new Map(((profileRows ?? []) as ProfileMini[]).map((profile) => [profile.user_id, profile]))
  }

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

  const returnParams = Object.fromEntries(new URLSearchParams(returnQS).entries())
  const closePreviewHref = `/admin/personal-funds?${buildQS({ ...returnParams, page: String(page), edit: editEntry?.id ?? '' })}`
  const editPersonLabel = editEntry ? personById.get(editEntry.person_id)?.label ?? 'Unknown person' : ''
  const editingInCurrentPage = editEntry ? entries.some((entry) => entry.id === editEntry?.id) : false

  const entryCards = entries.map((entry) => {
    const personLabel = personById.get(entry.person_id)?.label ?? 'Unknown person'
    const createdLabel = new Date(entry.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })
    const updatedLabel = entry.updated_at ? new Date(entry.updated_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }) : ''
    const creatorProfile = entry.created_by ? profileById.get(entry.created_by) : null
    const updaterProfile = entry.updated_by ? profileById.get(entry.updated_by) : null
    const isEditing = editEntry?.id === entry.id

    return {
      id: entry.id,
      personLabel,
      createdLabel,
      isEditing,
      node: (
        <div key={entry.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
                <span>{entry.entry_date}</span>
                {kindBadge(entry.kind)}
                {cashEffectBadge(entry.kind)}
              </div>
              <div className="text-base font-semibold">{personLabel}</div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Amount</div>
              <div className="text-lg font-semibold leading-none">{formatEGP(Number(entry.amount ?? 0))}</div>
              <div className="mt-2">{balanceImpact(entry.kind, Number(entry.amount ?? 0))}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Payment</div>
              <div className="mt-1 text-sm font-medium">{paymentLabel(entry.payment_method)}</div>
            </div>
            <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Recorded by</div>
              <div className="mt-1 text-sm font-medium">{profileDisplayName(creatorProfile)}</div>
              <div className="text-xs text-[hsl(var(--muted))]">{createdLabel}</div>
            </div>
            <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Last update</div>
              <div className="mt-1 text-sm font-medium">{entry.updated_by ? profileDisplayName(updaterProfile) : '—'}</div>
              <div className="text-xs text-[hsl(var(--muted))]">{updatedLabel || 'No edits yet'}</div>
            </div>
            <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Proof</div>
              <div className="mt-1">{proofBadge(entry)}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="rounded-xl border border-[hsl(var(--border))] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Note</div>
              <div className="mt-1 text-sm break-words">{entry.note || '—'}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {entry.receipt_path ? (
                <>
                  <Link href={`/admin/personal-funds?${buildQS({ ...returnParams, page: String(page), edit: editEntry?.id ?? '', preview: entry.id })}`} prefetch={false} className={actionLinkClass()}>
                    View
                  </Link>
                  <a href={`/api/admin/personal-funds/${entry.id}/receipt?download=1`} className={actionLinkClass()}>
                    Download
                  </a>
                </>
              ) : null}
              <Link
                prefetch={false}
                href={`/admin/personal-funds?${buildQS({ ...returnParams, edit: entry.id })}`}
                className={actionLinkClass()}
              >
                {isEditing ? 'Editing' : 'Edit'}
              </Link>
              <form action={deleteEntryAction}>
                <input type="hidden" name="id" value={entry.id} />
                <input type="hidden" name="return_qs" value={returnQS} />
                <Button variant="outline" size="sm" type="submit">
                  Delete
                </Button>
              </form>
            </div>
          </div>
        </div>
      ),
    }
  })

  return (
    <main>
      <PageHeader
        title="Personal Funds"
        subtitle="Track advances, personal expenses, reimbursements, and private proof."
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
        {updated === '1' ? (
          <InlineAlert variant="success" title="Personal Funds">
            Entry updated.
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
        {editId && editLoadError ? (
          <InlineAlert variant="warning" title="Edit entry">
            {editLoadError}
          </InlineAlert>
        ) : null}

        <InlineAlert variant="info" title="Balance rules">
          <div className="space-y-1">
            <div><strong>Advance</strong> and <strong>Personal expense</strong> increase what the gym owes.</div>
            <div><strong>Reimbursement</strong> decreases what the gym owes.</div>
            <div><strong>Cash Report:</strong> Advance = cash in, Reimbursement = cash out, Personal expense = off-cash until reimbursed.</div>
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

                  <Select label="Person" name="person_id" defaultValue={''} disabled={people.length === 0}>
                    <option value="">Choose person</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>{person.label}</option>
                    ))}
                  </Select>

                  <Select label="Type" name="kind" defaultValue={'advance_to_gym'} disabled={people.length === 0}>
                    <option value="advance_to_gym">Advance to gym</option>
                    <option value="expense_paid_personally">Expense paid personally</option>
                    <option value="reimbursement_from_gym">Reimbursement from gym</option>
                  </Select>

                  <Input label="Amount (EGP)" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" defaultValue={''} disabled={people.length === 0} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Select label="Payment method" name="payment_method" defaultValue={'cash'} disabled={people.length === 0}>
                    <option value="cash">Cash</option>
                    <option value="visa">Visa card</option>
                    <option value="instapay">Instapay</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </Select>
                  <Input
                    label={'Receipt / invoice'}
                    name="receipt"
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    hint={'Optional proof. Accepted: PDF, JPG, PNG, WEBP. Max 8MB.'}
                    disabled={people.length === 0}
                    className="file:mr-3 file:rounded-xl file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                </div>

                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                  <div><strong className="text-[hsl(var(--fg))]">Cash Report effect:</strong> Advance to gym = cash in, Reimbursement from gym = cash out, Expense paid personally = off-cash until reimbursed.</div>
                </div>

                                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Note</span>
                  <textarea
                    name="note"
                    rows={3}
                    defaultValue={''}
                    placeholder="Optional details: what was paid, partial reimbursement, reference..."
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
                    disabled={people.length === 0}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={people.length === 0}>Add entry</Button>
                  <div className="text-xs text-[hsl(var(--muted))]">Editing and receipt replacement stay inside Personal Funds.</div>
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
                  <Input name="label" placeholder="e.g. Shawki" />
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
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm">
                          <div className="text-[11px] text-[hsl(var(--muted))]">Outstanding</div>
                          <div className="mt-1 font-semibold">{formatEGP(person.outstanding)}</div>
                        </div>
                        <div className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm">
                          <div className="text-[11px] text-[hsl(var(--muted))]">Advanced + personal</div>
                          <div className="mt-1 font-semibold">{formatEGP(person.advanced + person.paidPersonally)}</div>
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
            <div className="text-sm text-[hsl(var(--muted))]">Focus the view before reviewing personal balances and proof.</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="get" className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Quick range</div>
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
                <Button type="submit">Apply filters</Button>
                <Button asChild variant="outline" href="/admin/personal-funds?preset=90d">
                  Reset filters
                </Button>
                <div className="text-xs text-[hsl(var(--muted))]">Top totals stay all time.</div>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Current view</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeFilters.length > 0 ? activeFilters.map((item) => (
                    <span key={item} className="inline-flex rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs text-[hsl(var(--muted))]">
                      {item}
                    </span>
                  )) : <span className="text-sm text-[hsl(var(--muted))]">Last 90 days / All people / All types</span>}
                </div>
              </div>

              {activeFilters.length > 0 ? (
                <div className="hidden flex-wrap gap-2">
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
              <div className="text-[hsl(var(--muted))]">Showing {entries.length} of {count ?? 0}</div>
              <div className="text-[hsl(var(--muted))]">Page {Math.min(page, totalPages)} of {totalPages}</div>
            </div>

            {entryCards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
                No entries for the current filters.
              </div>
            ) : (
              <div className="space-y-3">{entryCards.map((entry) => entry.node)}</div>
            )}

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


        {editEntry ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6">
            <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Edit entry</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {editPersonLabel} · {kindLabel(editEntry.kind)} · {formatEGP(Number(editEntry.amount ?? 0))}
                  </div>
                  {!editingInCurrentPage ? (
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Loaded from storage outside the current page.</div>
                  ) : null}
                </div>
                <Link href={`/admin/personal-funds?${returnQS}`} prefetch={false} className={actionLinkClass()}>
                  Close
                </Link>
              </div>

              <div className="max-h-[calc(92vh-84px)] overflow-auto p-4 sm:p-6">
                <form action={updateEntryAction} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <input type="hidden" name="return_qs" value={returnQS} />
                  <input type="hidden" name="id" value={editEntry.id} />

                  <div className="space-y-4">
                    {editEntry.receipt_path ? (
                      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm">
                        <div className="font-medium">Current receipt</div>
                        <div className="mt-1 break-all text-[hsl(var(--muted))]">
                          {editEntry.receipt_filename || 'receipt'}{editEntry.receipt_size_bytes ? ` · ${formatBytes(editEntry.receipt_size_bytes)}` : ''}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Link href={`/admin/personal-funds?${buildQS({ ...returnParams, page: String(page), edit: editEntry.id, preview: editEntry.id })}`} prefetch={false} className={actionLinkClass()}>
                            View current receipt
                          </Link>
                          <a href={`/api/admin/personal-funds/${editEntry.id}/receipt?download=1`} className={actionLinkClass()}>
                            Download
                          </a>
                        </div>
                      </div>
                    ) : (
                      <InlineAlert variant="info" title="Current receipt">
                        No receipt attached yet.
                      </InlineAlert>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <Input label="Date" name="entry_date" type="date" defaultValue={editEntry.entry_date} />

                      <Select label="Person" name="person_id" defaultValue={editEntry.person_id} disabled={people.length === 0}>
                        <option value="">Choose person</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>{person.label}</option>
                        ))}
                      </Select>

                      <Select label="Type" name="kind" defaultValue={editEntry.kind} disabled={people.length === 0}>
                        <option value="advance_to_gym">Advance to gym</option>
                        <option value="expense_paid_personally">Expense paid personally</option>
                        <option value="reimbursement_from_gym">Reimbursement from gym</option>
                      </Select>

                      <Input label="Amount (EGP)" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" defaultValue={String(editEntry.amount)} disabled={people.length === 0} />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <Select label="Payment method" name="payment_method" defaultValue={editEntry.payment_method ?? 'cash'} disabled={people.length === 0}>
                        <option value="cash">Cash</option>
                        <option value="visa">Visa card</option>
                        <option value="instapay">Instapay</option>
                        <option value="bank_transfer">Bank transfer</option>
                      </Select>

                      <Input
                        label={editEntry.receipt_path ? 'Replace receipt / invoice' : 'Receipt / invoice'}
                        name="receipt"
                        type="file"
                        accept=".pdf,image/jpeg,image/png,image/webp"
                        hint={editEntry.receipt_path ? 'Optional replacement. Max 8MB.' : 'Optional proof. PDF, JPG, PNG, WEBP. Max 8MB.'}
                        disabled={people.length === 0}
                        className="file:mr-3 file:rounded-xl file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                      />
                    </div>

                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                      <strong className="text-[hsl(var(--fg))]">Cash Report:</strong> Advance = cash in, Reimbursement = cash out, Personal expense = off-cash until reimbursed.
                    </div>

                    {editEntry.receipt_path ? (
                      <label className="flex items-start gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 text-sm">
                        <input type="checkbox" name="remove_receipt" value="1" className="mt-0.5" />
                        <span>Remove current receipt if you do not upload a replacement.</span>
                      </label>
                    ) : null}

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Note</span>
                      <textarea
                        name="note"
                        rows={3}
                        defaultValue={editEntry.note ?? ''}
                        placeholder="Optional details: what was paid, partial reimbursement, reference..."
                        className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
                        disabled={people.length === 0}
                      />
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" disabled={people.length === 0}>Save changes</Button>
                      <Button asChild variant="outline" href={`/admin/personal-funds?${returnQS}`}>
                        Cancel
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Recorded by</div>
                        <div className="mt-1 font-medium">{profileDisplayName(editEntry.created_by ? profileById.get(editEntry.created_by) : null)}</div>
                        <div className="text-xs text-[hsl(var(--muted))]">{profileMetaLine(editEntry.created_by ? profileById.get(editEntry.created_by) : null)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Last update</div>
                        <div className="mt-1 font-medium">{editEntry.updated_at ? new Date(editEntry.updated_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }) : '—'}</div>
                        <div className="text-xs text-[hsl(var(--muted))]">{editEntry.updated_by ? profileDisplayName(profileById.get(editEntry.updated_by) ?? null) : 'No edits yet'}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                      Admin and super admin can edit or delete any stored entry.
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : null}

        {previewId ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6">
            <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Receipt preview</div>
                  {previewEntry ? (
                    <div className="mt-1 text-sm text-[hsl(var(--muted))] break-all">
                      {previewEntry.receipt_filename || 'receipt'}
                      {previewEntry.receipt_size_bytes ? ` · ${formatBytes(previewEntry.receipt_size_bytes)}` : ''}
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">Loading preview…</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {previewEntry?.receipt_path ? (
                    <a href={`/api/admin/personal-funds/${previewEntry.id}/receipt?download=1`} className={actionLinkClass()}>
                      Download
                    </a>
                  ) : null}
                  <Link href={closePreviewHref} prefetch={false} className={actionLinkClass()}>
                    Close
                  </Link>
                </div>
              </div>

              <div className="max-h-[calc(92vh-84px)] overflow-auto bg-[hsl(var(--bg))] p-3 sm:p-4">
                {previewLoadError ? (
                  <InlineAlert variant="error" title="Receipt preview">
                    {previewLoadError}
                  </InlineAlert>
                ) : !previewEntry?.receipt_path ? (
                  <InlineAlert variant="warning" title="Receipt preview">
                    No receipt is attached to this entry.
                  </InlineAlert>
                ) : previewEntry.receipt_mime === 'application/pdf' ? (
                  <iframe
                    title="Receipt preview"
                    src={`/api/admin/personal-funds/${previewEntry.id}/receipt`}
                    className="h-[75vh] w-full rounded-2xl border border-[hsl(var(--border))] bg-white"
                  />
                ) : (previewEntry.receipt_mime || '').startsWith('image/') ? (
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/admin/personal-funds/${previewEntry.id}/receipt`}
                      alt={previewEntry.receipt_filename || 'Receipt preview'}
                      className="mx-auto max-h-[75vh] w-auto max-w-full rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <InlineAlert variant="info" title="Preview not supported inline">
                      This file type cannot be previewed directly here. Use Download instead.
                    </InlineAlert>
                    <a href={`/api/admin/personal-funds/${previewEntry.id}/receipt?download=1`} className={actionLinkClass()}>
                      Download file
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Section>
    </main>
  )
}
