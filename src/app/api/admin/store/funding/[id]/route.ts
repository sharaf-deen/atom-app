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

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value)
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function safeStr(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const id = String(params?.id || '').trim()
    if (!isUuid(id)) return json(400, { ok: false, error: 'INVALID_ID' })

    const form = await req.formData().catch(() => null)
    if (!form) return json(400, { ok: false, error: 'INVALID_FORM_DATA' })

    const fundingDate = safeStr(form.get('funding_date'))
    const type = safeStr(form.get('type'))
    const title = safeStr(form.get('title'))
    const amountRaw = safeStr(form.get('amount'))
    const paymentMethod = safeStr(form.get('payment_method'))
    const sourceName = safeStr(form.get('source_name'))
    const note = safeStr(form.get('note'))

    if (!isDateOnly(fundingDate)) return json(400, { ok: false, error: 'INVALID_DATE' })
    if (!FUNDING_TYPES.has(type)) return json(400, { ok: false, error: 'INVALID_TYPE' })
    if (!title) return json(400, { ok: false, error: 'TITLE_REQUIRED' })
    if (!PAYMENT_METHODS.has(paymentMethod)) return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })

    const amountCents = parsePriceToCents(normalizePriceInput(amountRaw))
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json(400, { ok: false, error: 'INVALID_AMOUNT', details: 'Amount must be greater than 0. Use 17264 or 17264.00.' })
    }

    const admin = guard.admin
    const { data: before, error: beforeErr } = await admin
      .from('store_external_funding')
      .select('id,attachment_path')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; attachment_path: string | null }>()

    if (beforeErr) return json(500, { ok: false, error: 'LOOKUP_FAILED', details: beforeErr.message })
    if (!before) return json(404, { ok: false, error: 'NOT_FOUND' })

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
    let newPath: string | null = null

    if (attachment && typeof (attachment as any)?.arrayBuffer === 'function') {
      const file = attachment as File
      if (file.size > 0) {
        const uploaded = await uploadAttachment(admin, file, fundingDate)
        newPath = uploaded.attachment_path
        Object.assign(updatePayload, uploaded)
      }
    }

    const { error: updateErr } = await admin
      .from('store_external_funding')
      .update(updatePayload)
      .eq('id', id)
      .is('deleted_at', null)

    if (updateErr) {
      if (newPath) await admin.storage.from(STORE_FUNDING_BUCKET).remove([newPath]).catch(() => null)
      return json(400, { ok: false, error: 'UPDATE_FAILED', details: updateErr.message })
    }

    if (newPath && before.attachment_path && before.attachment_path !== newPath) {
      await admin.storage.from(STORE_FUNDING_BUCKET).remove([before.attachment_path]).catch(() => null)
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

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const id = String(params?.id || '').trim()
    if (!isUuid(id)) return json(400, { ok: false, error: 'INVALID_ID' })

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

    if (error) return json(400, { ok: false, error: 'DELETE_FAILED', details: error.message })

    try {
      revalidatePath('/admin/store/funding')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return json(200, { ok: true, id })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
