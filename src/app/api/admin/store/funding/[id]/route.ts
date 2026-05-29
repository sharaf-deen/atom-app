export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { parsePriceToCents } from '@/lib/money'

const STORE_FUNDING_BUCKET = 'store-funding-attachments'
const FUNDING_TYPES = new Set(['loan_received', 'loan_repayment'])
const PAYMENT_METHODS = new Set(['cash', 'card', 'bank_transfer', 'instapay'])
const FUNDING_SELECT = 'id,funding_date,type,title,amount_cents,payment_method,attachment_path,created_at,updated_at'

type RouteContext = {
  params?: { id?: string } | Promise<{ id?: string }>
}

type StoreFundingBeforeRow = {
  id: string
  funding_date: string | null
  type: string | null
  title: string | null
  amount_cents: number | null
  payment_method: string | null
  attachment_path: string | null
  created_at?: string | null
  updated_at?: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function safeStr(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanIdCandidate(value: unknown) {
  const raw = safeStr(value)
  if (!raw) return ''

  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {}

  return decoded.replace(/^['"]+|['"]+$/g, '').trim()
}

function firstValidUuid(values: unknown[]) {
  for (const value of values) {
    const cleaned = cleanIdCandidate(value)
    if (isUuid(cleaned)) return cleaned
  }
  return ''
}

function normalizePriceInput(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return raw

  let cleaned = raw.replace(/\s+/g, '').replace(/[^0-9.,-]/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(',', '.')
  }

  return cleaned
}

function pad2(value: string | number) {
  return String(value).padStart(2, '0')
}

function validDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

function normalizeDateInput(value: unknown) {
  const raw = safeStr(value)
  if (!raw) return ''
  if (isDateOnly(raw)) return raw

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const first = Number(slash[1])
    const second = Number(slash[2])
    const year = Number(slash[3])

    const month = first > 12 ? second : first
    const day = first > 12 ? first : second

    if (validDateParts(year, month, day)) return `${year}-${pad2(month)}-${pad2(day)}`
  }

  return ''
}

function normalizeToken(value: unknown) {
  return safeStr(value).toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizeFundingType(value: unknown) {
  const token = normalizeToken(value)
  if (!token) return ''
  if (token === 'loan_received' || token === 'loan' || token === 'received' || token === 'loanreceived') return 'loan_received'
  if (token === 'loan_repayment' || token === 'repayment' || token === 'loanrepayment') return 'loan_repayment'
  return FUNDING_TYPES.has(token) ? token : ''
}

function normalizePaymentMethod(value: unknown) {
  const token = normalizeToken(value)
  if (!token) return ''
  if (token === 'bank' || token === 'bank_transfer' || token === 'transfer' || token === 'banktransfer') return 'bank_transfer'
  if (token === 'cash') return 'cash'
  if (token === 'card' || token === 'visa' || token === 'visa_in_gym') return 'card'
  if (token === 'instapay' || token === 'insta_pay') return 'instapay'
  return PAYMENT_METHODS.has(token) ? token : ''
}

function parseIntField(value: unknown) {
  const n = Number.parseInt(safeStr(value), 10)
  return Number.isFinite(n) ? n : null
}

async function readParams(context?: RouteContext) {
  const params = context?.params
  if (!params) return {}
  return typeof (params as any)?.then === 'function' ? await params : params
}

async function readFundingId(req: Request, context?: RouteContext, form?: FormData | null) {
  const params = await readParams(context)
  const url = new URL(req.url)
  const lastPathSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')

  return firstValidUuid([
    req.headers.get('x-store-funding-id'),
    req.headers.get('x-funding-id'),
    req.headers.get('x-entry-id'),
    params?.id,
    url.searchParams.get('id'),
    url.searchParams.get('funding_id'),
    url.searchParams.get('entry_id'),
    url.searchParams.get('target_id'),
    form?.get('id'),
    form?.get('funding_id'),
    form?.get('entry_id'),
    form?.get('target_id'),
    form?.get('store_funding_id'),
    form?.get('original_id'),
    lastPathSegment,
  ])
}

async function lookupById(admin: ReturnType<typeof createSupabaseAdminClient>, id: string) {
  return admin
    .from('store_external_funding')
    .select(FUNDING_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle<StoreFundingBeforeRow>()
}

async function lookupByOriginalRow(admin: ReturnType<typeof createSupabaseAdminClient>, form: FormData) {
  const originalId = firstValidUuid([
    form.get('original_id'),
    form.get('id'),
    form.get('funding_id'),
    form.get('entry_id'),
    form.get('target_id'),
    form.get('store_funding_id'),
  ])

  if (originalId) {
    const byOriginalId = await lookupById(admin, originalId)
    if (byOriginalId.error) return { data: null, error: byOriginalId.error, ambiguous: false }
    if (byOriginalId.data) return { data: byOriginalId.data, error: null, ambiguous: false }
  }

  const originalCreatedAt = safeStr(form.get('original_created_at'))
  if (originalCreatedAt) {
    const byCreatedAt = await admin
      .from('store_external_funding')
      .select(FUNDING_SELECT)
      .eq('created_at', originalCreatedAt)
      .is('deleted_at', null)
      .limit(2)

    if (byCreatedAt.error) return { data: null, error: byCreatedAt.error, ambiguous: false }
    if ((byCreatedAt.data || []).length === 1) return { data: byCreatedAt.data![0] as StoreFundingBeforeRow, error: null, ambiguous: false }
    if ((byCreatedAt.data || []).length > 1) return { data: null, error: null, ambiguous: true }
  }

  const fundingDate = normalizeDateInput(form.get('original_funding_date'))
  const type = normalizeFundingType(form.get('original_type'))
  const title = safeStr(form.get('original_title'))
  const amountCents = parseIntField(form.get('original_amount_cents'))
  const paymentMethod = normalizePaymentMethod(form.get('original_payment_method'))

  if (!fundingDate || !type || !title || amountCents === null || !paymentMethod) {
    return { data: null, error: null, ambiguous: false }
  }

  const bySignature = await admin
    .from('store_external_funding')
    .select(FUNDING_SELECT)
    .eq('funding_date', fundingDate)
    .eq('type', type)
    .eq('title', title)
    .eq('amount_cents', amountCents)
    .eq('payment_method', paymentMethod)
    .is('deleted_at', null)
    .limit(2)

  if (bySignature.error) return { data: null, error: bySignature.error, ambiguous: false }
  if ((bySignature.data || []).length === 1) return { data: bySignature.data![0] as StoreFundingBeforeRow, error: null, ambiguous: false }
  if ((bySignature.data || []).length > 1) return { data: null, error: null, ambiguous: true }

  return { data: null, error: null, ambiguous: false }
}

async function resolveTargetFunding(admin: ReturnType<typeof createSupabaseAdminClient>, req: Request, context: RouteContext | undefined, form: FormData) {
  const id = await readFundingId(req, context, form)

  if (id) {
    const byId = await lookupById(admin, id)
    if (byId.error) return { row: null, response: json(500, { ok: false, error: 'LOOKUP_FAILED', details: byId.error.message }) }
    if (byId.data) return { row: byId.data, response: null }
  }

  const fallback = await lookupByOriginalRow(admin, form)
  if (fallback.error) return { row: null, response: json(500, { ok: false, error: 'LOOKUP_FAILED', details: fallback.error.message }) }
  if (fallback.ambiguous) {
    return {
      row: null,
      response: json(400, {
        ok: false,
        error: 'AMBIGUOUS_FUNDING_TARGET',
        details: 'Could not safely identify one unique funding entry. Please refresh the Store funding page and try again.',
      }),
    }
  }
  if (fallback.data) return { row: fallback.data, response: null }

  return {
    row: null,
    response: json(400, {
      ok: false,
      error: 'INVALID_ID',
      details: 'Could not identify this funding entry from the id or original row data. Please refresh the Store funding page and try again.',
    }),
  }
}

async function requireSuperAdmin() {
  const authClient = createSupabaseServerActionClient()
  const admin = createSupabaseAdminClient()

  const { data: auth, error: authErr } = await authClient.auth.getUser()
  if (authErr) return { ok: false as const, response: json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message }) }
  if (!auth.user) return { ok: false as const, response: json(401, { ok: false, error: 'NOT_AUTHENTICATED' }) }

  const { data: me, error: meErr } = await authClient
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  if (meErr) return { ok: false as const, response: json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message }) }
  if (me?.role !== 'super_admin') return { ok: false as const, response: json(403, { ok: false, error: 'FORBIDDEN' }) }

  return { ok: true as const, userId: auth.user.id, admin }
}

async function uploadAttachment(admin: ReturnType<typeof createSupabaseAdminClient>, file: File, fundingDate: string) {
  const maxSize = 8 * 1024 * 1024
  if (file.size > maxSize) throw new Error('Attachment is too large. Max 8MB.')

  const mime = (file.type || '').toLowerCase()
  const ok = mime.startsWith('image/') || mime === 'application/pdf'
  if (!ok) throw new Error('Attachment must be an image or a PDF.')

  const originalName = (file.name || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_')
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  const path = `store-funding/${fundingDate}/${uuid}-${originalName}`
  const buffer = await file.arrayBuffer()

  const upload = await admin.storage.from(STORE_FUNDING_BUCKET).upload(path, buffer, {
    contentType: mime || 'application/octet-stream',
    upsert: false,
  })

  if (upload.error) throw new Error(upload.error.message || 'Attachment upload failed.')

  return {
    attachment_path: path,
    attachment_mime: mime || null,
    attachment_filename: file.name || null,
  }
}

async function updateFundingRow(admin: ReturnType<typeof createSupabaseAdminClient>, id: string, payload: Record<string, any>) {
  return admin
    .from('store_external_funding')
    .update(payload)
    .eq('id', id)
    .is('deleted_at', null)
}

export async function PATCH(req: Request, context: RouteContext) {
  let uploadedPathToCleanup: string | null = null

  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const form = await req.formData().catch(() => null)
    if (!form) return json(400, { ok: false, error: 'INVALID_FORM_DATA' })

    const admin = guard.admin
    const target = await resolveTargetFunding(admin, req, context, form)
    if (target.response) return target.response

    const before = target.row
    if (!before) return json(400, { ok: false, error: 'INVALID_ID', details: 'Missing or invalid funding target.' })

    const id = before.id
    const fundingDate = normalizeDateInput(form.get('funding_date')) || before.funding_date || ''
    const type = normalizeFundingType(form.get('type')) || before.type || ''
    const title = safeStr(form.get('title')) || before.title || ''
    const amountRaw = safeStr(form.get('amount'))
    const paymentMethod = normalizePaymentMethod(form.get('payment_method')) || before.payment_method || ''
    const sourceName = safeStr(form.get('source_name'))
    const note = safeStr(form.get('note'))

    if (!isDateOnly(fundingDate)) return json(400, { ok: false, error: 'INVALID_DATE', details: 'Funding date must be YYYY-MM-DD.' })
    if (!FUNDING_TYPES.has(type)) return json(400, { ok: false, error: 'INVALID_TYPE', details: 'Please choose Loan received or Loan repayment.' })
    if (!title) return json(400, { ok: false, error: 'TITLE_REQUIRED', details: 'Title is required.' })
    if (!PAYMENT_METHODS.has(paymentMethod)) return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD', details: 'Please choose a valid payment method.' })

    const amountCents = amountRaw
      ? parsePriceToCents(normalizePriceInput(amountRaw))
      : Number(before.amount_cents ?? 0)

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json(400, { ok: false, error: 'INVALID_AMOUNT', details: 'Amount must be greater than 0. Use 17264 or 17264.00.' })
    }

    const updatePayload: Record<string, any> = {
      funding_date: fundingDate,
      type,
      title,
      amount_cents: amountCents,
      currency: 'EGP',
      payment_method: paymentMethod,
      source_name: sourceName || null,
      note: note || null,
      updated_by: guard.userId,
    }

    const attachment = form.get('attachment')

    if (attachment && typeof (attachment as any)?.arrayBuffer === 'function') {
      const file = attachment as File
      if (file.size > 0) {
        const uploaded = await uploadAttachment(admin, file, fundingDate)
        uploadedPathToCleanup = uploaded.attachment_path
        Object.assign(updatePayload, uploaded)
      }
    }

    const { error: updateErr } = await updateFundingRow(admin, id, updatePayload)

    if (updateErr) {
      const { updated_by: _updatedBy, ...payloadWithoutAudit } = updatePayload
      const retry = await updateFundingRow(admin, id, payloadWithoutAudit)

      if (retry.error) {
        if (uploadedPathToCleanup) await admin.storage.from(STORE_FUNDING_BUCKET).remove([uploadedPathToCleanup]).catch(() => null)
        return json(400, {
          ok: false,
          error: 'UPDATE_FAILED',
          details: retry.error.message || updateErr.message || 'Update failed.',
          first_error: updateErr.message,
        })
      }
    }

    if (uploadedPathToCleanup && before.attachment_path && before.attachment_path !== uploadedPathToCleanup) {
      await admin.storage.from(STORE_FUNDING_BUCKET).remove([before.attachment_path]).catch(() => null)
    }

    try {
      revalidatePath('/admin/store/funding')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return json(200, { ok: true, id })
  } catch (error: any) {
    if (uploadedPathToCleanup) {
      try {
        const admin = createSupabaseAdminClient()
        await admin.storage.from(STORE_FUNDING_BUCKET).remove([uploadedPathToCleanup]).catch(() => null)
      } catch {}
    }

    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const id = await readFundingId(req, context, null)
    if (!id) return json(400, { ok: false, error: 'INVALID_ID', details: 'Missing or invalid funding id. Please refresh the Store funding page and try again.' })

    const { data: before, error: beforeErr } = await guard.admin
      .from('store_external_funding')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>()

    if (beforeErr) return json(500, { ok: false, error: 'LOOKUP_FAILED', details: beforeErr.message })
    if (!before) return json(404, { ok: false, error: 'NOT_FOUND' })

    const { error } = await guard.admin
      .from('store_external_funding')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: guard.userId,
        updated_by: guard.userId,
      })
      .eq('id', id)
      .is('deleted_at', null)

    if (error) {
      const retry = await guard.admin
        .from('store_external_funding')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .is('deleted_at', null)

      if (retry.error) return json(400, { ok: false, error: 'DELETE_FAILED', details: retry.error.message || error.message })
    }

    try {
      revalidatePath('/admin/store/funding')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return json(200, { ok: true, id })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
