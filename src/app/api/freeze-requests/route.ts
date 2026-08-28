
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cairoTodayDateOnly, isISODateOnly } from '@/lib/cairoTime'
import {
  getConsumptiveSubscriptionFreezeHistory,
  getFreezeTokenAllowance,
  subscriptionFreezeRangesOverlap,
  type SubscriptionFreezeHistoryRow,
} from '@/lib/subscriptionFreeze'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) { return NextResponse.json(body, { status }) }

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function daysInclusive(from: string, to: string) {
  return Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1
}

function ageOn(dob: string | null, today: string) {
  if (!dob || !isISODateOnly(dob) || !isISODateOnly(today)) return null
  const [y, m, d] = dob.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - y
  if (tm < m || (tm === m && td < d)) age--
  return age >= 0 ? age : null
}

type TargetAuth = {
  member: { user_id: string; first_name: string | null; last_name: string | null; date_of_birth: string | null }
  requester: 'self' | 'guardian'
  guardianMinorAllowed: boolean
}

async function authorizeTarget(admin: any, authUserId: string, memberUserId: string, today: string): Promise<TargetAuth | null> {
  const { data: member } = await admin
    .from('profiles')
    .select('user_id,first_name,last_name,date_of_birth')
    .eq('user_id', memberUserId)
    .maybeSingle()
  if (!member) return null

  if (authUserId === memberUserId) {
    return { member, requester: 'self', guardianMinorAllowed: true }
  }

  const { data: link } = await admin
    .from('family_members')
    .select('family_id')
    .eq('member_id', memberUserId)
    .maybeSingle()
  if (!link?.family_id) return null

  const { data: guardian } = await admin
    .from('family_guardians')
    .select('family_id')
    .eq('family_id', link.family_id)
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (!guardian) return null

  const age = ageOn(member.date_of_birth ?? null, today)
  return { member, requester: 'guardian', guardianMinorAllowed: age !== null && age < 18 }
}

