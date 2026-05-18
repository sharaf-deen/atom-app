export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_ALLOWED_MEMBER_ROLES,
  isPrivateCoachingPackageSessions,
  isPrivateCoachingPaymentMethod,
  privateCoachingPackageBySessions,
  privateCoachingMemberName,
  privateCoachingPaymentMethodLabel,
  formatPrivateCoachingMoney,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  member_id: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const route = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await route.auth.getUser()
    if (authError) return json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = createSupabaseAdminClient()

    const { data: me, error: meError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email, phone, member_id')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id) return json(403, { ok: false, error: 'PROFILE_NOT_FOUND' })

    if (!(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const body = await req.json().catch(() => ({} as any))
    const coachId = String(body?.coach_id ?? '').trim()
    const packageSessionsRaw = body?.package_sessions
    const paymentMethodRaw = body?.payment_method

    if (!coachId) return json(400, { ok: false, error: 'MISSING_COACH' })
    if (!isPrivateCoachingPackageSessions(packageSessionsRaw)) return json(400, { ok: false, error: 'INVALID_PACKAGE' })
    if (!isPrivateCoachingPaymentMethod(paymentMethodRaw)) return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })

    const selectedPackage = privateCoachingPackageBySessions(packageSessionsRaw)

    const { data: coach, error: coachError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email, phone, member_id')
      .eq('user_id', coachId)
      .eq('role', 'head_coach')
      .maybeSingle<ProfileRow>()

    if (coachError) return json(500, { ok: false, error: 'COACH_LOOKUP_FAILED', details: coachError.message })
    if (!coach?.user_id) return json(400, { ok: false, error: 'HEAD_COACH_NOT_FOUND' })

    const { data: pending, error: pendingError } = await admin
      .from('private_coaching_requests')
      .select('id')
      .eq('member_id', auth.user.id)
      .eq('status', 'payment_pending')
      .limit(1)

    if (pendingError) return json(500, { ok: false, error: 'PENDING_LOOKUP_FAILED', details: pendingError.message })
    if ((pending ?? []).length > 0) {
      return json(409, { ok: false, error: 'PENDING_REQUEST_EXISTS', details: 'A private coaching request is already waiting for payment confirmation.' })
    }

    const { data: inserted, error: insertError } = await admin
      .from('private_coaching_requests')
      .insert({
        member_id: auth.user.id,
        coach_id: coach.user_id,
        package_sessions: selectedPackage.sessions,
        amount_cents: selectedPackage.amountCents,
        currency: 'EGP',
        payment_method: paymentMethodRaw,
        status: 'payment_pending',
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertError) return json(500, { ok: false, error: 'CREATE_FAILED', details: insertError.message })

    const memberName = privateCoachingMemberName(me)
    const coachName = privateCoachingMemberName(coach)
    const paymentLabel = privateCoachingPaymentMethodLabel(paymentMethodRaw)
    const title = 'New private coaching request'
    const notificationBody = [
      `${memberName} requested private coaching with ${coachName}.`,
      `Package: ${selectedPackage.sessions} session(s) · ${formatPrivateCoachingMoney(selectedPackage.amountCents)}`,
      `Payment method: ${paymentLabel}`,
      '',
      'Open /head-coach/private-coaching to confirm payment received and unlock the member sessions.',
    ].join('\n')

    await admin.from('notifications').insert({
      user_id: coach.user_id,
      member_id: auth.user.id,
      created_by: auth.user.id,
      kind: 'info',
      title,
      body: notificationBody,
    })

    return json(200, { ok: true, id: inserted.id })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
