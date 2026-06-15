export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_MANAGER_ROLES,
  isPrivateCoachingPackageSessions,
  isPrivateCoachingPaymentMethod,
  calculatePrivateCoachingDiscountPricing,
  privateCoachingPackageBySessions,
  privateCoachingMemberName,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type RequestRow = {
  id: string
  member_id: string
  coach_id: string
  package_sessions: number
  amount_cents: number
  original_amount_cents: number | null
  discount_code: string | null
  discount_label: string | null
  discount_percent: number | null
  discount_amount_cents: number | null
  payment_method: string
  status: string
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

async function getActorAndRequest(requestId: string) {
  const route = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await route.auth.getUser()
  if (authError) return { response: json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message }) }
  if (!auth.user) return { response: json(401, { ok: false, error: 'NOT_AUTHENTICATED' }) }

  const admin = createSupabaseAdminClient()

  const { data: me, error: meError } = await admin
    .from('profiles')
    .select('user_id, role, first_name, last_name, email')
    .eq('user_id', auth.user.id)
    .maybeSingle<ProfileRow>()

  if (meError) return { response: json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message }) }
  if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
    return { response: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  const { data: requestBefore, error: requestError } = await admin
    .from('private_coaching_requests')
    .select('id, member_id, coach_id, package_sessions, amount_cents, original_amount_cents, discount_code, discount_label, discount_percent, discount_amount_cents, payment_method, status')
    .eq('id', requestId)
    .maybeSingle<RequestRow>()

  if (requestError) return { response: json(500, { ok: false, error: 'REQUEST_LOOKUP_FAILED', details: requestError.message }) }
  if (!requestBefore?.id) return { response: json(404, { ok: false, error: 'REQUEST_NOT_FOUND' }) }
  if (me.role === 'head_coach' && requestBefore.coach_id !== auth.user.id) {
    return { response: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  return { admin, auth, me, requestBefore }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const requestId = String(params?.id ?? '').trim()
    if (!requestId) return json(400, { ok: false, error: 'MISSING_REQUEST_ID' })

    const context = await getActorAndRequest(requestId)
    if ('response' in context) return context.response

    const { admin, auth, requestBefore } = context
    if (requestBefore.status !== 'payment_pending') {
      return json(409, {
        ok: false,
        error: 'REQUEST_NOT_EDITABLE',
        details: 'Only payment pending private coaching requests can be edited safely.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const packageSessionsRaw = Number(body?.package_sessions)
    const paymentMethodRaw = String(body?.payment_method ?? '').trim()

    if (!isPrivateCoachingPackageSessions(packageSessionsRaw)) return json(400, { ok: false, error: 'INVALID_PACKAGE' })
    if (!isPrivateCoachingPaymentMethod(paymentMethodRaw)) return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })

    const selectedPackage = privateCoachingPackageBySessions(packageSessionsRaw)
    const pricing = calculatePrivateCoachingDiscountPricing(selectedPackage.amountCents, requestBefore.discount_code ? {
      code: requestBefore.discount_code,
      title: requestBefore.discount_label,
      discountPercent: Number(requestBefore.discount_percent ?? 0),
    } : null)

    const { error: updateError } = await admin
      .from('private_coaching_requests')
      .update({
        package_sessions: selectedPackage.sessions,
        amount_cents: pricing.finalAmountCents,
        original_amount_cents: pricing.originalAmountCents,
        discount_code: pricing.discountCode,
        discount_label: pricing.discountLabel,
        discount_percent: pricing.discountPercent,
        discount_amount_cents: pricing.discountAmountCents,
        payment_method: paymentMethodRaw,
        updated_by: auth.user.id,
      })
      .eq('id', requestId)

    if (updateError) return json(500, { ok: false, error: 'UPDATE_FAILED', details: updateError.message })

    return json(200, { ok: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const requestId = String(params?.id ?? '').trim()
    if (!requestId) return json(400, { ok: false, error: 'MISSING_REQUEST_ID' })

    const context = await getActorAndRequest(requestId)
    if ('response' in context) return context.response

    const { admin, auth, me, requestBefore } = context
    if (requestBefore.status !== 'payment_pending') {
      return json(409, {
        ok: false,
        error: 'REQUEST_NOT_DELETABLE',
        details: 'Only payment pending private coaching requests can be deleted safely. Active requests already created tokens.',
      })
    }

    const { error: updateError } = await admin
      .from('private_coaching_requests')
      .update({
        status: 'cancelled',
        updated_by: auth.user.id,
      })
      .eq('id', requestId)

    if (updateError) return json(500, { ok: false, error: 'DELETE_FAILED', details: updateError.message })

    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email')
      .in('user_id', [requestBefore.member_id, requestBefore.coach_id, auth.user.id])
      .limit(10)

    const byId = new Map<string, ProfileRow>()
    for (const profile of (profiles ?? []) as ProfileRow[]) byId.set(profile.user_id, profile)
    const coachName = privateCoachingMemberName(byId.get(requestBefore.coach_id) ?? me)

    await admin.from('notifications').insert({
      user_id: requestBefore.member_id,
      member_id: requestBefore.member_id,
      created_by: auth.user.id,
      kind: 'info',
      title: 'Private coaching request cancelled',
      body: [
        `${coachName} cancelled your private coaching request.`,
        'No private coaching token was created for this request.',
      ].join('\n'),
    })

    return json(200, { ok: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
