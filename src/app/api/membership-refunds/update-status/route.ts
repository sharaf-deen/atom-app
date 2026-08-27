// src/app/api/membership-refunds/update-status/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type RefundAction = 'approve' | 'reject' | 'mark_paid' | 'cancel'
type RefundStatus = 'pending_review' | 'approved' | 'paid' | 'rejected' | 'cancelled'

const REFUND_ACTIONS = new Set<RefundAction>(['approve', 'reject', 'mark_paid', 'cancel'])
const TERMINAL_STATUSES = new Set<RefundStatus>(['paid', 'rejected', 'cancelled'])

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

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // audit must never break the refund workflow
  }
}

function assertTransition(currentStatus: RefundStatus, action: RefundAction) {
  if (TERMINAL_STATUSES.has(currentStatus)) return false
  if (action === 'approve') return currentStatus === 'pending_review'
  if (action === 'reject') return currentStatus === 'pending_review'
  if (action === 'mark_paid') return currentStatus === 'approved'
  if (action === 'cancel') return currentStatus === 'pending_review' || currentStatus === 'approved'
  return false
}

function patchForAction(action: RefundAction, actorId: string, reason: string) {
  const now = new Date().toISOString()

  if (action === 'approve') {
    return {
      status: 'approved',
      approved_by: actorId,
      approved_at: now,
    }
  }

  if (action === 'reject') {
    return {
      status: 'rejected',
      rejected_by: actorId,
      rejected_at: now,
      rejection_reason: reason,
    }
  }

  if (action === 'mark_paid') {
    return {
      status: 'paid',
      paid_by: actorId,
      paid_at: now,
    }
  }

  return {
    status: 'cancelled',
    cancelled_by: actorId,
    cancelled_at: now,
    cancellation_reason: reason,
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
    if (role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const refundId = normalizeUuid(body?.refundId ?? body?.refund_id)
    const actionRaw = cleanString(body?.action, 40) as RefundAction
    const action = REFUND_ACTIONS.has(actionRaw) ? actionRaw : null
    const reason = cleanString(body?.reason, 2000)

    if (!refundId) return json(400, { ok: false, error: 'MISSING_REFUND_ID' })
    if (!action) return json(400, { ok: false, error: 'INVALID_ACTION' })
    if ((action === 'reject' || action === 'cancel') && reason.length < 3) {
      return json(400, { ok: false, error: 'REASON_REQUIRED' })
    }

    const { data: existing, error: lookupErr } = await admin
      .from('membership_refunds')
      .select('id, member_id, subscription_id, amount, refund_method, status, reason, created_by, created_at')
      .eq('id', refundId)
      .maybeSingle()

    if (lookupErr) {
      const message = lookupErr.message ?? String(lookupErr)
      if (message.includes('approved_by') || message.includes('paid_by') || message.toLowerCase().includes('does not exist')) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Apply the Membership Refunds Lot 1B migration, then try again.',
        })
      }
      return json(500, { ok: false, error: 'REFUND_LOOKUP_FAILED', details: message })
    }

    if (!existing) return json(404, { ok: false, error: 'REFUND_NOT_FOUND' })

    const currentStatus = (existing.status || 'pending_review') as RefundStatus
    if (!assertTransition(currentStatus, action)) {
      return json(409, {
        ok: false,
        error: 'INVALID_REFUND_STATUS_TRANSITION',
        details: `Cannot run ${action} from status ${currentStatus}.`,
      })
    }

    const patch = patchForAction(action, actorId, reason)

    const { data: updated, error: updateErr } = await admin
      .from('membership_refunds')
      .update(patch)
      .eq('id', refundId)
      .select('id, member_id, subscription_id, amount, refund_method, status, approved_at, rejected_at, paid_at, cancelled_at')
      .maybeSingle()

    if (updateErr) {
      const message = updateErr.message ?? String(updateErr)
      if (message.includes('approved_by') || message.includes('paid_by') || message.toLowerCase().includes('constraint')) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Apply the Membership Refunds Lot 1B migration, then try again.',
        })
      }
      return json(500, { ok: false, error: 'REFUND_UPDATE_FAILED', details: message })
    }

    await safeAudit(admin, {
      actor_user_id: actorId,
      target_user_id: existing.member_id,
      action: `membership_refund_${action}`,
      action_details: {
        refund_id: refundId,
        member_id: existing.member_id,
        subscription_id: existing.subscription_id,
        amount: existing.amount,
        refund_method: existing.refund_method,
        previous_status: currentStatus,
        new_status: updated?.status ?? patch.status,
        workflow_reason: reason || null,
        note: 'Membership refund workflow update only. No subscription/payment/access mutation was performed.',
      },
    })

    revalidatePath('/admin/membership-refunds')
    revalidatePath('/admin/members')
    if (existing.member_id) revalidatePath(`/members/${existing.member_id}`)

    return json(200, { ok: true, refund: updated })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
