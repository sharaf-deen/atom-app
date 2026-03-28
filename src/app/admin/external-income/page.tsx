export const dynamic = 'force-dynamic'
export const revalidate = 0

import { randomUUID } from 'crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import InlineAlert from '@/components/ui/InlineAlert'
import { cairoTodayDateOnly, addDaysDateOnly, formatDateTimeInCairo } from '@/lib/cairoTime'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { canAccessExternalIncome, normalizeRole, type Role } from '@/lib/rbac'

type EntrySource = 'bar' | 'store' | 'other'
type RangePreset = '30d' | '90d' | 'year' | 'all' | 'custom'

type EntryRow = {
  id: string
  entry_date: string
  source_key: EntrySource
  title: string
  amount: number
  payment_method: string | null
  note: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
  attachment_path: string | null
  attachment_mime: string | null
  attachment_filename: string | null
  attachment_size_bytes: number | null
}

type ProfileMini = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

const PER_PAGE = 20
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'visa', 'instapay', 'bank_transfer'])

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

function parseSource(v: unknown): EntrySource | 'all' {
  return v === 'bar' || v === 'store' || v === 'other' ? v : 'all'
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
  return `/admin/external-income${qs ? `?${qs}` : ''}`
}

function sanitizeSearch(v: string) {
  return (v || '').replace(/[^a-zA-Z0-9\s._-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function sourceLabel(v: EntrySource) {
  if (v === 'bar') return 'Bar'
  if (v === 'store') return 'Store'
  return 'Other'
}

function sourceBadge(v: EntrySource) {
  const cls = v === 'bar'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : v === 'store'
      ? 'border-sky-200 bg-sky-50 text-sky-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{sourceLabel(v)}</span>
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

function actionLinkClass() {
  return 'inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm shadow-soft transition hover:bg-[hsl(var(--bg))]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]'
}

function normalizeFileName(name: string) {
  return (name || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function inferAttachmentMime(file: File) {
  const typed = (file.type || '').toLowerCase()
  if (typed === 'application/pdf' || typed === 'image/jpeg' || typed === 'image/png' || typed === 'image/webp') return typed
  const lower = (file.name || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return ''
}

async function uploadAttachmentFile(admin: any, entryId: string, attachment: FormDataEntryValue | null) {
  if (!(attachment && typeof (attachment as any)?.arrayBuffer === 'function')) {
    return {
      attachment_path: null as string | null,
      attachment_mime: null as string | null,
      attachment_filename: null as string | null,
      attachment_size_bytes: null as number | null,
    }
  }

  const file = attachment as File
  if (file.size <= 0) {
    return {
      attachment_path: null as string | null,
      attachment_mime: null as string | null,
      attachment_filename: null as string | null,
      attachment_size_bytes: null as number | null,
    }
  }

  if (file.size > ATTACHMENT_MAX_BYTES) throw new Error('Attachment is too large (max 8MB).')

  const mime = inferAttachmentMime(file)
  if (!mime) throw new Error('Attachment must be a PDF, JPG, PNG, or WEBP file.')

  const safeName = normalizeFileName(file.name || 'attachment')
  const path = `external-income/${entryId}/${Date.now()}-${safeName}`
  const ab = await file.arrayBuffer()
  const up = await admin.storage.from('external-income-attachments').upload(path, ab, {
    contentType: mime,
    upsert: false,
  })

  if (up.error) throw new Error(up.error.message || 'Attachment upload failed.')

  return {
    attachment_path: path,
    attachment_mime: mime,
    attachment_filename: file.name || safeName,
    attachment_size_bytes: file.size,
  }
}

async function removeAttachmentPath(admin: any, path: string | null | undefined) {
  const safe = String(path ?? '').trim()
  if (!safe) return
  try {
    await admin.storage.from('external-income-attachments').remove([safe])
  } catch {
    // best effort only
  }
}

function attachmentBadge(entry: Pick<EntryRow, 'attachment_path' | 'attachment_filename' | 'attachment_size_bytes'>) {
  if (!entry.attachment_path) {
    return <span className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--muted))]">No file</span>
  }

  return (
    <div className="space-y-1">
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">File attached</span>
      <div className="break-all text-xs text-[hsl(var(--muted))]">
        {entry.attachment_filename || 'attachment'}{entry.attachment_size_bytes ? ` · ${formatBytes(entry.attachment_size_bytes)}` : ''}
      </div>
    </div>
  )
}

function attachmentCell(entry: Pick<EntryRow, 'id' | 'attachment_path' | 'attachment_filename' | 'attachment_size_bytes'>) {
  if (!entry.attachment_path) return attachmentBadge(entry)
  return (
    <div className="space-y-2">
      {attachmentBadge(entry)}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/api/admin/external-income/${entry.id}/attachment`} prefetch={false} className={actionLinkClass()}>
          View
        </Link>
        <a href={`/api/admin/external-income/${entry.id}/attachment?download=1`} className={actionLinkClass()}>
          Download
        </a>
      </div>
    </div>
  )
}

function canManageEntry(actorRole: Role, actorUserId: string, creatorProfile: ProfileMini | null | undefined, createdBy: string | null | undefined) {
  if (actorRole === 'super_admin') return true
  if (actorRole !== 'admin') return false
  if (createdBy && createdBy === actorUserId) return true
  return normalizeRole(creatorProfile?.role) !== 'super_admin'
}

async function addEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/external-income')
  if (!canAccessExternalIncome(me.role)) redirect('/admin/external-income?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const entry_date = safeStr(formData.get('entry_date')).trim() || cairoTodayDateOnly()
  const source_key = safeStr(formData.get('source_key')).trim() as EntrySource
  const title = safeStr(formData.get('title')).trim()
  const amountRaw = safeStr(formData.get('amount')).trim()
  const payment_method = safeStr(formData.get('payment_method')).trim()
  const note = safeStr(formData.get('note')).trim()
  const attachment = formData.get('attachment')

  if (!['bar', 'store', 'other'].includes(source_key)) redirect(withFlash(returnQS, { error: 'Please choose a valid source.' }))
  if (!title) redirect(withFlash(returnQS, { error: 'Please enter a title.' }))

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) redirect(withFlash(returnQS, { error: 'Amount must be greater than 0.' }))
  if (payment_method && !ALLOWED_PAYMENT_METHODS.has(payment_method)) redirect(withFlash(returnQS, { error: 'Please choose a valid payment method.' }))

  const admin = getSupabaseAdminClientCached()
  const entryId = randomUUID()

  let attachment_path: string | null = null
  let attachment_mime: string | null = null
  let attachment_filename: string | null = null
  let attachment_size_bytes: number | null = null

  try {
    const uploaded = await uploadAttachmentFile(admin, entryId, attachment)
    attachment_path = uploaded.attachment_path
    attachment_mime = uploaded.attachment_mime
    attachment_filename = uploaded.attachment_filename
    attachment_size_bytes = uploaded.attachment_size_bytes
  } catch (e: any) {
    redirect(withFlash(returnQS, { error: e?.message || 'Attachment upload failed.' }))
  }

  const { error } = await admin.from('external_income_entries').insert([
    {
      id: entryId,
      entry_date,
      source_key,
      title,
      amount,
      payment_method: payment_method || null,
      note: note || null,
      attachment_path,
      attachment_mime,
      attachment_filename,
      attachment_size_bytes,
      created_by: me.id,
      updated_by: me.id,
    },
  ])

  if (error) {
    await removeAttachmentPath(admin, attachment_path)
    redirect(withFlash(returnQS, { error: error.message || 'Could not save entry.' }))
  }

  redirect(withFlash(returnQS, { saved: '1' }))
}

async function updateEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/external-income')
  if (!canAccessExternalIncome(me.role)) redirect('/admin/external-income?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = safeStr(formData.get('id')).trim()
  const entry_date = safeStr(formData.get('entry_date')).trim() || cairoTodayDateOnly()
  const source_key = safeStr(formData.get('source_key')).trim() as EntrySource
  const title = safeStr(formData.get('title')).trim()
  const amountRaw = safeStr(formData.get('amount')).trim()
  const payment_method = safeStr(formData.get('payment_method')).trim()
  const note = safeStr(formData.get('note')).trim()
  const removeAttachment = safeStr(formData.get('remove_attachment')) === '1'
  const attachment = formData.get('attachment')

  if (!id) redirect(withFlash(returnQS, { error: 'Missing entry id.' }))
  if (!['bar', 'store', 'other'].includes(source_key)) redirect(withFlash(returnQS, { error: 'Please choose a valid source.' }))
  if (!title) redirect(withFlash(returnQS, { error: 'Please enter a title.' }))

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) redirect(withFlash(returnQS, { error: 'Amount must be greater than 0.' }))
  if (payment_method && !ALLOWED_PAYMENT_METHODS.has(payment_method)) redirect(withFlash(returnQS, { error: 'Please choose a valid payment method.' }))

  const admin = getSupabaseAdminClientCached()
  const { data: existing, error: existingError } = await admin
    .from('external_income_entries')
    .select('id,created_by,attachment_path,attachment_mime,attachment_filename,attachment_size_bytes')
    .eq('id', id)
    .maybeSingle<Pick<EntryRow, 'id' | 'created_by' | 'attachment_path' | 'attachment_mime' | 'attachment_filename' | 'attachment_size_bytes'>>()

  if (existingError || !existing) redirect(withFlash(returnQS, { error: existingError?.message || 'Entry not found.' }))

  const creatorProfile = existing.created_by
    ? (await admin.from('profiles').select('user_id,role,first_name,last_name,email').eq('user_id', existing.created_by).maybeSingle<ProfileMini>()).data
    : null

  if (!canManageEntry(me.role, me.id, creatorProfile, existing.created_by)) {
    redirect(withFlash(returnQS, { error: 'Only Super Admin can edit this entry.' }))
  }

  let attachment_path: string | null = existing.attachment_path
  let attachment_mime: string | null = existing.attachment_mime
  let attachment_filename: string | null = existing.attachment_filename
  let attachment_size_bytes: number | null = existing.attachment_size_bytes
  let uploadedNewPath: string | null = null

  try {
    const uploaded = await uploadAttachmentFile(admin, id, attachment)
    if (uploaded.attachment_path) {
      uploadedNewPath = uploaded.attachment_path
      attachment_path = uploaded.attachment_path
      attachment_mime = uploaded.attachment_mime
      attachment_filename = uploaded.attachment_filename
      attachment_size_bytes = uploaded.attachment_size_bytes
    } else if (removeAttachment) {
      attachment_path = null
      attachment_mime = null
      attachment_filename = null
      attachment_size_bytes = null
    }
  } catch (e: any) {
    redirect(withFlash(returnQS, { error: e?.message || 'Attachment upload failed.' }))
  }

  const { error } = await admin
    .from('external_income_entries')
    .update({
      entry_date,
      source_key,
      title,
      amount,
      payment_method: payment_method || null,
      note: note || null,
      attachment_path,
      attachment_mime,
      attachment_filename,
      attachment_size_bytes,
      updated_at: new Date().toISOString(),
      updated_by: me.id,
    })
    .eq('id', id)

  if (error) {
    await removeAttachmentPath(admin, uploadedNewPath)
    redirect(withFlash(returnQS, { error: error.message || 'Could not update entry.' }))
  }

  if (uploadedNewPath && existing.attachment_path && existing.attachment_path !== uploadedNewPath) {
    await removeAttachmentPath(admin, existing.attachment_path)
  } else if (!uploadedNewPath && removeAttachment && existing.attachment_path) {
    await removeAttachmentPath(admin, existing.attachment_path)
  }

  redirect(withFlash(returnQS, { updated: '1' }))
}

async function deleteEntryAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/external-income')
  if (!canAccessExternalIncome(me.role)) redirect('/admin/external-income?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = safeStr(formData.get('id')).trim()
  if (!id) redirect(withFlash(returnQS, { error: 'Missing entry id.' }))

  const admin = getSupabaseAdminClientCached()
  const { data: existing, error: existingError } = await admin
    .from('external_income_entries')
    .select('id,created_by,attachment_path')
    .eq('id', id)
    .maybeSingle<{ id: string; created_by: string | null; attachment_path: string | null }>()

  if (existingError || !existing) redirect(withFlash(returnQS, { error: existingError?.message || 'Entry not found.' }))

  const creatorProfile = existing.created_by
    ? (await admin.from('profiles').select('user_id,role,first_name,last_name,email').eq('user_id', existing.created_by).maybeSingle<ProfileMini>()).data
    : null

  if (!canManageEntry(me.role, me.id, creatorProfile, existing.created_by)) {
    redirect(withFlash(returnQS, { error: 'Only Super Admin can delete this entry.' }))
  }

  const { error } = await admin.from('external_income_entries').delete().eq('id', id)
  if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not delete entry.' }))

  await removeAttachmentPath(admin, existing.attachment_path)
  redirect(withFlash(returnQS, { deleted: '1' }))
}

export default async function ExternalIncomePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/external-income')

  if (!canAccessExternalIncome(me.role)) {
    return (
      <AccessDeniedPage
        title="Other Income"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can access other income."
        allowed="admin, super_admin"
        nextPath="/admin/external-income"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()
  const today = cairoTodayDateOnly()
  const preset = parsePreset(typeof searchParams.preset === 'string' ? searchParams.preset : '90d')
  let from = safeStr(searchParams.from)
  let to = safeStr(searchParams.to)
  if (preset === '30d') {
    to = today
    from = addDaysDateOnly(today, -29)
  } else if (preset === '90d') {
    to = today
    from = addDaysDateOnly(today, -89)
  } else if (preset === 'year') {
    to = today
    from = `${today.slice(0, 4)}-01-01`
  } else if (preset !== 'all') {
    if (!from) from = addDaysDateOnly(today, -89)
    if (!to) to = today
  }

  const source = parseSource(typeof searchParams.source === 'string' ? searchParams.source : 'all')
  const q = sanitizeSearch(safeStr(searchParams.q))
  const page = parsePositiveInt(typeof searchParams.page === 'string' ? searchParams.page : '1', 1)
  const edit = safeStr(searchParams.edit).trim()

  let base = admin
    .from('external_income_entries')
    .select('id,entry_date,source_key,title,amount,payment_method,note,created_at,created_by,updated_at,updated_by,attachment_path,attachment_mime,attachment_filename,attachment_size_bytes', { count: 'exact' })
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  let summaryBase = admin
    .from('external_income_entries')
    .select('amount,source_key,entry_date')
    .order('entry_date', { ascending: false })

  if (preset !== 'all' && from) {
    base = base.gte('entry_date', from)
    summaryBase = summaryBase.gte('entry_date', from)
  }
  if (preset !== 'all' && to) {
    base = base.lte('entry_date', to)
    summaryBase = summaryBase.lte('entry_date', to)
  }
  if (source !== 'all') {
    base = base.eq('source_key', source)
    summaryBase = summaryBase.eq('source_key', source)
  }
  if (q) {
    const pattern = `%${q}%`
    base = base.or(`title.ilike.${pattern},note.ilike.${pattern},attachment_filename.ilike.${pattern}`)
    summaryBase = summaryBase.or(`title.ilike.${pattern},note.ilike.${pattern},attachment_filename.ilike.${pattern}`)
  }

  const fromIdx = (page - 1) * PER_PAGE
  const toIdx = fromIdx + PER_PAGE - 1

  const [{ data: rows, count, error }, { data: summaryRows, error: summaryError }] = await Promise.all([
    base.range(fromIdx, toIdx),
    summaryBase,
  ])

  if (error) {
    return (
      <main className="min-h-screen bg-[hsl(var(--bg))]">
        <PageHeader title="Other Income" subtitle="Track bar, store, and other extra income." />
        <Section>
          <InlineAlert variant="error">{error.message || 'Could not load page.'}</InlineAlert>
        </Section>
      </main>
    )
  }

  if (summaryError) {
    return (
      <main className="min-h-screen bg-[hsl(var(--bg))]">
        <PageHeader title="Other Income" subtitle="Track bar, store, and other extra income." />
        <Section>
          <InlineAlert variant="error">{summaryError.message || 'Could not load summary.'}</InlineAlert>
        </Section>
      </main>
    )
  }

  const entries = (rows ?? []) as EntryRow[]
  const summary = (summaryRows ?? []) as Array<{ amount: number; source_key: EntrySource; entry_date: string }>
  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE))
  const safePage = Math.min(page, totalPages)

  const profileIds = Array.from(new Set(entries.flatMap((row) => [row.created_by, row.updated_by]).filter(Boolean))) as string[]
  const { data: profiles } = profileIds.length
    ? await admin.from('profiles').select('user_id,role,first_name,last_name,email').in('user_id', profileIds)
    : { data: [] as ProfileMini[] }
  const profileMap = new Map((profiles ?? []).map((p: ProfileMini) => [p.user_id, p]))

  const totalAmount = summary.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const barAmount = summary.filter((r) => r.source_key === 'bar').reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const storeAmount = summary.filter((r) => r.source_key === 'store').reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const todayAmount = summary.filter((r) => r.entry_date === today).reduce((sum, row) => sum + Number(row.amount || 0), 0)

  const editEntry = edit ? entries.find((row) => row.id === edit) ?? null : null
  const editCreator = editEntry?.created_by ? profileMap.get(editEntry.created_by) ?? null : null
  const canEditEntry = editEntry ? canManageEntry(me.role, me.id, editCreator, editEntry.created_by) : false

  const returnParams = {
    preset,
    from,
    to,
    source: source === 'all' ? '' : source,
    q,
  }
  const returnQS = buildQS(returnParams)

  return (
    <main className="min-h-screen bg-[hsl(var(--bg))] pb-12">
      <PageHeader
        title="Other Income"
        subtitle="Track money entries outside subscriptions like bar, store, or other extra sales."
        right={<Button asChild variant="outline" href="/admin">Back to Admin</Button>}
      />

      <Section className="space-y-4">
        {safeStr(searchParams.error) ? <InlineAlert variant="error">{safeStr(searchParams.error)}</InlineAlert> : null}
        {safeStr(searchParams.saved) === '1' ? <InlineAlert variant="success">Entry saved.</InlineAlert> : null}
        {safeStr(searchParams.updated) === '1' ? <InlineAlert variant="success">Entry updated.</InlineAlert> : null}
        {safeStr(searchParams.deleted) === '1' ? <InlineAlert variant="success">Entry deleted.</InlineAlert> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="space-y-1"><div className="text-sm text-[hsl(var(--muted))]">Filtered total</div><div className="text-2xl font-semibold tracking-tight">{formatEGP(totalAmount)}</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-sm text-[hsl(var(--muted))]">Entries</div><div className="text-2xl font-semibold tracking-tight">{totalCount}</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-sm text-[hsl(var(--muted))]">Bar</div><div className="text-2xl font-semibold tracking-tight">{formatEGP(barAmount)}</div></CardContent></Card>
          <Card><CardContent className="space-y-1"><div className="text-sm text-[hsl(var(--muted))]">Store / Today</div><div className="text-lg font-semibold tracking-tight">{formatEGP(storeAmount)} <span className="text-sm text-[hsl(var(--muted))]">· {formatEGP(todayAmount)}</span></div></CardContent></Card>
        </div>
      </Section>

      <Section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Add income entry</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addEntryAction} className="space-y-4">
              <input type="hidden" name="return_qs" value={returnQS} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input type="date" name="entry_date" label="Date" defaultValue={today} />
                <Select name="source_key" label="Source" defaultValue="bar">
                  <option value="bar">Bar</option>
                  <option value="store">Store</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <Input name="title" label="Title" placeholder="Example: Snacks sales" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input name="amount" type="number" min="0" step="0.01" label="Amount (EGP)" placeholder="0.00" required />
                <Select name="payment_method" label="Payment method" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="visa">Visa card</option>
                  <option value="instapay">Instapay</option>
                  <option value="bank_transfer">Bank transfer</option>
                </Select>
              </div>
              <Textarea name="note" label="Note" rows={4} placeholder="Optional note" />
              <Input name="attachment" type="file" label="Attachment" hint="Optional PDF, JPG, PNG, or WEBP. Max 8MB." accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Save entry</Button>
                <Button asChild variant="outline" href="/admin/external-income?preset=90d">Reset page</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">Refine the list before reviewing extra revenue entries.</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action="/admin/external-income" className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Quick range</div>
                <div className="flex flex-wrap gap-2">
                  {(['30d', '90d', 'year', 'all'] as const).map((p) => (
                    <Link key={p} prefetch={false} href={`/admin/external-income?preset=${p}`} className={`rounded-full border px-3 py-1.5 text-sm ${preset === p ? 'border-black bg-black text-white' : 'bg-white hover:bg-gray-50'}`}>
                      {p === '30d' ? '30 days' : p === '90d' ? '90 days' : p === 'year' ? 'This year' : 'All'}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Input type="date" name="from" label="From" defaultValue={from} />
                <Input type="date" name="to" label="To" defaultValue={to} />
                <Select name="source" label="Source" defaultValue={source}>
                  <option value="all">All sources</option>
                  <option value="bar">Bar</option>
                  <option value="store">Store</option>
                  <option value="other">Other</option>
                </Select>
                <Input name="q" label="Search" defaultValue={q} placeholder="title, note, file..." />
              </div>
              <input type="hidden" name="preset" value="custom" />
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Apply filters</Button>
                <Button asChild variant="outline" href="/admin/external-income?preset=90d">Reset filters</Button>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Current view</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {( [
                    preset === 'all' ? 'All dates' : from && to ? `${from} - ${to}` : '',
                    source !== 'all' ? sourceLabel(source) : 'All sources',
                    q ? `Search: ${q}` : '',
                  ].filter(Boolean) ).map((item) => (
                    <span key={item} className="inline-flex rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs text-[hsl(var(--muted))]">{item}</span>
                  ))}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </Section>

      <Section className="space-y-6">
        {editEntry && canEditEntry ? (
          <Card>
            <CardHeader>
              <CardTitle>Edit entry</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateEntryAction} className="space-y-4">
                <input type="hidden" name="return_qs" value={returnQS} />
                <input type="hidden" name="id" value={editEntry.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input type="date" name="entry_date" label="Date" defaultValue={editEntry.entry_date} />
                  <Select name="source_key" label="Source" defaultValue={editEntry.source_key}>
                    <option value="bar">Bar</option>
                    <option value="store">Store</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <Input name="title" label="Title" defaultValue={editEntry.title} required />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input name="amount" type="number" min="0" step="0.01" label="Amount (EGP)" defaultValue={String(editEntry.amount)} required />
                  <Select name="payment_method" label="Payment method" defaultValue={editEntry.payment_method || 'cash'}>
                    <option value="cash">Cash</option>
                    <option value="visa">Visa card</option>
                    <option value="instapay">Instapay</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </Select>
                </div>
                <Textarea name="note" label="Note" rows={4} defaultValue={editEntry.note || ''} />
                {editEntry.attachment_path ? (
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3 text-sm">
                    <div className="font-medium">Current attachment</div>
                    <div className="mt-1 text-[hsl(var(--muted))]">{editEntry.attachment_filename || 'attachment'}{editEntry.attachment_size_bytes ? ` · ${formatBytes(editEntry.attachment_size_bytes)}` : ''}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/api/admin/external-income/${editEntry.id}/attachment`} prefetch={false} className={actionLinkClass()}>View</Link>
                      <a href={`/api/admin/external-income/${editEntry.id}/attachment?download=1`} className={actionLinkClass()}>Download</a>
                    </div>
                    <label className="mt-3 inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" name="remove_attachment" value="1" />
                      Remove current attachment
                    </label>
                  </div>
                ) : null}
                <Input name="attachment" type="file" label="Replace / add attachment" hint="Optional PDF, JPG, PNG, or WEBP. Max 8MB." accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Save changes</Button>
                  <Button asChild variant="outline" href={`/admin/external-income?${returnQS}`}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {entries.length ? entries.map((entry) => {
              const creator = entry.created_by ? profileMap.get(entry.created_by) ?? null : null
              const updater = entry.updated_by ? profileMap.get(entry.updated_by) ?? null : null
              const canManage = canManageEntry(me.role, me.id, creator, entry.created_by)
              const isLockedForAdmin = me.role === 'admin' && !canManage
              return (
                <div key={entry.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {sourceBadge(entry.source_key)}
                        <span className="text-xs font-medium text-[hsl(var(--muted))]">{entry.entry_date}</span>
                        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">{formatEGP(entry.amount)}</span>
                        {isLockedForAdmin ? <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">Locked to Super Admin</span> : null}
                      </div>
                      <div>
                        <div className="text-lg font-semibold tracking-tight">{entry.title}</div>
                        <div className="mt-1 text-sm text-[hsl(var(--muted))]">Payment method: {paymentLabel(entry.payment_method)}</div>
                      </div>
                      {entry.note ? <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 text-sm text-[hsl(var(--fg))]">{entry.note}</div> : null}
                    </div>
                    <div className="min-w-[220px] space-y-3">
                      {attachmentCell(entry)}
                      <div className="text-xs text-[hsl(var(--muted))]">
                        <div>Created by {profileDisplayName(creator)}</div>
                        <div>{profileMetaLine(creator)} · {formatDateTimeInCairo(entry.created_at)}</div>
                        {entry.updated_at ? <div className="mt-1">Updated by {profileDisplayName(updater)} · {formatDateTimeInCairo(entry.updated_at)}</div> : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canManage ? (
                      <Button asChild variant="outline" href={`/admin/external-income?${buildQS({ ...returnParams, page: String(safePage), edit: entry.id })}`}>
                        Edit
                      </Button>
                    ) : null}
                    {canManage ? (
                      <form action={deleteEntryAction}>
                        <input type="hidden" name="return_qs" value={returnQS} />
                        <input type="hidden" name="id" value={entry.id} />
                        <Button type="submit" variant="ghost">Delete</Button>
                      </form>
                    ) : null}
                  </div>
                </div>
              )
            }) : (
              <InlineAlert variant="info">No entries found for this filter.</InlineAlert>
            )}

            {totalPages > 1 ? (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="mr-2 text-sm text-[hsl(var(--muted))]">Page {safePage} of {totalPages}</span>
                {safePage > 1 ? <Button asChild variant="outline" href={`/admin/external-income?${buildQS({ ...returnParams, page: String(safePage - 1) })}`}>Previous</Button> : null}
                {safePage < totalPages ? <Button asChild variant="outline" href={`/admin/external-income?${buildQS({ ...returnParams, page: String(safePage + 1) })}`}>Next</Button> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
