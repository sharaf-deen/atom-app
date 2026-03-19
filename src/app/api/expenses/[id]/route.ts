export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import type { Role } from '@/lib/session'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function normalizePaymentMethod(v: unknown) {
  const s = String(v ?? '').trim()
  return s
}

const ALLOWED_METHODS = new Set(['cash', 'visa', 'instapay', 'bank_transfer'])

async function requireAdmin() {
  const supa = createSupabaseServerActionClient()
  const { data: auth, error: authErr } = await supa.auth.getUser()
  if (authErr) return { error: json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message }) }
  if (!auth.user) return { error: json(401, { ok: false, error: 'NOT_AUTHENTICATED' }) }

  const { data: me, error: meErr } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: Role | null }>()

  if (meErr) return { error: json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }) }

  const role = (me?.role as Role) ?? 'member'
  if (!['admin', 'super_admin'].includes(role)) {
    return { error: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  return { userId: auth.user.id, role }
}

async function insertAuditLog(admin: ReturnType<typeof createSupabaseAdminClient>, payload: {
  actor_user_id: string
  target_user_id?: string | null
  action: string
  action_details: Record<string, unknown>
}) {
  try {
    await admin.from('audit_logs').insert(payload)
  } catch {
    // best effort only
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const id = String(params?.id ?? '').trim()
  if (!isUuid(id)) return json(400, { ok: false, error: 'INVALID_ID' })

  const body = await req.json().catch(() => null)
  const date = String(body?.date ?? '').trim()
  const category_key = String(body?.category_key ?? '').trim()
  const descriptionRaw = body?.description
  const amount = Number(body?.amount)
  const payment_method = normalizePaymentMethod(body?.payment_method)

  if (!isISODateOnly(date)) {
    return json(400, { ok: false, error: 'INVALID_DATE', details: 'Date must be YYYY-MM-DD.' })
  }
  if (!category_key) {
    return json(400, { ok: false, error: 'INVALID_CATEGORY', details: 'Category is required.' })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return json(400, { ok: false, error: 'INVALID_AMOUNT', details: 'Amount must be a valid number.' })
  }
  if (!ALLOWED_METHODS.has(payment_method)) {
    return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })
  }

  const description = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : ''
  const admin = createSupabaseAdminClient()

  const { data: before, error: beforeErr } = await admin
    .from('expenses')
    .select('id,date,category_key,description,amount,payment_method')
    .eq('id', id)
    .maybeSingle()

  if (beforeErr) return json(500, { ok: false, error: 'LOOKUP_FAILED', details: beforeErr.message })
  if (!before) return json(404, { ok: false, error: 'NOT_FOUND' })

  const { error: updateErr } = await admin
    .from('expenses')
    .update({
      date,
      category_key,
      description: description || null,
      amount,
      payment_method,
    })
    .eq('id', id)

  if (updateErr) return json(400, { ok: false, error: 'UPDATE_FAILED', details: updateErr.message })

  await insertAuditLog(admin, {
    actor_user_id: guard.userId,
    action: 'update_expense',
    action_details: {
      expense_id: id,
      before,
      after: { date, category_key, description: description || null, amount, payment_method },
    },
  })

  return json(200, { ok: true })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const id = String(params?.id ?? '').trim()
  if (!isUuid(id)) return json(400, { ok: false, error: 'INVALID_ID' })

  const admin = createSupabaseAdminClient()

  const { data: expense, error: lookupErr } = await admin
    .from('expenses')
    .select('id,date,category_key,description,amount,payment_method,receipt_path')
    .eq('id', id)
    .maybeSingle()

  if (lookupErr) return json(500, { ok: false, error: 'LOOKUP_FAILED', details: lookupErr.message })
  if (!expense) return json(404, { ok: false, error: 'NOT_FOUND' })

  const receiptPath = String(expense.receipt_path ?? '').trim()
  if (receiptPath) {
    try {
      await admin.storage.from('expense-receipts').remove([receiptPath])
    } catch {
      // best effort only
    }
  }

  const { error: deleteErr } = await admin.from('expenses').delete().eq('id', id)
  if (deleteErr) return json(400, { ok: false, error: 'DELETE_FAILED', details: deleteErr.message })

  await insertAuditLog(admin, {
    actor_user_id: guard.userId,
    action: 'delete_expense',
    action_details: {
      expense_id: id,
      expense,
    },
  })

  return json(200, { ok: true })
}
