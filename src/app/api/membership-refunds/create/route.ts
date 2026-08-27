// src/app/api/membership-refunds/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type RefundMethod = 'cash' | 'instapay' | 'card' | 'bank_transfer'
type RefundStatus = 'pending_review'

const REFUND_METHODS = new Set<RefundMethod>(['cash', 'instapay', 'card', 'bank_transfer'])

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanString(v: unknown, max = 2000) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

function normalizeUuid(v: unknown) {
  const s = cleanString(v, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : ''
}

function parseRefundedAt(v: unknown) {
  const s = cleanString(v, 80)
  if (!s) return new Date().toISOString()

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString()
  }

  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toISOString()
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // audit must never break the refund record flow
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supabase.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const actorId = auth.user.id
    const { data: me, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', actorId)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = me?.role ?? 'member'
    const canRecordRefund = role === 'admin' || role === 'super_admin'
    if (!canRecordRefund) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))

    const memberId = normalizeUuid(body?.memberId ?? body?.member_id)
    const subscriptionId = normalizeUuid(body?.subscriptionId ?? body?.subscription_id) || null
    const amount = Number(body?.amount)
    const refundMethodRaw = cleanString(body?.refundMethod ?? body?.refund_method, 40) as RefundMethod
    const refundMethod = REFUND_METHODS.has(refundMethodRaw) ? refundMethodRaw : null
    const status: RefundStatus = 'pending_review'
    const reason = cleanString(body?.reason, 2000)
    const internalNote = cleanString(body?.internalNote ?? body?.internal_note, 4000) || null
    const proofUrl = cleanString(body?.proofUrl ?? body?.proof_url, 1000) || null
    const refundedAt = parseRefundedAt(body?.refundedAt ?? body?.refunded_at)

    if (!memberId) return json(400, { ok: false, error: 'MISSING_MEMBER_ID' })
    if (!Number.isFinite(amount) || amount <= 0) return json(400, { ok: false, error: 'INVALID_AMOUNT' })
    if (!refundMethod) return json(400, { ok: false, error: 'INVALID_REFUND_METHOD' })
    if (reason.length < 3) return json(400, { ok: false, error: 'REASON_REQUIRED' })
    if (!refundedAt) return json(400, { ok: false, error: 'INVALID_REFUNDED_AT' })

    const { data: member, error: memberErr } = await admin
      .from('profiles')
      .select('user_id, email, first_name, last_name, member_id')
      .eq('user_id', memberId)
      .maybeSingle()

    if (memberErr) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: memberErr.message })
    if (!member) return json(404, { ok: false, error: 'MEMBER_NOT_FOUND' })

    let subscription: any = null
    if (subscriptionId) {
      const { data: sub, error: subErr } = await admin
        .from('subscriptions')
        .select('id, member_id, plan, status, start_date, end_date, amount, amount_due, payment_method, paid_at')
        .eq('id', subscriptionId)
        .maybeSingle()

      if (subErr) return json(500, { ok: false, error: 'SUBSCRIPTION_LOOKUP_FAILED', details: subErr.message })
      if (!sub) return json(404, { ok: false, error: 'SUBSCRIPTION_NOT_FOUND' })
      if (sub.member_id !== memberId) return json(409, { ok: false, error: 'SUBSCRIPTION_MEMBER_MISMATCH' })
      subscription = sub
    }

    const insert = {
      member_id: memberId,
      subscription_id: subscriptionId,
      amount,
      refund_method: refundMethod,
      reason,
      internal_note: internalNote,
      proof_url: proofUrl,
      status,
      refunded_at: refundedAt,
      created_by: actorId,
    }

    const { data: refund, error: insertErr } = await admin
      .from('membership_refunds')
      .insert(insert)
      .select('id, member_id, subscription_id, amount, refund_method, status, refunded_at, created_at')
      .maybeSingle()

    if (insertErr) {
      const message = insertErr.message ?? String(insertErr)
      if ((message.includes('membership_refunds') && message.toLowerCase().includes('does not exist')) || message.includes('membership_refunds_status_chk')) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Apply the Membership Refunds migrations, then try again.',
        })
      }

      return json(500, { ok: false, error: 'REFUND_INSERT_FAILED', details: message })
    }

    await safeAudit(admin, {
      actor_user_id: actorId,
      target_user_id: memberId,
      action: 'membership_refund_request_created',
      action_details: {
        refund_id: refund?.id ?? null,
        member_id: memberId,
        subscription_id: subscriptionId,
        amount,
        refund_method: refundMethod,
        status,
        member_email: member?.email ?? null,
        member_display_id: member?.member_id ?? null,
        subscription_snapshot: subscription,
        note: 'Exceptional membership refund request created as pending_review only. No subscription/payment/access mutation was performed.',
      },
    })

    revalidatePath('/admin/membership-refunds')
    revalidatePath('/admin/members')
    if (memberId) revalidatePath(`/members/${memberId}`)

    return json(200, { ok: true, refund })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
