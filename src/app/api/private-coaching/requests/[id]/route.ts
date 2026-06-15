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

type PassRow = {
  id: string
  request_id?: string | null
  member_id: string
  coach_id: string
  total_sessions: number
  used_sessions: number
  remaining_sessions: number
  status: string
}

type BookingRow = {
  id: string
  member_id: string
  coach_id: string
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

async function findPassesForRequest(admin: ReturnType<typeof createSupabaseAdminClient>, requestBefore: RequestRow) {
  const { data: directPasses, error: directPassesError } = await admin
    .from('private_coaching_passes')
    .select('id, request_id, member_id, coach_id, total_sessions, used_sessions, remaining_sessions, status')
    .eq('request_id', requestBefore.id)
    .in('status', ['active', 'depleted'])

  if (directPassesError) {
    return { passes: [] as PassRow[], error: directPassesError }
  }

  const direct = (directPasses ?? []) as PassRow[]
  if (direct.length > 0) return { passes: direct, error: null }

  const { data: fallbackPasses, error: fallbackPassesError } = await admin
    .from('private_coaching_passes')
    .select('id, request_id, member_id, coach_id, total_sessions, used_sessions, remaining_sessions, status')
    .eq('member_id', requestBefore.member_id)
    .eq('coach_id', requestBefore.coach_id)
    .eq('total_sessions', Number(requestBefore.package_sessions ?? 0))
    .in('status', ['active', 'depleted'])
    .order('remaining_sessions', { ascending: false })
    .limit(1)

  if (fallbackPassesError) return { passes: [] as PassRow[], error: fallbackPassesError }
  return { passes: ((fallbackPasses ?? []) as PassRow[]), error: null }
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
    if (requestBefore.status === 'cancelled') {
      return json(409, {
        ok: false,
        error: 'REQUEST_ALREADY_CANCELLED',
        details: 'This private coaching request is already cancelled.',
      })
    }

    const isConfirmedRequest = requestBefore.status === 'active'
    const isPendingRequest = requestBefore.status === 'payment_pending'

    if (!isConfirmedRequest && !isPendingRequest) {
      return json(409, {
        ok: false,
        error: 'REQUEST_NOT_CANCELLABLE',
        details: 'Only payment pending or confirmed private coaching requests can be cancelled safely.',
      })
    }

    let cancelledBookingsCount = 0
    let cancelledPassesCount = 0

    if (isConfirmedRequest) {
      const { data: openBookings, error: openBookingsError } = await admin
        .from('private_coaching_bookings')
        .select('id, member_id, coach_id, status')
        .eq('member_id', requestBefore.member_id)
        .eq('coach_id', requestBefore.coach_id)
        .eq('status', 'booked')
        .limit(100)

      if (openBookingsError) {
        return json(500, { ok: false, error: 'BOOKINGS_LOOKUP_FAILED', details: openBookingsError.message })
      }

      for (const booking of ((openBookings ?? []) as BookingRow[])) {
        const { error: cancelBookingError } = await admin.rpc('private_coaching_cancel_booking_by_coach', {
          p_booking_id: booking.id,
          p_actor_id: auth.user.id,
        })

        if (cancelBookingError) {
          return json(500, {
            ok: false,
            error: 'CANCEL_BOOKINGS_FAILED',
            details: cancelBookingError.message || 'Could not cancel all open bookings before cancelling the request.',
          })
        }
        cancelledBookingsCount += 1
      }

      const { passes, error: passesError } = await findPassesForRequest(admin, requestBefore)
      if (passesError) return json(500, { ok: false, error: 'PASS_LOOKUP_FAILED', details: passesError.message })

      const passIds = passes.map((pass) => pass.id).filter(Boolean)
      if (passIds.length > 0) {
        const { error: passUpdateError } = await admin
          .from('private_coaching_passes')
          .update({
            status: 'cancelled',
          })
          .in('id', passIds)

        if (passUpdateError) return json(500, { ok: false, error: 'PASS_CANCEL_FAILED', details: passUpdateError.message })
        cancelledPassesCount = passIds.length
      }
    }

    const { error: updateError } = await admin
      .from('private_coaching_requests')
      .update({
        status: 'cancelled',
        updated_by: auth.user.id,
      })
      .eq('id', requestId)

    if (updateError) return json(500, { ok: false, error: 'REQUEST_CANCEL_FAILED', details: updateError.message })

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
      body: isConfirmedRequest
        ? [
          `${coachName} cancelled your confirmed private coaching request.`,
          cancelledPassesCount > 0 ? 'Remaining private coaching tokens are no longer usable.' : 'No active token pass was found for this request.',
          cancelledBookingsCount > 0 ? `${cancelledBookingsCount} open booking(s) were cancelled.` : 'No open booking was cancelled.',
          'History is preserved. No automatic refund was created in the app.',
        ].join('\n')
        : [
          `${coachName} cancelled your private coaching request.`,
          'No private coaching token was created for this request.',
        ].join('\n'),
    })

    return json(200, { ok: true, cancelled_bookings: cancelledBookingsCount, cancelled_passes: cancelledPassesCount })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