async function loadEligibility(admin: any, authUserId: string, memberUserId: string) {
  const today = cairoTodayDateOnly()
  const target = await authorizeTarget(admin, authUserId, memberUserId, today)
  if (!target) return { status: 403, body: { ok: false, error: 'You cannot request a freeze for this member.' } }

  const memberName = `${target.member.first_name ?? ''} ${target.member.last_name ?? ''}`.trim() || 'Member'

  const { data: subs, error: subsErr } = await admin
    .from('subscriptions')
    .select('id,member_id,plan,subscription_type,status,start_date,end_date,paid_at')
    .eq('member_id', memberUserId)
    .order('paid_at', { ascending: false })
    .limit(100)
  if (subsErr) return { status: 500, body: { ok: false, error: subsErr.message } }

  const rows = (subs ?? []) as any[]
  const currentOrLatest = rows.find((s: any) => String(s.status ?? '').toLowerCase() === 'active') ?? rows[0] ?? null
  const currentType = currentOrLatest?.subscription_type ?? (currentOrLatest?.plan === 'sessions' ? 'sessions' : 'time')
  const currentStatus = String(currentOrLatest?.status ?? '').toLowerCase()
  const subscription = currentOrLatest
    && currentType === 'time'
    && getFreezeTokenAllowance(String(currentOrLatest.plan || ''), 'time') > 0
    && (currentStatus === 'active' || currentStatus === 'expired')
    && isISODateOnly(currentOrLatest.start_date)
    && isISODateOnly(currentOrLatest.end_date)
      ? currentOrLatest
      : null

  const { data: requests, error: reqErr } = await admin
    .from('freeze_requests')
    .select('id,subscription_id,requested_start_date,requested_end_date,reason,status,created_at,admin_note,requested_by_auth_user_id,request_source,canceled_at')
    .eq('member_user_id', memberUserId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (reqErr) return { status: 500, body: { ok: false, error: reqErr.message } }

  const normalizedRequests = (requests ?? []).map((r: any) => ({
    id: r.id,
    requested_start_date: r.requested_start_date,
    requested_end_date: r.requested_end_date,
    reason: r.reason,
    status: r.status,
    created_at: r.created_at,
    admin_note: r.admin_note ?? null,
    request_source: r.request_source ?? null,
    canceled_at: r.canceled_at ?? null,
    can_cancel: r.status === 'pending' && r.requested_by_auth_user_id === authUserId,
  }))
  const pendingRequest = normalizedRequests.find((r: any) => r.status === 'pending') ?? null

  if (!subscription) {
    return { status: 200, body: { ok: true, member: { id: memberUserId, name: memberName, date_of_birth: target.member.date_of_birth }, requester: target.requester, can_request: false, blocked_reason: 'No eligible 3, 6 or 12 month time subscription was found.', subscription: null, allowance: { allowed: 0, used: 0, remaining: 0 }, pending_request: pendingRequest, requests: normalizedRequests, suggested_start_date: null, suggested_end_date: null } }
  }

  const { data: freezeRows, error: freezeErr } = await admin
    .from('subscription_freezes')
    .select('id,subscription_id,freeze_from,freeze_until,days,created_at,created_by,updated_at,updated_by,cleared_at,cleared_by')
    .eq('subscription_id', subscription.id)
    .order('created_at', { ascending: false })
  if (freezeErr) return { status: 500, body: { ok: false, error: freezeErr.message } }

  const history = getConsumptiveSubscriptionFreezeHistory((freezeRows ?? []) as SubscriptionFreezeHistoryRow[])
  const allowed = getFreezeTokenAllowance(String(subscription.plan || ''), 'time')
  const used = history.length
  const remaining = Math.max(allowed - used, 0)

  let blockedReason: string | null = null
  if (target.requester === 'guardian' && !target.guardianMinorAllowed) blockedReason = 'Guardian freeze requests are limited to family members under 18 with a recorded date of birth. Adult members must submit from their own account.'
  else if (pendingRequest) blockedReason = 'A freeze request is already pending review for this member.'
  else if (remaining < 1) blockedReason = 'No freeze tokens remain on this subscription.'

  let suggestedStart = today
  if (suggestedStart < subscription.start_date) suggestedStart = subscription.start_date
  if (suggestedStart > subscription.end_date) suggestedStart = subscription.end_date
  let suggestedEnd = addDays(suggestedStart, 29)
  if (suggestedEnd > subscription.end_date) suggestedEnd = subscription.end_date

  return { status: 200, body: {
    ok: true,
    member: { id: memberUserId, name: memberName, date_of_birth: target.member.date_of_birth },
    requester: target.requester,
    can_request: !blockedReason,
    blocked_reason: blockedReason,
    subscription: { id: subscription.id, plan: subscription.plan, status: subscription.status, start_date: subscription.start_date, end_date: subscription.end_date },
    allowance: { allowed, used, remaining },
    pending_request: pendingRequest,
    requests: normalizedRequests,
    suggested_start_date: suggestedStart,
    suggested_end_date: suggestedEnd,
  } }
}

export async function GET(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })
  const authUserId = me.data.user.id
  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })
  const url = new URL(req.url)
  const memberUserId = String(url.searchParams.get('member_id') || authUserId)
  const result = await loadEligibility(admin, authUserId, memberUserId)
  return json(result.status, result.body)
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })
  const authUserId = me.data.user.id
  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })

  let payload: any = null
  try { payload = await req.json() } catch { payload = null }
  const memberUserId = String(payload?.member_id || '')
  const subscriptionId = String(payload?.subscription_id || '')
  const from = String(payload?.from || '')
  const to = String(payload?.to || '')
  const reason = String(payload?.reason || '').trim()
  if (!memberUserId || !subscriptionId) return json(400, { ok: false, error: 'Missing member or subscription.' })
  if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) return json(400, { ok: false, error: 'Provide a valid freeze date range.' })
  if (reason.length < 3 || reason.length > 1000) return json(400, { ok: false, error: 'Reason must contain between 3 and 1000 characters.' })

  const eligibility = await loadEligibility(admin, authUserId, memberUserId)
  if (eligibility.status !== 200 || !eligibility.body?.ok) return json(eligibility.status, eligibility.body)
  if (!eligibility.body.can_request) return json(400, { ok: false, error: eligibility.body.blocked_reason || 'Freeze request is not available.' })
  if (!eligibility.body.subscription || eligibility.body.subscription.id !== subscriptionId) {
    return json(400, { ok: false, error: 'Freeze requests can only target the member’s current subscription.' })
  }
  const requester = eligibility.body.requester as 'self' | 'guardian'

  const { data: sub, error: subErr } = await admin
    .from('subscriptions')
    .select('id,member_id,plan,subscription_type,status,start_date,end_date')
    .eq('id', subscriptionId)
    .eq('member_id', memberUserId)
    .maybeSingle()
  if (subErr) return json(500, { ok: false, error: subErr.message })
  if (!sub) return json(404, { ok: false, error: 'Subscription not found.' })

  const type = sub.subscription_type ?? (sub.plan === 'sessions' ? 'sessions' : 'time')
  const status = String(sub.status ?? '').toLowerCase()
  const allowed = getFreezeTokenAllowance(String(sub.plan || ''), type)
  if (type !== 'time' || allowed < 1) return json(400, { ok: false, error: 'Freeze is only available for eligible 3, 6 or 12 month time subscriptions.' })
  if (status !== 'active' && status !== 'expired') return json(400, { ok: false, error: 'Freeze is only available for active or expired subscriptions.' })
  if (!isISODateOnly(sub.start_date) || !isISODateOnly(sub.end_date)) return json(400, { ok: false, error: 'Subscription coverage dates are invalid.' })
  if (from < sub.start_date) return json(400, { ok: false, error: 'Freeze cannot start before the subscription start date.' })
  if (from > sub.end_date || to > sub.end_date) return json(400, { ok: false, error: 'Freeze dates must stay within the current subscription coverage.' })
  const days = daysInclusive(from, to)
  if (days < 1 || days > 30) return json(400, { ok: false, error: 'Each freeze must be between 1 and 30 days.' })

  const { data: pending } = await admin.from('freeze_requests').select('id').eq('member_user_id', memberUserId).eq('status', 'pending').limit(1)
  if ((pending ?? []).length > 0) return json(409, { ok: false, error: 'A freeze request is already pending review for this member.' })

  const { data: freezeRows, error: freezeErr } = await admin
    .from('subscription_freezes')
    .select('id,subscription_id,freeze_from,freeze_until,days,created_at,created_by,updated_at,updated_by,cleared_at,cleared_by')
    .eq('subscription_id', subscriptionId)
  if (freezeErr) return json(500, { ok: false, error: freezeErr.message })
  const history = getConsumptiveSubscriptionFreezeHistory((freezeRows ?? []) as SubscriptionFreezeHistoryRow[])
  if (history.length >= allowed) return json(400, { ok: false, error: 'No freeze tokens remain on this subscription.' })

  const candidate: SubscriptionFreezeHistoryRow = {
    id: 'pending-request', subscription_id: subscriptionId, freeze_from: from, freeze_until: addDays(to, 1), days,
    created_at: null, created_by: null, updated_at: null, updated_by: null, cleared_at: null, cleared_by: null,
  }
  if (history.some((row) => subscriptionFreezeRangesOverlap(row, candidate))) {
    return json(409, { ok: false, error: 'Requested dates overlap an existing freeze on this subscription.' })
  }

  const { data: inserted, error: insertErr } = await admin
    .from('freeze_requests')
    .insert({
      member_user_id: memberUserId,
      subscription_id: subscriptionId,
      requested_start_date: from,
      requested_end_date: to,
      reason,
      status: 'pending',
      requested_by_auth_user_id: authUserId,
      request_source: requester,
    })
    .select('id')
    .maybeSingle()
  if (insertErr) {
    if (String(insertErr.code) === '23505') return json(409, { ok: false, error: 'A freeze request is already pending review for this member.' })
    return json(500, { ok: false, error: insertErr.message })
  }

  // Notify every Super Admin about the newly created pending request.
  // Delivery is best-effort: a notification issue must never roll back a valid freeze request.
  if (inserted?.id) {
    const { data: superAdmins, error: superAdminsErr } = await admin
      .from('profiles')
      .select('user_id')
      .eq('role', 'super_admin')
      .not('user_id', 'is', null)

    if (!superAdminsErr) {
      const superAdminIds = Array.from(
        new Set((superAdmins ?? []).map((row: any) => String(row.user_id || '')).filter(Boolean)),
      )

      if (superAdminIds.length > 0) {
        const memberName = String(eligibility.body?.member?.name || 'Member')
        const sourceLabel = requester === 'guardian' ? 'Parent/guardian' : 'Member'
        const notificationRows = superAdminIds.map((userId) => ({
          user_id: userId,
          member_id: memberUserId,
          created_by: authUserId,
          kind: 'system',
          title: 'New freeze request',
          body: `${memberName} requested a membership freeze from ${from} to ${to}. Source: ${sourceLabel}.`,
        }))

        await admin.from('notifications').insert(notificationRows)
      }
    }
  }

  return json(201, { ok: true, id: inserted?.id ?? null, status: 'pending' })
}
