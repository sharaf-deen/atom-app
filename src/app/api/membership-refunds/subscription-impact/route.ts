// src/app/api/membership-refunds/subscription-impact/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type ImpactAction = 'keep_active' | 'cancel_subscription' | 'shorten_subscription'

type RefundRow = {
  id: string
  member_id: string
  subscription_id: string | null
  status: string | null
  amount: number | null
  subscription_impact_action: string | null
  subscription_impact_status: string | null
}

type SubscriptionRow = {
  id: string
  member_id: string
  status: string | null
  start_date: string | null
  end_date: string | null
  plan: string | null
}

const IMPACT_ACTIONS = new Set<ImpactAction>(['keep_active', 'cancel_subscription', 'shorten_subscription'])

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(s) ? s : ''
}

function isISODateOnly(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // audit must never break the refund subscription impact flow
  }
}

function buildSubscriptionPatch(action: ImpactAction, subscription: SubscriptionRow, impactEndDate: string | null) {
  const originalStatus = subscription.status ?? null
  const originalEndDate = subscription.end_date ?? null

  if (action === 'keep_active') {
    return {
      subscriptionPatch: null as Record<string, any> | null,
      newStatus: originalStatus,
      newEndDate: originalEndDate,
    }
  }

  if (action === 'cancel_subscription') {
    const today = todayDateOnly()
    return {
      subscriptionPatch: {
        status: 'cancelled',
        end_date: today,
      },
      newStatus: 'cancelled',
      newEndDate: today,
    }
  }

  const newEndDate = impactEndDate || ''
  const today = todayDateOnly()
  const currentStatus = subscription.status || 'active'
  const nextStatus = newEndDate < today ? 'expired' : (currentStatus === 'paused' ? 'paused' : 'active')

  return {
    subscriptionPatch: {
      status: nextStatus,
      end_date: newEndDate,
    },
    newStatus: nextStatus,
    newEndDate,
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
    const canManageRefund = role === 'admin' || role === 'super_admin'
    if (!canManageRefund) return json(403, { ok: false, error: 'FORBIDDEN' })

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
    const actionRaw = cleanString(body?.action, 80) as ImpactAction
    const action = IMPACT_ACTIONS.has(actionRaw) ? actionRaw : null
    const reason = cleanString(body?.reason, 2000)
    const impactEndDate = cleanString(body?.impactEndDate ?? body?.impact_end_date, 20)

    if (!refundId) return json(400, { ok: false, error: 'MISSING_REFUND_ID' })
    if (!action) return json(400, { ok: false, error: 'INVALID_ACTION' })
    if (reason.length < 3) return json(400, { ok: false, error: 'REASON_REQUIRED' })
    if (action === 'shorten_subscription' && !isISODateOnly(impactEndDate)) {
      return json(400, { ok: false, error: 'INVALID_IMPACT_END_DATE', details: 'Expected YYYY-MM-DD.' })
    }

    const { data: refund, error: refundErr } = await admin
      .from('membership_refunds')
      .select('id, member_id, subscription_id, status, amount, subscription_impact_action, subscription_impact_status')
      .eq('id', refundId)
      .maybeSingle<RefundRow>()

    if (refundErr) {
      const message = refundErr.message ?? String(refundErr)
      if (message.includes('subscription_impact') || message.toLowerCase().includes('does not exist')) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Apply the Membership Refunds Lot 1C migration, then try again.',
        })
      }
      return json(500, { ok: false, error: 'REFUND_LOOKUP_FAILED', details: message })
    }

    if (!refund) return json(404, { ok: false, error: 'REFUND_NOT_FOUND' })
    if (refund.status !== 'paid') {
      return json(409, {
        ok: false,
        error: 'REFUND_NOT_PAID',
        details: 'Subscription impact can only be applied after the refund is marked as paid.',
      })
    }
    if (!refund.subscription_id) {
      return json(409, { ok: false, error: 'NO_LINKED_SUBSCRIPTION' })
    }
    if (refund.subscription_impact_status === 'applied') {
      return json(409, {
        ok: false,
        error: 'SUBSCRIPTION_IMPACT_ALREADY_APPLIED',
        details: 'This refund already has a subscription impact decision.',
      })
    }

    const { data: subscription, error: subscriptionErr } = await admin
      .from('subscriptions')
      .select('id, member_id, status, start_date, end_date, plan')
      .eq('id', refund.subscription_id)
      .maybeSingle<SubscriptionRow>()

    if (subscriptionErr) return json(500, { ok: false, error: 'SUBSCRIPTION_LOOKUP_FAILED', details: subscriptionErr.message })
    if (!subscription) return json(404, { ok: false, error: 'SUBSCRIPTION_NOT_FOUND' })
    if (subscription.member_id !== refund.member_id) {
      return json(409, {
        ok: false,
        error: 'SUBSCRIPTION_MEMBER_MISMATCH',
        details: 'Linked subscription does not belong to the refund member.',
      })
    }

    if (action === 'shorten_subscription') {
      if (subscription.start_date && impactEndDate < subscription.start_date) {
        return json(400, {
          ok: false,
          error: 'INVALID_IMPACT_END_DATE',
          details: 'New end date cannot be before the subscription start date.',
        })
      }
      if (subscription.end_date && impactEndDate > subscription.end_date) {
        return json(400, {
          ok: false,
          error: 'INVALID_IMPACT_END_DATE',
          details: 'New end date cannot be after the current subscription end date for a shorten action.',
        })
      }
    }

    const { subscriptionPatch, newStatus, newEndDate } = buildSubscriptionPatch(action, subscription, action === 'shorten_subscription' ? impactEndDate : null)

    let updatedSubscription: any = subscription
    if (subscriptionPatch) {
      const { data, error } = await admin
        .from('subscriptions')
        .update(subscriptionPatch)
        .eq('id', subscription.id)
        .select('id, member_id, status, start_date, end_date, plan')
        .maybeSingle()

      if (error) return json(500, { ok: false, error: 'SUBSCRIPTION_UPDATE_FAILED', details: error.message })
      updatedSubscription = data ?? { ...subscription, ...subscriptionPatch }
    }

    const now = new Date().toISOString()
    const refundPatch = {
      subscription_impact_action: action,
      subscription_impact_status: 'applied',
      subscription_impact_applied_by: actorId,
      subscription_impact_applied_at: now,
      subscription_impact_reason: reason,
      subscription_impact_original_status: subscription.status,
      subscription_impact_original_end_date: subscription.end_date,
      subscription_impact_new_status: newStatus,
      subscription_impact_new_end_date: newEndDate,
    }

    const { data: updatedRefund, error: updateRefundErr } = await admin
      .from('membership_refunds')
      .update(refundPatch)
      .eq('id', refund.id)
      .select('id, member_id, subscription_id, status, subscription_impact_action, subscription_impact_status, subscription_impact_applied_at')
      .maybeSingle()

    if (updateRefundErr) {
      const message = updateRefundErr.message ?? String(updateRefundErr)
      if (message.includes('subscription_impact') || message.toLowerCase().includes('constraint')) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Apply the Membership Refunds Lot 1C migration, then try again.',
        })
      }
      return json(500, { ok: false, error: 'REFUND_IMPACT_UPDATE_FAILED', details: message })
    }

    await safeAudit(admin, {
      actor_user_id: actorId,
      target_user_id: refund.member_id,
      action: 'membership_refund_subscription_impact',
      action_details: {
        refund_id: refund.id,
        member_id: refund.member_id,
        subscription_id: subscription.id,
        refund_amount: refund.amount,
        impact_action: action,
        original_subscription: {
          status: subscription.status,
          start_date: subscription.start_date,
          end_date: subscription.end_date,
          plan: subscription.plan,
        },
        new_subscription: {
          status: updatedSubscription?.status ?? newStatus,
          start_date: updatedSubscription?.start_date ?? subscription.start_date,
          end_date: updatedSubscription?.end_date ?? newEndDate,
          plan: updatedSubscription?.plan ?? subscription.plan,
        },
        decision_reason: reason,
        note: 'Membership refund subscription impact decision. Original payment/refund record was preserved.',
      },
    })

    revalidatePath('/admin/membership-refunds')
    revalidatePath('/admin/members')
    revalidatePath('/admin/subscriptions')
    if (refund.member_id) revalidatePath(`/members/${refund.member_id}`)

    return json(200, {
      ok: true,
      refund: updatedRefund,
      subscription: updatedSubscription,
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
