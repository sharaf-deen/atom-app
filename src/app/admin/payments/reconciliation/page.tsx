export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import ConfirmSubmitButton from '@/components/ui/ConfirmSubmitButton'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
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

type ApproverRow = {
  user_id: string
  is_active: boolean
  note: string | null
  role: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string
  named_key: 'sharaf_deen' | 'shehab' | 'shawki' | null
  is_super_admin: boolean
}

type BatchRow = {
  id: string
  superseded_by_batch_id: string | null
  validated_by: string | null
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

type ValidationResultRow = {
  batch_id: string
  line_count: number
  expected_amount: number
  counted_amount: number
  difference_amount: number
}

type UpdateResultRow = {
  batch_id: string
  counted_amount: number
  difference_amount: number
}

type DeleteResultRow = {
  batch_id: string
  released_count: number
}

type HistoryStatus = 'all' | 'matched' | 'over' | 'short'

type BatchItemRow = {
  id: string
  batch_id: string
  source_kind: 'subscription_payment' | 'external_income'
  source_id: string
  amount_snapshot: number
  released_at: string | null
  business_date_snapshot: string
  event_at_snapshot: string
  title: string
  note: string | null
  source_key: string | null
  member_id: string | null
}

type RangeLabelRow = {
  validation_mode: ValidationMode
  business_date?: string | null
  first_business_date?: string | null
  last_business_date?: string | null
  period_from?: string | null
  period_to?: string | null
}

const METHODS: Array<Method | 'all'> = ['all', 'cash', 'instapay', 'card', 'bank_transfer']
const BASELINE = '2026-08-01'

function formatEGP(n: number) {
  const v = Number(n ?? 0)
  try {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(v)
  } catch {
    return `${v.toFixed(2)} EGP`
  }
}

function amountInputValue(n: number) {
  const v = Number(n ?? 0)
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
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

function methodBarClass(m: Method | string) {
  if (m === 'cash') return 'bg-emerald-500/70'
  if (m === 'instapay') return 'bg-sky-500/70'
  if (m === 'card') return 'bg-violet-500/70'
  if (m === 'bank_transfer') return 'bg-amber-500/70'
  return 'bg-slate-400/70'
}

function summaryToneClass(method: Method | 'all' | 'open_entries') {
  if (method === 'cash') return 'border-emerald-200 bg-emerald-50/40'
  if (method === 'instapay') return 'border-sky-200 bg-sky-50/40'
  if (method === 'card') return 'border-violet-200 bg-violet-50/40'
  if (method === 'bank_transfer') return 'border-amber-200 bg-amber-50/40'
  if (method === 'open_entries') return 'border-slate-200 bg-slate-50/60'
  return 'border-black/10 bg-black/[0.03]'
}

function labelMode(mode: ValidationMode) {
  return mode === 'cash_period' ? 'Cash closure' : 'Daily reconciliation'
}

function modeHelper(mode: ValidationMode) {
  return mode === 'cash_period' ? 'Since the last cash closure' : 'One Cairo business date'
}

function safeMethod(v: string | null | undefined): Method | 'all' {
  return METHODS.includes(v as any) ? (v as Method | 'all') : 'all'
}

function safeHistoryStatus(v: string | null | undefined): HistoryStatus {
  return v === 'matched' || v === 'over' || v === 'short' ? v : 'all'
}

function parseIsoDateOnly(v: string | null | undefined) {
  const raw = String(v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function formatCairoDateKey(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return ''
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt)
  const y = parts.find((p) => p.type === 'year')?.value ?? ''
  const m = parts.find((p) => p.type === 'month')?.value ?? ''
  const d = parts.find((p) => p.type === 'day')?.value ?? ''
  return y && m && d ? `${y}-${m}-${d}` : ''
}

function parseMethod(v: unknown): Method | null {
  return v === 'cash' || v === 'instapay' || v === 'card' || v === 'bank_transfer' ? v : null
}

function parseValidationMode(v: unknown): ValidationMode | null {
  return v === 'cash_period' || v === 'daily' ? v : null
}

function parseMoney(v: unknown) {
  if (typeof v !== 'string') return NaN
  const normalized = v.replace(/,/g, '').trim()
  const n = Number(normalized)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

function parsePositiveInt(v: unknown) {
  if (typeof v !== 'string') return NaN
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

function parseUuid(v: unknown) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

function sp1(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = sp[key]
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}

function safeFlash(v: unknown) {
  return typeof v === 'string' ? v.slice(0, 220) : ''
}

function safeActionErrorMessage(error: unknown, fallback: string) {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message: string }).message)
        : fallback

  const normalized = raw.replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, 220)
}

function isNextRedirectError(error: unknown) {
  const digest =
    error && typeof error === 'object' && 'digest' in error
      ? String((error as { digest?: unknown }).digest ?? '')
      : ''
  return digest.startsWith('NEXT_REDIRECT')
}

function logValidationActionError(scope: string, error: unknown) {
  const message = safeActionErrorMessage(error, 'Unknown validation action error.')
  console.error(`[payments-reconciliation] ${scope}: ${message}`)
}

function revalidateReconciliationPageSafely(scope: string) {
  try {
    revalidatePath('/admin/payments/reconciliation')
  } catch (error) {
    logValidationActionError(`${scope} revalidate`, error)
  }
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

function approverLabel(profile?: Pick<ApproverRow, 'display_name' | 'email' | 'first_name' | 'last_name'> | null) {
  const full = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
  return full || profile?.display_name || profile?.email || '—'
}

function roleLabel(role?: string | null) {
  const raw = String(role ?? '').trim()
  if (!raw) return 'Unknown role'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
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

function withFlash(returnQS: string, params: Record<string, string>) {
  const sp = new URLSearchParams(returnQS)
  for (const [k, v] of Object.entries(params)) {
    const value = String(v ?? '')
    if (value.length) sp.set(k, value)
  }
  const qs = sp.toString()
  return `/admin/payments/reconciliation${qs ? `?${qs}` : ''}`
}

function approverHelperText(canCreateValidations: boolean, role: string) {
  if (canCreateValidations) return role === 'super_admin' ? 'Super Admin can validate directly.' : 'This admin account is an active payment approver.'
  if (role === 'admin') return 'Read-only mode: this admin account is not yet active in payment_validation_approvers.'
  return 'Read-only mode.'
}

function differenceStatusLabel(difference: number) {
  if (difference === 0) return 'Matched'
  return difference > 0 ? 'Over' : 'Short'
}

function differenceTextClass(difference: number) {
  if (difference === 0) return 'text-emerald-700'
  return difference > 0 ? 'text-sky-700' : 'text-rose-700'
}

function differenceBadgeClass(difference: number) {
  if (difference === 0) return 'bg-emerald-50 text-emerald-700'
  return difference > 0 ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-rose-700'
}

function sectionLinkClass(active: boolean) {
  return `inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium ${active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white hover:bg-black/[0.03]'}`
}

export default async function AdminPaymentsReconciliationPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/payments/reconciliation')

  if (me.role !== 'super_admin') {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Payments Reconciliation</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Super Admin can access this page."
            nextPath="/admin/payments/reconciliation"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const methodFilter = safeMethod(sp1(searchParams, 'method'))
  const scopeFrom = parseIsoDateOnly(sp1(searchParams, 'scope_from')) || BASELINE
  const scopeTo = parseIsoDateOnly(sp1(searchParams, 'scope_to')) || formatCairoDateKey(new Date().toISOString())
  const effectiveFrom = scopeFrom < BASELINE ? BASELINE : scopeFrom
  const invalidRange = effectiveFrom > scopeTo
  const historyStatus = safeHistoryStatus(sp1(searchParams, 'history_status'))
  const historyByRaw = sp1(searchParams, 'history_by')
  const historyFrom = parseIsoDateOnly(sp1(searchParams, 'history_from'))
  const historyTo = parseIsoDateOnly(sp1(searchParams, 'history_to'))
  const focusBatchId = parseUuid(sp1(searchParams, 'focus_batch'))
  const flashError = safeFlash(sp1(searchParams, 'error'))
  const flashCreated = sp1(searchParams, 'created') === '1'
  const flashUpdated = sp1(searchParams, 'updated') === '1'
  const flashDeleted = sp1(searchParams, 'deleted') === '1'
  const flashBatch = safeFlash(sp1(searchParams, 'batch'))
  const flashReleased = safeFlash(sp1(searchParams, 'released'))
  const admin = getSupabaseAdminClientCached()

  const canCreateValidations = true

  const { data: approversRaw, error: approversErr } = await admin
    .from('payment_validation_approver_profiles_v1')
    .select('user_id, is_active, note, role, email, first_name, last_name, display_name, named_key, is_super_admin')
    .order('is_super_admin', { ascending: false })
    .order('first_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true, nullsFirst: false })

  const approvers: ApproverRow[] = ((approversRaw ?? []) as any[]).map((row) => ({
    user_id: String(row.user_id),
    is_active: Boolean(row.is_active),
    note: row.note ?? null,
    role: row.role ?? null,
    email: row.email ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    display_name: String(row.display_name ?? row.email ?? row.user_id),
    named_key: row.named_key === 'sharaf_deen' || row.named_key === 'shehab' || row.named_key === 'shawki' ? row.named_key : null,
    is_super_admin: Boolean(row.is_super_admin),
  }))

  async function createValidationAction(formData: FormData) {
    'use server'

    const returnQS = String(formData.get('return_qs') ?? '')

    try {
      const actor = await getSessionUserCached()
      if (!actor) redirect(`/login?next=/admin/payments/reconciliation`)
      if (actor.role !== 'super_admin') redirect('/admin/payments')

      const paymentMethod = parseMethod(formData.get('payment_method'))
      const validationMode = parseValidationMode(formData.get('validation_mode'))
      const businessDateRaw = parseIsoDateOnly(String(formData.get('business_date') ?? '').trim())
      const businessDate = businessDateRaw || null
      const countedAmount = parseMoney(formData.get('counted_amount'))
      const expectedAmount = parseMoney(formData.get('expected_amount'))
      const lineCount = parsePositiveInt(formData.get('line_count'))
      const note = String(formData.get('note') ?? '').trim()

      if (!paymentMethod) redirect(withFlash(returnQS, { error: 'Invalid payment method.' }))
      if (!validationMode) redirect(withFlash(returnQS, { error: 'Invalid validation mode.' }))
      if (validationMode !== 'daily' || !businessDate || businessDate < BASELINE) redirect(withFlash(returnQS, { error: 'A valid day from 01/08/2026 is required.' }))
      if (!Number.isFinite(expectedAmount) || expectedAmount < 0) redirect(withFlash(returnQS, { error: 'Expected amount snapshot is missing.' }))
      if (!Number.isFinite(countedAmount) || countedAmount < 0) redirect(withFlash(returnQS, { error: 'Counted amount must be 0 or greater.' }))
      if (!Number.isFinite(lineCount) || lineCount <= 0) redirect(withFlash(returnQS, { error: 'Line count snapshot is missing.' }))

      const actionAdmin = getSupabaseAdminClientCached()

      let data: unknown = null
      let rpcError: { message?: string } | null = null

      try {
        const result = await actionAdmin.rpc('create_payment_validation_batch_v1', {
          p_payment_method: paymentMethod,
          p_validation_mode: validationMode,
          p_business_date: businessDate,
          p_expected_amount: expectedAmount,
          p_line_count: lineCount,
          p_counted_amount: countedAmount,
          p_note: note || null,
          p_actor: actor.id,
        })
        data = result.data as unknown
        rpcError = result.error as { message?: string } | null
      } catch (error) {
        redirect(withFlash(returnQS, { error: safeActionErrorMessage(error, 'Could not create validation batch.') }))
      }

      if (rpcError) redirect(withFlash(returnQS, { error: safeActionErrorMessage(rpcError, 'Could not create validation batch.') }))

      const row = (Array.isArray(data) ? data[0] : data) as ValidationResultRow | null
      revalidateReconciliationPageSafely('create validation batch')
      redirect(withFlash(returnQS, {
        created: '1',
        batch: row?.batch_id ? String(row.batch_id).slice(0, 8) : 'saved',
      }))
    } catch (error) {
      if (isNextRedirectError(error)) throw error
      logValidationActionError('create validation batch', error)
      redirect(withFlash(returnQS, { error: safeActionErrorMessage(error, 'Could not create validation batch.') }))
    }
  }

  async function updateValidationBatchAction(formData: FormData) {
    'use server'

    const actor = await getSessionUserCached()
    const returnQS = String(formData.get('return_qs') ?? '')
    if (!actor) redirect(`/login?next=/admin/payments/reconciliation`)
    if (actor.role !== 'super_admin') redirect('/admin/payments')

    const batchId = parseUuid(formData.get('batch_id'))
    const countedAmount = parseMoney(formData.get('counted_amount'))
    const note = String(formData.get('note') ?? '').trim()

    if (!batchId) redirect(withFlash(returnQS, { error: 'Invalid batch id.' }))
    if (!Number.isFinite(countedAmount) || countedAmount < 0) redirect(withFlash(returnQS, { error: 'Counted amount must be 0 or greater.' }))

    const actionAdmin = getSupabaseAdminClientCached()

    const { data, error } = await actionAdmin.rpc('update_payment_validation_batch_v1', {
      p_batch_id: batchId,
      p_counted_amount: countedAmount,
      p_note: note || null,
      p_actor: actor.id,
    })

    if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not update validation batch.' }))

    const row = (Array.isArray(data) ? data[0] : data) as UpdateResultRow | null
    revalidatePath('/admin/payments/reconciliation')
    redirect(withFlash(returnQS, {
      updated: '1',
      batch: row?.batch_id ? String(row.batch_id).slice(0, 8) : 'saved',
    }))
  }

  async function deleteValidationBatchAction(formData: FormData) {
    'use server'

    const actor = await getSessionUserCached()
    const returnQS = String(formData.get('return_qs') ?? '')
    if (!actor) redirect(`/login?next=/admin/payments/reconciliation`)
    if (actor.role !== 'super_admin') redirect('/admin/payments')

    const batchId = parseUuid(formData.get('batch_id'))
    if (!batchId) redirect(withFlash(returnQS, { error: 'Invalid batch id.' }))

    const actionAdmin = getSupabaseAdminClientCached()

    const { data, error } = await actionAdmin.rpc('delete_payment_validation_batch_v1', {
      p_batch_id: batchId,
      p_actor: actor.id,
    })

    if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not delete validation batch.' }))

    const row = (Array.isArray(data) ? data[0] : data) as DeleteResultRow | null
    revalidatePath('/admin/payments/reconciliation')
    redirect(withFlash(returnQS, {
      deleted: '1',
      batch: row?.batch_id ? String(row.batch_id).slice(0, 8) : 'deleted',
      released: row?.released_count != null ? String(row.released_count) : '0',
    }))
  }

  async function correctAndRevalidateAction(formData: FormData) {
    'use server'

    const actor = await getSessionUserCached()
    if (!actor) redirect('/login?next=/admin/payments/reconciliation')
    if (actor.role !== 'super_admin') redirect('/admin/payments')

    const returnQS = String(formData.get('return_qs') ?? '')
    const batchId = parseUuid(formData.get('batch_id'))
    const sourceId = parseUuid(formData.get('source_id'))
    const sourceKind = String(formData.get('source_kind') ?? '')
    const oldAmount = parseMoney(formData.get('old_amount'))
    const newAmount = parseMoney(formData.get('new_amount'))
    const countedAmount = parseMoney(formData.get('counted_amount'))
    const reason = String(formData.get('reason') ?? '').trim()

    if (!batchId || !sourceId || !['subscription_payment', 'external_income'].includes(sourceKind)) {
      redirect(withFlash(returnQS, { error: 'Invalid payment selection.' }))
    }
    if (reason.length < 5 || reason.length > 500 || !Number.isFinite(oldAmount) || !Number.isFinite(newAmount) || newAmount <= 0 || !Number.isFinite(countedAmount) || countedAmount < 0) {
      redirect(withFlash(returnQS, { error: 'Enter a valid new amount, daily counted total, and a reason (5–500 characters).' }))
    }

    const actionAdmin = getSupabaseAdminClientCached()
    const { data, error } = await actionAdmin.rpc('correct_and_revalidate_payment_v1', {
      p_batch_id: batchId,
      p_source_kind: sourceKind,
      p_source_id: sourceId,
      p_old_amount: oldAmount,
      p_new_amount: newAmount,
      p_counted_amount: countedAmount,
      p_reason: reason,
      p_actor: actor.id,
    })
    if (error) redirect(withFlash(returnQS, { error: safeActionErrorMessage(error, 'Payment could not be corrected.') }))
    revalidatePath('/admin/payments/reconciliation')
    revalidatePath('/admin/payments')
    redirect(withFlash(returnQS, { corrected: '1', focus_batch: String(data) }))
  }

  let groupsQuery = admin
    .from('payment_validation_open_groups_v1')
    .select('payment_method, validation_mode, business_date, period_from, period_to, first_business_date, last_business_date, line_count, expected_amount')
    .order('payment_method', { ascending: true })
    .order('business_date', { ascending: false, nullsFirst: false })

  if (methodFilter !== 'all') groupsQuery = groupsQuery.eq('payment_method', methodFilter)
  groupsQuery = groupsQuery.gte('business_date', effectiveFrom).lte('business_date', scopeTo)

  const { data: groupsRaw, error: groupsErr } = invalidRange
    ? { data: [] as any[], error: null }
    : await groupsQuery

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
  openEventsQuery = openEventsQuery.gte('business_date', effectiveFrom).lte('business_date', scopeTo)

  const { data: eventsRaw, error: eventsErr } = invalidRange
    ? { data: [] as any[], error: null }
    : await openEventsQuery

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
      'id, superseded_by_batch_id, payment_method, validation_mode, business_date, period_from, period_to, expected_amount, counted_amount, difference_amount, note, validated_at, validated_by, validator:profiles!payment_validation_batches_validated_by_fkey(user_id,email,first_name,last_name)'
    )
    .or('deleted_at.is.null,superseded_by_batch_id.not.is.null')
    .order('validated_at', { ascending: false })
    .limit(200)

  if (methodFilter !== 'all') historyQuery = historyQuery.eq('payment_method', methodFilter)

  const { data: historyRaw, error: historyErr } = await historyQuery

  const allHistoryRows: BatchRow[] = ((historyRaw ?? []) as any[]).map((row) => ({
    id: String(row.id),
    superseded_by_batch_id: row.superseded_by_batch_id ? String(row.superseded_by_batch_id) : null,
    validated_by: row.validated_by ? String(row.validated_by) : null,
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

  const historyBy = historyByRaw === 'me' ? 'me' : parseUuid(historyByRaw)
  const historyRows = allHistoryRows.filter((row) => {
    if (row.superseded_by_batch_id && historyStatus !== 'all') return false
    if (historyStatus === 'matched' && row.difference_amount !== 0) return false
    if (historyStatus === 'over' && row.difference_amount <= 0) return false
    if (historyStatus === 'short' && row.difference_amount >= 0) return false

    if (historyBy === 'me' && row.validated_by !== me.id) return false
    if (typeof historyBy === 'string' && historyBy !== 'me' && row.validated_by !== historyBy) return false

    const key = formatCairoDateKey(row.validated_at)
    if (historyFrom && key && key < historyFrom) return false
    if (historyTo && key && key > historyTo) return false
    return true
  })

  const historyIds = historyRows.map((row) => row.id)
  const { data: batchItemsRaw, error: batchItemsErr } = historyIds.length
    ? await admin.from('payment_validation_batch_items').select('batch_id').in('batch_id', historyIds)
    : { data: [], error: null as any }

  const itemsCountByBatchId = new Map<string, number>()
  for (const row of (batchItemsRaw ?? []) as Array<{ batch_id: string }>) {
    const id = String(row.batch_id)
    itemsCountByBatchId.set(id, (itemsCountByBatchId.get(id) ?? 0) + 1)
  }

  const focusBatch = focusBatchId ? historyRows.find((row) => row.id === focusBatchId) ?? null : null

  const { data: focusBankMatchRaw, error: focusBankMatchErr } = focusBatch
    ? await admin.from('reconciliation_bank_matches')
        .select('id').eq('batch_id', focusBatch.id).is('released_at', null).limit(1)
    : { data: [], error: null as any }
  const focusHasActiveBankMatch = Boolean(focusBankMatchRaw?.length)

  const { data: focusItemsRaw, error: focusItemsErr } = focusBatch
    ? await admin
        .from('payment_validation_batch_items')
        .select('id, batch_id, source_kind, source_id, amount_snapshot, business_date_snapshot, event_at_snapshot, released_at')
        .eq('batch_id', focusBatch.id)
        .order('event_at_snapshot', { ascending: false })
    : { data: [], error: null as any }

  const focusSubIds = ((focusItemsRaw ?? []) as any[])
    .filter((row) => row.source_kind === 'subscription_payment')
    .map((row) => String(row.source_id))
  const focusExternalIds = ((focusItemsRaw ?? []) as any[])
    .filter((row) => row.source_kind === 'external_income')
    .map((row) => String(row.source_id))

  const { data: focusSubEventsRaw, error: focusSubEventsErr } = focusSubIds.length
    ? await admin
        .from('admin_income_events_v1')
        .select('source_kind, source_id, member_id, source_key, title, note')
        .eq('source_kind', 'subscription_payment')
        .in('source_id', focusSubIds)
    : { data: [], error: null as any }

  const { data: focusExternalEventsRaw, error: focusExternalEventsErr } = focusExternalIds.length
    ? await admin
        .from('admin_income_events_v1')
        .select('source_kind, source_id, member_id, source_key, title, note')
        .eq('source_kind', 'external_income')
        .in('source_id', focusExternalIds)
    : { data: [], error: null as any }

  const focusEventByKey = new Map<string, { title: string; note: string | null; source_key: string | null; member_id: string | null }>()
  for (const row of ([...((focusSubEventsRaw ?? []) as any[]), ...((focusExternalEventsRaw ?? []) as any[])])) {
    focusEventByKey.set(`${String(row.source_kind)}:${String(row.source_id)}`, {
      title: String(row.title ?? 'Untitled'),
      note: row.note ?? null,
      source_key: row.source_key ?? null,
      member_id: row.member_id ? String(row.member_id) : null,
    })
  }

  const focusItems: BatchItemRow[] = ((focusItemsRaw ?? []) as any[]).map((row) => {
    const key = `${String(row.source_kind)}:${String(row.source_id)}`
    const meta = focusEventByKey.get(key)
    return {
      id: String(row.id),
      batch_id: String(row.batch_id),
      source_kind: row.source_kind === 'subscription_payment' ? 'subscription_payment' : 'external_income',
      source_id: String(row.source_id),
      amount_snapshot: Number(row.amount_snapshot ?? 0),
      released_at: row.released_at ? String(row.released_at) : null,
      business_date_snapshot: String(row.business_date_snapshot),
      event_at_snapshot: String(row.event_at_snapshot),
      title: meta?.title ?? 'Untitled',
      note: meta?.note ?? null,
      source_key: meta?.source_key ?? null,
      member_id: meta?.member_id ?? null,
    }
  })

  const totalsByMethod: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
  let openTotal = 0
  let openLines = 0
  for (const row of openGroups) {
    openTotal += row.expected_amount
    openLines += row.line_count
    totalsByMethod[row.payment_method] += row.expected_amount
  }

  const dailyOpenRows = openGroups.filter((row) => row.validation_mode === 'daily')
  const createGroups = dailyOpenRows

  const stateParams: Record<string, string> = {}
  if (methodFilter !== 'all') stateParams.method = methodFilter
  stateParams.scope_from = effectiveFrom
  stateParams.scope_to = scopeTo
  if (historyStatus !== 'all') stateParams.history_status = historyStatus
  if (historyByRaw) stateParams.history_by = historyByRaw
  if (historyFrom) stateParams.history_from = historyFrom
  if (historyTo) stateParams.history_to = historyTo
  if (focusBatch?.id) stateParams.focus_batch = focusBatch.id

  const filterQS = buildQS(stateParams)
  const methodHref = (method: Method | 'all') => {
    const params: Record<string, string> = {}
    if (method !== 'all') params.method = method
    params.scope_from = effectiveFrom
    params.scope_to = scopeTo
    if (historyStatus !== 'all') params.history_status = historyStatus
    if (historyByRaw) params.history_by = historyByRaw
    if (historyFrom) params.history_from = historyFrom
    if (historyTo) params.history_to = historyTo
    const qs = buildQS(params)
    return `/admin/payments/reconciliation${qs ? `?${qs}` : ''}`
  }

  const historyFilterResetHref = `/admin/payments/reconciliation?${buildQS({ ...(methodFilter !== 'all' ? { method: methodFilter } : {}), scope_from: effectiveFrom, scope_to: scopeTo })}#history`

  const summaryCards: Array<{ label: string; value: string; sub: string; tone: Method | 'all' | 'open_entries' }> = [
    {
      label: 'Open total',
      value: formatEGP(openTotal),
      sub: `${openGroups.length} open group${openGroups.length === 1 ? '' : 's'}`,
      tone: 'all',
    },
    {
      label: 'Open entries',
      value: String(openLines),
      sub: 'Unreconciled income lines',
      tone: 'open_entries',
    },
    {
      label: 'Cash',
      value: formatEGP(totalsByMethod.cash),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'cash').length} daily group(s)`,
      tone: 'cash',
    },
    {
      label: 'Instapay',
      value: formatEGP(totalsByMethod.instapay),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'instapay').length} daily group(s)`,
      tone: 'instapay',
    },
    {
      label: 'Card',
      value: formatEGP(totalsByMethod.card),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'card').length} daily group(s)`,
      tone: 'card',
    },
    {
      label: 'Bank transfer',
      value: formatEGP(totalsByMethod.bank_transfer),
      sub: `${dailyOpenRows.filter((row) => row.payment_method === 'bank_transfer').length} daily group(s)`,
      tone: 'bank_transfer',
    },
  ]

  const currentHistoryRows = historyRows.filter((row) => !row.superseded_by_batch_id)
  const historyMatchedCount = currentHistoryRows.filter((row) => row.difference_amount === 0).length
  const historyDifferenceCount = currentHistoryRows.length - historyMatchedCount
  const historyOverCount = currentHistoryRows.filter((row) => row.difference_amount > 0).length
  const historyShortCount = currentHistoryRows.filter((row) => row.difference_amount < 0).length

  const validatorOptionsMap = new Map<string, { value: string; label: string }>()
  for (const row of approvers) {
    validatorOptionsMap.set(row.user_id, { value: row.user_id, label: approverLabel(row) })
  }
  for (const row of allHistoryRows) {
    if (row.validated_by && !validatorOptionsMap.has(row.validated_by)) {
      validatorOptionsMap.set(row.validated_by, { value: row.validated_by, label: profileLabel(row.validator) })
    }
  }
  const validatorOptions = Array.from(validatorOptionsMap.values())

  const dailyValidationSections = (['cash', 'instapay', 'card', 'bank_transfer'] as Method[])
    .map((method) => {
      const rows = dailyOpenRows.filter((row) => row.payment_method === method)
      return {
        method,
        rows,
        groupCount: rows.length,
        totalAmount: rows.reduce((sum, row) => sum + row.expected_amount, 0),
        totalLines: rows.reduce((sum, row) => sum + row.line_count, 0),
        earliestBusinessDate: rows.length ? rows[rows.length - 1]?.business_date ?? null : null,
        latestBusinessDate: rows.length ? rows[0]?.business_date ?? null : null,
      }
    })
    .filter((section) => section.rows.length > 0)

  const validateSummaryRows = dailyValidationSections.map((section) => ({
      method: section.method,
      title: labelMethod(section.method),
      helper:
        section.groupCount > 1
          ? `${formatDateOnly(section.earliestBusinessDate)} → ${formatDateOnly(section.latestBusinessDate)}`
          : formatDateOnly(section.latestBusinessDate),
      groupCount: section.groupCount,
      lineCount: section.totalLines,
      expectedAmount: section.totalAmount,
    })) as Array<{
    method: Method
    title: string
    helper: string
    groupCount: number
    lineCount: number
    expectedAmount: number
  }>

  const openScopeSummaryRows = (['cash', 'instapay', 'card', 'bank_transfer'] as Method[])
    .map((method) => {
      const rows = openGroups.filter((row) => row.payment_method === method)
      const expectedAmount = rows.reduce((sum, row) => sum + row.expected_amount, 0)
      const lineCount = rows.reduce((sum, row) => sum + row.line_count, 0)
      const firstRow = rows[0] ?? null
      const lastRow = rows.length ? rows[rows.length - 1] : null
      const scopeLabel = rows.length
        ? rows.length === 1
          ? formatDateOnly(firstRow?.business_date ?? null)
          : `${formatDateOnly(lastRow?.business_date ?? null)} → ${formatDateOnly(firstRow?.business_date ?? null)}`
        : 'No open daily groups'
      return {
        method,
        groupCount: rows.length,
        lineCount,
        expectedAmount,
        scopeLabel,
      }
    })
    .filter((row) => row.groupCount > 0)

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

  const openEventsPreviewLimit = 20
  const openEventsPreviewSource = openEvents.slice(0, openEventsPreviewLimit)
  const openEventsOverflowSource = openEvents.slice(openEventsPreviewLimit)

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

  const mapOpenEventRow = (row: OpenEventRow) => ({
    id: row.source_id,
    event_at: <span className="font-medium">{formatCairoDateTime(row.event_at)}</span>,
    business_date: <span className="text-sm text-[hsl(var(--muted))]">{formatDateOnly(row.business_date)}</span>,
    source: <Badge className="bg-slate-100 text-slate-700">{eventSourceLabel(row)}</Badge>,
    title: (
      <div className="space-y-0.5">
        <div className="font-medium">{row.title}</div>
        <div className="text-xs text-[hsl(var(--muted))]">{row.source_id.slice(0, 8)}</div>
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
  })

  const openEventsTableRows = openEventsPreviewSource.map(mapOpenEventRow)
  const openEventsOverflowTableRows = openEventsOverflowSource.map(mapOpenEventRow)

  const historyColumns = [
    { key: 'validated_at', header: 'Validated at (EG)' },
    { key: 'method', header: 'Method' },
    { key: 'scope', header: 'Scope' },
    { key: 'status', header: 'Status' },
    { key: 'expected', header: 'Expected' },
    { key: 'counted', header: 'Counted' },
    { key: 'difference', header: 'Difference' },
    { key: 'entries', header: 'Entries', hideOnMobile: true },
    { key: 'by', header: 'By', hideOnMobile: true },
    { key: 'note', header: 'Note', hideOnMobile: true },
    { key: 'details', header: '' },
  ]

  const historyTableRows = historyRows.map((row) => ({
    id: row.id,
    validated_at: <span className="font-medium">{formatCairoDateTime(row.validated_at)}</span>,
    method: <Badge className={badgeClassForMethod(row.payment_method)}>{labelMethod(row.payment_method)}</Badge>,
    scope: (
      <div className="space-y-0.5">
        <div className="font-medium">{labelMode(row.validation_mode)}</div>
        <div className="text-xs text-[hsl(var(--muted))]">{row.validation_mode === 'cash_period' ? formatRangeLabel(row) : formatDateOnly(row.business_date)}</div>
      </div>
    ),
    status: row.superseded_by_batch_id
      ? <Badge className="bg-amber-50 text-amber-800">Superseded</Badge>
      : <Badge className={differenceBadgeClass(row.difference_amount)}>{differenceStatusLabel(row.difference_amount)}</Badge>,
    expected: <span className="font-semibold">{formatEGP(row.expected_amount)}</span>,
    counted: <span className="font-semibold">{formatEGP(row.counted_amount)}</span>,
    difference: <span className={`font-semibold ${differenceTextClass(row.difference_amount)}`}>{formatEGP(row.difference_amount)}</span>,
    entries: <span className="text-sm">{itemsCountByBatchId.get(row.id) ?? 0}</span>,
    by: <span className="text-sm">{profileLabel(row.validator)}</span>,
    note: <span className="text-sm text-[hsl(var(--muted))]">{row.note ?? '—'}</span>,
    details: (
      <Link
        prefetch={false}
        className="inline-flex items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
        href={`/admin/payments/reconciliation?${buildQS({ ...stateParams, focus_batch: row.id })}#history-details`}
      >
        Details
      </Link>
    ),
  }))

  const hasErrors = groupsErr || eventsErr || historyErr || batchItemsErr || approversErr || focusItemsErr || focusSubEventsErr || focusExternalEventsErr || focusBankMatchErr

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Card className="border-black/10 bg-gradient-to-br from-white to-black/[0.02]">
        <CardContent className="space-y-5 py-5 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-black text-white">Payments</Badge>
                <Badge className={canCreateValidations ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}>
                  {canCreateValidations ? 'Can validate' : 'Read-only'}
                </Badge>
              </div>
              <h1 className="text-2xl font-semibold sm:text-3xl">Admin · Payments Reconciliation</h1>
              <p className="text-sm text-[hsl(var(--muted))] sm:text-base">
                Validate one Cairo business day at a time, separately for Cash, Instapay, Card and Bank transfer. Payments before 01/08/2026 are treated as already validated historical records.
              </p>
              <div className="text-sm text-[hsl(var(--muted))]">
                Signed in as <span className="font-medium text-[hsl(var(--fg))]">{me.email || 'unknown'}</span> · {approverHelperText(canCreateValidations, me.role)}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-xl hover:bg-gray-50">
                ← Admin
              </Link>
              <Link prefetch={false} href="/admin/payments" className="border px-4 py-2 rounded-xl hover:bg-gray-50">
                Payments
              </Link>
              <Link prefetch={false} href="/admin/external-income" className="border px-4 py-2 rounded-xl hover:bg-gray-50">
                Other Income
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a href="#overview" className={sectionLinkClass(true)}>Overview</a>
            <a href="#governance" className={sectionLinkClass(false)}>Governance</a>
            <a href="#validate" className={sectionLinkClass(false)}>Validate now</a>
            <a href="#open-scopes" className={sectionLinkClass(false)}>Open scopes</a>
            <a href="#history" className={sectionLinkClass(false)}>History</a>
            <a href="#manage" className={sectionLinkClass(false)}>Manage batches</a>
          </div>
        </CardContent>
      </Card>

      {flashError ? (
        <InlineAlert variant="error" title="Validation failed">
          {flashError}
        </InlineAlert>
      ) : null}

      {flashCreated ? (
        <InlineAlert variant="success" title="Validation saved">
          Validation batch {flashBatch || 'created'} was saved successfully.
        </InlineAlert>
      ) : null}

      {flashUpdated ? (
        <InlineAlert variant="success" title="Validation updated">
          Validation batch {flashBatch || 'updated'} was updated successfully.
        </InlineAlert>
      ) : null}

      {sp1(searchParams, 'corrected') === '1' ? (
        <InlineAlert variant="success" title="Payment corrected and scope revalidated">
          The previous batch and payment snapshot remain in the audit history. Review the new batch and add fresh proof if needed.
        </InlineAlert>
      ) : null}

      {flashDeleted ? (
        <InlineAlert variant="success" title="Validation deleted">
          Validation batch {flashBatch || 'deleted'} was deleted and {flashReleased || '0'} linked entr{flashReleased === '1' ? 'y was' : 'ies were'} reopened for reconciliation.
        </InlineAlert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Choose days to validate</CardTitle>
          <div className="text-sm text-[hsl(var(--muted))]">Select an inclusive date range; each day and method still requires its own validation. Before 01/08/2026 is historical and already considered validated.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" action="/admin/payments/reconciliation" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {methodFilter !== 'all' ? <input type="hidden" name="method" value={methodFilter} /> : null}
            <Input type="date" label="From (Cairo day)" name="scope_from" min={BASELINE} defaultValue={effectiveFrom} required />
            <Input type="date" label="To (Cairo day)" name="scope_to" min={BASELINE} defaultValue={scopeTo} required />
            <Button type="submit">Show days</Button>
          </form>
          {invalidRange ? <InlineAlert variant="error" title="Invalid period">The start date must not be after the end date.</InlineAlert> : null}
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
            Current filter: <span className="font-medium text-[hsl(var(--fg))]">{methodFilter === 'all' ? 'All methods' : labelMethod(methodFilter)}</span>
          </div>
        </CardContent>
      </Card>

      <section id="overview" className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Overview</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Fast totals for what is still open before reconciliation.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {summaryCards.map((card) => (
            <Card key={card.label} className={summaryToneClass(card.tone)}>
              <CardContent className="py-4">
                <div className="text-xs text-[hsl(var(--muted))]">{card.label}</div>
                <div className="mt-1 text-xl font-semibold">{card.value}</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">{card.sub}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="governance">
        <Card>
          <CardHeader>
            <CardTitle>Super Admin governance</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">Only Super Admin can view or manage reconciliation, proofs, and bank matching. Historical approvals are retained but do not grant access.</div>
          </CardHeader>
        </Card>
      </section>

      <section id="validate">
        <Card>
          <CardHeader>
            <CardTitle>Validate now</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">
              Only the days in your selected period are shown. Each method and day is validated on its own.
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canCreateValidations ? (
              <InlineAlert variant="warning" title="Read-only access">
                Only Super Admin can create validation batches.
              </InlineAlert>
            ) : null}

            {!createGroups.length ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                No open scopes are available for validation right now.
              </div>
            ) : null}

            {createGroups.length ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {validateSummaryRows.map((row) => (
                    <div key={`${row.method}:${row.title}`} className={`rounded-2xl border p-4 ${summaryToneClass(row.method)}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs text-[hsl(var(--muted))]">{row.title}</div>
                          <div className="mt-1 text-lg font-semibold">{formatEGP(row.expectedAmount)}</div>
                        </div>
                        <Badge className={badgeClassForMethod(row.method)}>{labelMethod(row.method)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-[hsl(var(--muted))]">{row.helper}</div>
                      <div className="mt-2 text-xs text-[hsl(var(--muted))]">{row.groupCount} scope{row.groupCount === 1 ? '' : 's'} · {row.lineCount} entr{row.lineCount === 1 ? 'y' : 'ies'}</div>
                    </div>
                  ))}
                </div>


                {dailyValidationSections.length ? (
                  <div className="grid gap-4 xl:grid-cols-3">
                    {dailyValidationSections.map((section) => {
                      const visibleRows = section.rows.slice(0, 3)
                      const hiddenRows = section.rows.slice(3)
                      return (
                        <Card key={section.method} className="overflow-hidden border-black/10">
                          <div className={`h-1.5 w-full ${methodBarClass(section.method)}`} />
                          <CardHeader>
                            <div className="flex items-center gap-2 flex-wrap">
                              <CardTitle>{labelMethod(section.method)}</CardTitle>
                              <Badge className={badgeClassForMethod(section.method)}>{section.groupCount} open day{section.groupCount === 1 ? '' : 's'}</Badge>
                            </div>
                            <div className="text-sm text-[hsl(var(--muted))]">
                              {section.groupCount === 1 ? formatDateOnly(section.latestBusinessDate) : `${formatDateOnly(section.earliestBusinessDate)} → ${formatDateOnly(section.latestBusinessDate)}`} · {section.totalLines} entr{section.totalLines === 1 ? 'y' : 'ies'} · {formatEGP(section.totalAmount)}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {visibleRows.map((row) => {
                              const hiddenBusinessDate = row.business_date ?? ''
                              return (
                                <div key={`${section.method}:${row.business_date}`} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                                  <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                      <div className="font-medium">{formatDateOnly(row.business_date)}</div>
                                      <div className="text-xs text-[hsl(var(--muted))]">{row.line_count} entr{row.line_count === 1 ? 'y' : 'ies'} · {formatEGP(row.expected_amount)}</div>
                                    </div>
                                    <div className="text-right text-xs text-[hsl(var(--muted))]">
                                      <div>{formatCairoDateTime(row.period_from)}</div>
                                      <div>{formatCairoDateTime(row.period_to)}</div>
                                    </div>
                                  </div>

                                  <form action={createValidationAction} className="mt-3 grid gap-3">
                                    <input type="hidden" name="return_qs" value={filterQS} />
                                    <input type="hidden" name="payment_method" value={row.payment_method} />
                                    <input type="hidden" name="validation_mode" value={row.validation_mode} />
                                    <input type="hidden" name="business_date" value={hiddenBusinessDate} />
                                    <input type="hidden" name="expected_amount" value={amountInputValue(row.expected_amount)} />
                                    <input type="hidden" name="line_count" value={String(row.line_count)} />

                                    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_auto] lg:items-end">
                                      <label className="space-y-1 text-sm">
                                        <span className="font-medium">Counted amount</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          name="counted_amount"
                                          defaultValue={amountInputValue(row.expected_amount)}
                                          required
                                          disabled={!canCreateValidations}
                                          className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                                        />
                                      </label>

                                      <label className="space-y-1 text-sm">
                                        <span className="font-medium">Note</span>
                                        <textarea
                                          name="note"
                                          rows={2}
                                          placeholder="Optional when counted matches expected. Required on a difference."
                                          disabled={!canCreateValidations}
                                          className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                                        />
                                      </label>

                                      <ConfirmSubmitButton
                                        disabled={!canCreateValidations}
                                        confirmTitle="Confirm day validation"
                                        confirmDescription="This will create a payment validation batch for this Cairo business date."
                                        confirmButtonLabel="Confirm day validation"
                                        pendingLabel="Validating…"
                                        staticItems={[
                                          { label: 'Date', value: formatDateOnly(row.business_date) },
                                          { label: 'Method', value: labelMethod(row.payment_method) },
                                          { label: 'Expected amount', value: formatEGP(row.expected_amount) },
                                          { label: 'Entries', value: row.line_count },
                                        ]}
                                        fieldItems={[
                                          { label: 'Counted amount', name: 'counted_amount', kind: 'egp' },
                                          { label: 'Note', name: 'note', emptyValue: 'No note', maxLength: 140 },
                                        ]}
                                        difference={{ expectedName: 'expected_amount', countedName: 'counted_amount', label: 'Difference' }}
                                      >
                                        Validate day
                                      </ConfirmSubmitButton>
                                    </div>
                                  </form>
                                </div>
                              )
                            })}

                            {hiddenRows.length ? (
                              <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                                <summary className="cursor-pointer list-none text-sm font-medium">
                                  Show {hiddenRows.length} more open day{hiddenRows.length === 1 ? '' : 's'}
                                </summary>
                                <div className="mt-3 space-y-3">
                                  {hiddenRows.map((row) => {
                                    const hiddenBusinessDate = row.business_date ?? ''
                                    return (
                                      <div key={`${section.method}:${row.business_date}:hidden`} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                                        <div className="flex items-start justify-between gap-3 flex-wrap">
                                          <div>
                                            <div className="font-medium">{formatDateOnly(row.business_date)}</div>
                                            <div className="text-xs text-[hsl(var(--muted))]">{row.line_count} entr{row.line_count === 1 ? 'y' : 'ies'} · {formatEGP(row.expected_amount)}</div>
                                          </div>
                                          <div className="text-right text-xs text-[hsl(var(--muted))]">
                                            <div>{formatCairoDateTime(row.period_from)}</div>
                                            <div>{formatCairoDateTime(row.period_to)}</div>
                                          </div>
                                        </div>

                                        <form action={createValidationAction} className="mt-3 grid gap-3">
                                          <input type="hidden" name="return_qs" value={filterQS} />
                                          <input type="hidden" name="payment_method" value={row.payment_method} />
                                          <input type="hidden" name="validation_mode" value={row.validation_mode} />
                                          <input type="hidden" name="business_date" value={hiddenBusinessDate} />
                                          <input type="hidden" name="expected_amount" value={amountInputValue(row.expected_amount)} />
                                          <input type="hidden" name="line_count" value={String(row.line_count)} />

                                          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_auto] lg:items-end">
                                            <label className="space-y-1 text-sm">
                                              <span className="font-medium">Counted amount</span>
                                              <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                name="counted_amount"
                                                defaultValue={amountInputValue(row.expected_amount)}
                                                required
                                                disabled={!canCreateValidations}
                                                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                                              />
                                            </label>

                                            <label className="space-y-1 text-sm">
                                              <span className="font-medium">Note</span>
                                              <textarea
                                                name="note"
                                                rows={2}
                                                placeholder="Optional when counted matches expected. Required on a difference."
                                                disabled={!canCreateValidations}
                                                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                                              />
                                            </label>

                                            <ConfirmSubmitButton
                                              disabled={!canCreateValidations}
                                              confirmTitle="Confirm day validation"
                                              confirmDescription="This will create a payment validation batch for this Cairo business date."
                                              confirmButtonLabel="Confirm day validation"
                                              pendingLabel="Validating…"
                                              staticItems={[
                                                { label: 'Date', value: formatDateOnly(row.business_date) },
                                                { label: 'Method', value: labelMethod(row.payment_method) },
                                                { label: 'Expected amount', value: formatEGP(row.expected_amount) },
                                                { label: 'Entries', value: row.line_count },
                                              ]}
                                              fieldItems={[
                                                { label: 'Counted amount', name: 'counted_amount', kind: 'egp' },
                                                { label: 'Note', name: 'note', emptyValue: 'No note', maxLength: 140 },
                                              ]}
                                              difference={{ expectedName: 'expected_amount', countedName: 'counted_amount', label: 'Difference' }}
                                            >
                                              Validate day
                                            </ConfirmSubmitButton>
                                          </div>
                                        </form>
                                      </div>
                                    )
                                  })}
                                </div>
                              </details>
                            ) : null}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {hasErrors ? (
        <Card>
          <CardContent className="space-y-1 py-4 text-sm text-rose-700">
            {groupsErr ? <div>Open groups failed to load: {groupsErr.message}</div> : null}
            {eventsErr ? <div>Open entries failed to load: {eventsErr.message}</div> : null}
            {historyErr ? <div>History failed to load: {historyErr.message}</div> : null}
            {batchItemsErr ? <div>History item counts failed to load: {batchItemsErr.message}</div> : null}
            {approversErr ? <div>Approvers failed to load: {approversErr.message}</div> : null}
            {focusItemsErr ? <div>Focused batch items failed to load: {focusItemsErr.message}</div> : null}
            {focusSubEventsErr ? <div>Focused subscription items failed to load: {focusSubEventsErr.message}</div> : null}
            {focusExternalEventsErr ? <div>Focused external-income items failed to load: {focusExternalEventsErr.message}</div> : null}
            {focusBankMatchErr ? <div>Focused bank matches failed to load: {focusBankMatchErr.message}</div> : null}
          </CardContent>
        </Card>
      ) : null}

      <section id="open-scopes" className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Open scopes</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Open entries between {formatDateOnly(effectiveFrom)} and {formatDateOnly(scopeTo)}, grouped by day and payment method.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {openScopeSummaryRows.length ? openScopeSummaryRows.map((row) => (
            <div key={`open-scope:${row.method}`} className={`rounded-2xl border p-4 ${summaryToneClass(row.method)}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{labelMethod(row.method)}</div>
                <Badge className={badgeClassForMethod(row.method)}>{row.groupCount} scope{row.groupCount === 1 ? '' : 's'}</Badge>
              </div>
              <div className="mt-2 text-lg font-semibold">{formatEGP(row.expectedAmount)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.lineCount} entr{row.lineCount === 1 ? 'y' : 'ies'} · {row.scopeLabel}</div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))] md:col-span-2 xl:col-span-4">
              No open scopes right now for the current filter.
            </div>
          )}
        </div>

        <div className="grid gap-4">

          <Card>
            <CardHeader>
              <CardTitle>Open daily groups</CardTitle>
              <div className="text-sm text-[hsl(var(--muted))]">Cash, Instapay, Card, and Bank transfer are each reconciled separately for each Cairo business day.</div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!openDailyTableRows.length ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                  No open daily groups right now for the current filter.
                </div>
              ) : (
                <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3" open={openDailyTableRows.length <= 6}>
                  <summary className="cursor-pointer list-none text-sm font-medium">Show {openDailyTableRows.length} open daily group{openDailyTableRows.length === 1 ? '' : 's'}</summary>
                  <div className="mt-3">
                    <Table columns={openDailyColumns} rows={openDailyTableRows as any} keyField="id" stickyTopClassName="top-0" />
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Open entry preview</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">Preview only, capped to keep the page light. Validation still uses all open lines inside the selected scope.</div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!openEventsTableRows.length ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                No open entries right now for the current filter.
              </div>
            ) : (
              <>
                <Table columns={openEventsColumns} rows={openEventsTableRows as any} keyField="id" stickyTopClassName="top-0" />
                {openEventsOverflowTableRows.length ? (
                  <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                    <summary className="cursor-pointer list-none text-sm font-medium">Show {openEventsOverflowTableRows.length} more open entr{openEventsOverflowTableRows.length === 1 ? 'y' : 'ies'}</summary>
                    <div className="mt-3">
                      <Table columns={openEventsColumns} rows={openEventsOverflowTableRows as any} keyField="id" stickyTopClassName="top-0" />
                    </div>
                  </details>
                ) : null}
              </>
            )}
            <div className="text-xs text-[hsl(var(--muted))]">
              Showing {Math.min(openEvents.length, openEventsPreviewLimit)} of {openEvents.length} open line{openEvents.length === 1 ? '' : 's'}{filterQS ? ` for ${labelMethod(methodFilter)}` : ''}. Validation creates a batch and links the current open lines without editing the source records.
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="history" className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">History</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Filter recent reconciliation batches, inspect who validated them, and open one batch in detail when you need audit visibility.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>History filters</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">These filters affect the history table and the batch-management list below.</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="get" className="grid gap-3 lg:grid-cols-5">
              {methodFilter !== 'all' ? <input type="hidden" name="method" value={methodFilter} /> : null}
              <input type="hidden" name="scope_from" value={effectiveFrom} />
              <input type="hidden" name="scope_to" value={scopeTo} />
              <div className="space-y-1">
                <label htmlFor="history_status" className="text-sm font-medium">Status</label>
                <select id="history_status" name="history_status" defaultValue={historyStatus} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  <option value="all">All statuses</option>
                  <option value="matched">Matched</option>
                  <option value="over">Over</option>
                  <option value="short">Short</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="history_by" className="text-sm font-medium">Validated by</label>
                <select id="history_by" name="history_by" defaultValue={historyByRaw ?? 'all'} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                  <option value="all">All approvers</option>
                  <option value="me">Me</option>
                  {validatorOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <Input id="history_from" name="history_from" type="date" label="From" defaultValue={historyFrom} />
              <Input id="history_to" name="history_to" type="date" label="To" defaultValue={historyTo} />

              <div className="flex items-end gap-2">
                <Button type="submit">Apply</Button>
                <Link prefetch={false} href={historyFilterResetHref} className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-black/[0.03]">
                  Reset
                </Link>
              </div>
            </form>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Filtered batches</div>
                <div className="mt-1 text-lg font-semibold">{currentHistoryRows.length}</div>
                <div className="text-xs text-[hsl(var(--muted))]">+ {historyRows.length - currentHistoryRows.length} superseded snapshots in history</div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Matched</div>
                <div className="mt-1 text-lg font-semibold">{historyMatchedCount}</div>
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Over</div>
                <div className="mt-1 text-lg font-semibold">{historyOverCount}</div>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-3">
                <div className="text-xs text-[hsl(var(--muted))]">Short</div>
                <div className="mt-1 text-lg font-semibold">{historyShortCount}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent validation history</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">Matched means counted amount equals expected amount. Use Details to inspect the linked source lines snapshot for one batch.</div>
          </CardHeader>
          <CardContent>
            {!historyTableRows.length ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                No validation history matches the current filters.
              </div>
            ) : null}
            <Table columns={historyColumns} rows={historyTableRows as any} keyField="id" stickyTopClassName="top-0" />
          </CardContent>
        </Card>
      </section>

      {focusBatch ? (
        <section id="history-details">
          <Card>
            <CardHeader>
              <CardTitle>Selected batch details</CardTitle>
              <div className="text-sm text-[hsl(var(--muted))]">Batch {String(focusBatch.id).slice(0, 8)} · {labelMethod(focusBatch.payment_method)} · {labelMode(focusBatch.validation_mode)}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                  <div className="text-xs text-[hsl(var(--muted))]">Scope</div>
                  <div className="mt-1 font-semibold">{focusBatch.validation_mode === 'cash_period' ? formatRangeLabel(focusBatch) : formatDateOnly(focusBatch.business_date)}</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                  <div className="text-xs text-[hsl(var(--muted))]">Validated at</div>
                  <div className="mt-1 font-semibold">{formatCairoDateTime(focusBatch.validated_at)}</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                  <div className="text-xs text-[hsl(var(--muted))]">Validated by</div>
                  <div className="mt-1 font-semibold">{profileLabel(focusBatch.validator)}</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                  <div className="text-xs text-[hsl(var(--muted))]">Expected / counted</div>
                  <div className="mt-1 font-semibold">{formatEGP(focusBatch.expected_amount)} / {formatEGP(focusBatch.counted_amount)}</div>
                </div>
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                  <div className="text-xs text-[hsl(var(--muted))]">Difference</div>
                  <div className={`mt-1 font-semibold ${differenceTextClass(focusBatch.difference_amount)}`}>{formatEGP(focusBatch.difference_amount)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/20 p-3 text-sm text-[hsl(var(--muted))]">
                Current note: <span className="font-medium text-[hsl(var(--fg))]">{focusBatch.note ?? '—'}</span>
              </div>
              {focusBatch.superseded_by_batch_id ? (
                <InlineAlert variant="warning" title="Historical validation superseded">
                  This snapshot was preserved after a payment correction. <Link href={`/admin/payments/reconciliation?${buildQS({ ...stateParams, focus_batch: focusBatch.superseded_by_batch_id })}#history-details`} className="underline">Open its replacement batch</Link>.
                </InlineAlert>
              ) : null}

              {!focusItems.length ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                  No linked items were found for this batch.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-[hsl(var(--muted))]">Linked items snapshot ({focusItems.length})</div>
                  <div className="space-y-3">
                    {focusItems.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={badgeClassForMethod(focusBatch.payment_method)}>{labelMethod(focusBatch.payment_method)}</Badge>
                              <Badge className="bg-slate-100 text-slate-700">{eventSourceLabel({ source_kind: item.source_kind, source_id: item.source_id, member_id: item.member_id, source_key: item.source_key, title: item.title, note: item.note, amount: item.amount_snapshot, payment_method_norm: focusBatch.payment_method, payment_method_raw: null, business_date: item.business_date_snapshot, event_at: item.event_at_snapshot })}</Badge>
                            </div>
                            <div className="font-semibold">{item.title}</div>
                            {item.released_at ? <div className="text-xs text-amber-800">Original snapshot released on {formatCairoDateTime(item.released_at)}</div> : null}
                            <div className="text-xs text-[hsl(var(--muted))]">Business date {formatDateOnly(item.business_date_snapshot)} · Event {formatCairoDateTime(item.event_at_snapshot)}</div>
                            <div className="text-xs text-[hsl(var(--muted))]">Source id {item.source_id.slice(0, 8)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs text-[hsl(var(--muted))]">Amount snapshot</div>
                            <div className="font-semibold">{formatEGP(item.amount_snapshot)}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                          <div className="text-sm text-[hsl(var(--muted))]">{item.note ?? 'No note on this source line.'}</div>
                          <Link
                            prefetch={false}
                            className="inline-flex items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
                            href={item.source_kind === 'subscription_payment' && item.member_id ? `/members/${item.member_id}` : '/admin/external-income'}
                          >
                            Open source
                          </Link>
                        </div>
                        {!focusBatch.superseded_by_batch_id && !item.released_at && !focusBankMatchErr && focusItems.every((entry) => entry.business_date_snapshot >= BASELINE) ? (
                          <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                            <summary className="cursor-pointer text-sm font-semibold text-amber-950">Correct this payment and revalidate its scope</summary>
                            <p className="mt-2 text-xs text-amber-900">The old batch and its proof remain historical. Other payments keep their amounts. Legacy cash closures retain their original range. A new proof or bank match may then be needed.</p>
                            {focusHasActiveBankMatch ? (
                              <div className="mt-3 text-sm text-amber-950">Release the bank match with a reason in <Link href="/admin/payments/reconciliation/bank-matching" className="underline">Bank Matching</Link> before correcting this payment.</div>
                            ) : <form action={correctAndRevalidateAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                              <input type="hidden" name="return_qs" value={filterQS} />
                              <input type="hidden" name="batch_id" value={focusBatch.id} />
                              <input type="hidden" name="source_kind" value={item.source_kind} />
                              <input type="hidden" name="source_id" value={item.source_id} />
                              <input type="hidden" name="old_amount" value={amountInputValue(item.amount_snapshot)} />
                              <Input label="Corrected payment amount" name="new_amount" type="number" step="0.01" min="0.01" defaultValue={amountInputValue(item.amount_snapshot)} required />
                              <Input label="Recounted scope total" name="counted_amount" type="number" step="0.01" min="0" defaultValue={amountInputValue(focusBatch.counted_amount)} hint={`Previous total: ${formatEGP(focusBatch.counted_amount)}. Enter the new verified total.`} required />
                              <div className="sm:col-span-2"><Textarea label="Why is this amount being corrected?" name="reason" minLength={5} maxLength={500} required rows={2} /></div>
                              <div className="sm:col-span-2"><ConfirmSubmitButton
                                confirmTitle="Correct payment and replace day validation"
                                confirmDescription="This changes the source payment amount and, for a subscription payment, adjusts its paid and outstanding balances. It supersedes the whole day/method batch while preserving the old batch, item snapshots and proof. An active bank match blocks this action."
                                confirmButtonLabel="Correct and revalidate"
                                pendingLabel="Revalidating…"
                                staticItems={[{ label: 'Payment', value: item.title }, { label: 'Previous amount', value: formatEGP(item.amount_snapshot) }, { label: 'Scope and method', value: `${formatRangeLabel(focusBatch)} · ${labelMethod(focusBatch.payment_method)}` }]}
                                fieldItems={[{ label: 'New amount', name: 'new_amount', kind: 'egp' }, { label: 'New counted total', name: 'counted_amount', kind: 'egp' }, { label: 'Reason', name: 'reason' }]}
                              >Correct and revalidate</ConfirmSubmitButton></div>
                            </form>}
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section id="manage">
        <Card>
          <CardHeader>
            <CardTitle>Manage recent batches</CardTitle>
            <div className="text-sm text-[hsl(var(--muted))]">
              Edit only the counted amount and note. Delete a batch to reopen its linked entries for reconciliation. Source payment records stay unchanged.
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canCreateValidations ? (
              <InlineAlert variant="warning" title="Read-only access">
                Only active approvers or Super Admin can edit or delete validation batches.
              </InlineAlert>
            ) : null}

            {!historyRows.length ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                No validation batches are available to manage right now.
              </div>
            ) : null}

            <div className="space-y-3">
              {historyRows.filter((row) => !row.superseded_by_batch_id).map((row) => {
                const batchLabel = String(row.id).slice(0, 8)
                const entriesCount = itemsCountByBatchId.get(row.id) ?? 0
                const differenceTone = differenceTextClass(row.difference_amount)
                return (
                  <details key={`manage-${row.id}`} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={badgeClassForMethod(row.payment_method)}>{labelMethod(row.payment_method)}</Badge>
                          <Badge className={differenceBadgeClass(row.difference_amount)}>{differenceStatusLabel(row.difference_amount)}</Badge>
                          <span className="text-sm font-semibold">Batch {batchLabel}</span>
                          <span className="text-xs text-[hsl(var(--muted))]">{labelMode(row.validation_mode)} · {row.validation_mode === 'cash_period' ? formatRangeLabel(row) : formatDateOnly(row.business_date)}</span>
                        </div>
                        <div className="text-xs text-[hsl(var(--muted))]">Validated {formatCairoDateTime(row.validated_at)} · {entriesCount} entr{entriesCount === 1 ? 'y' : 'ies'} · by {profileLabel(row.validator)}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-[hsl(var(--muted))]">Current counted</div>
                        <div className="font-semibold">{formatEGP(row.counted_amount)}</div>
                      </div>
                    </summary>

                    <div className="space-y-4 border-t border-[hsl(var(--border))] p-4">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Expected</div>
                          <div className="mt-1 font-semibold">{formatEGP(row.expected_amount)}</div>
                        </div>
                        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Current counted</div>
                          <div className="mt-1 font-semibold">{formatEGP(row.counted_amount)}</div>
                        </div>
                        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Difference</div>
                          <div className={`mt-1 font-semibold ${differenceTone}`}>{formatEGP(row.difference_amount)}</div>
                        </div>
                        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Entries</div>
                          <div className="mt-1 font-semibold">{entriesCount}</div>
                        </div>
                        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-3">
                          <div className="text-xs text-[hsl(var(--muted))]">Current note</div>
                          <div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.note ?? '—'}</div>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <form action={updateValidationBatchAction} className="space-y-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                          <input type="hidden" name="return_qs" value={filterQS} />
                          <input type="hidden" name="batch_id" value={row.id} />

                          <div className="grid gap-3 sm:grid-cols-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              name="counted_amount"
                              label="Counted amount"
                              defaultValue={amountInputValue(row.counted_amount)}
                              hint={`Expected stays ${amountInputValue(row.expected_amount)} EGP.`}
                              required
                              disabled={!canCreateValidations}
                            />

                            <Textarea
                              name="note"
                              label="Note"
                              rows={4}
                              defaultValue={row.note ?? ''}
                              placeholder="Required when counted amount differs from expected."
                              disabled={!canCreateValidations}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-xs text-[hsl(var(--muted))]">
                              Editing a batch updates only its counted amount and note. Linked source lines stay the same.
                            </div>
                            <Button type="submit" disabled={!canCreateValidations}>
                              Save changes
                            </Button>
                          </div>
                        </form>

                        <form action={deleteValidationBatchAction} className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
                          <input type="hidden" name="return_qs" value={filterQS} />
                          <input type="hidden" name="batch_id" value={row.id} />

                          <div className="space-y-1">
                            <div className="font-semibold text-rose-900">Delete validation batch</div>
                            <div className="text-sm text-rose-800">
                              This soft-deletes batch {batchLabel} and reopens its linked entries for reconciliation. Source payment records are not edited.
                            </div>
                          </div>

                          <div className="text-xs text-rose-800">
                            Reopened scope will show again in the open groups section after deletion.
                          </div>

                          <Button
                            type="submit"
                            variant="outline"
                            disabled={!canCreateValidations}
                            className="border-rose-300 text-rose-700 hover:bg-rose-50"
                          >
                            Delete batch
                          </Button>
                        </form>
                      </div>
                    </div>
                  </details>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
