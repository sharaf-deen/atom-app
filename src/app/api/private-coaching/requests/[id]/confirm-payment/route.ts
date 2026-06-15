export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_MANAGER_ROLES,
  formatPrivateCoachingMoney,
  privateCoachingMemberName,
  privateCoachingPromoSummary,
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
  discount_code: string | null
  discount_label: string | null
  discount_percent: number | null
  discount_amount_cents: number | null
  status: string
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const requestId = String(params?.id ?? '').trim()
    if (!requestId) return json(400, { ok: false, error: 'MISSING_REQUEST_ID' })

    const route = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await route.auth.getUser()
    if (authError) return json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = createSupabaseAdminClient()

    const { data: me, error: meError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { data: requestBefore, error: requestBeforeError } = await admin
      .from('private_coaching_requests')
      .select('id, member_id, coach_id, package_sessions, amount_cents, discount_code, discount_label, discount_percent, discount_amount_cents, status')
      .eq('id', requestId)
      .maybeSingle<RequestRow>()

    if (requestBeforeError) return json(500, { ok: false, error: 'REQUEST_LOOKUP_FAILED', details: requestBeforeError.message })
    if (!requestBefore?.id) return json(404, { ok: false, error: 'REQUEST_NOT_FOUND' })
    if (me.role === 'head_coach' && requestBefore.coach_id !== auth.user.id) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { data: passId, error: rpcError } = await admin.rpc('private_coaching_confirm_payment', {
      p_request_id: requestId,
      p_actor_id: auth.user.id,
    })

    if (rpcError) return json(500, { ok: false, error: 'CONFIRM_FAILED', details: rpcError.message })

    const profileIds = Array.from(new Set([requestBefore.member_id, requestBefore.coach_id, auth.user.id].filter(Boolean)))
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email')
      .in('user_id', profileIds)
      .limit(10)

    const byId = new Map<string, ProfileRow>()
    for (const profile of (profiles ?? []) as ProfileRow[]) byId.set(profile.user_id, profile)
    const coachName = privateCoachingMemberName(byId.get(requestBefore.coach_id) ?? me)

    await admin.from('notifications').insert({
      user_id: requestBefore.member_id,
      member_id: requestBefore.member_id,
      created_by: auth.user.id,
      kind: 'info',
      title: 'Private coaching payment confirmed',
      body: [
        `${coachName} confirmed your private coaching payment.`,
        `Package: ${requestBefore.package_sessions} session(s) · ${formatPrivateCoachingMoney(requestBefore.amount_cents)}`,
        requestBefore.discount_amount_cents ? `Promo: ${privateCoachingPromoSummary(requestBefore.discount_code, requestBefore.discount_percent, requestBefore.discount_amount_cents, requestBefore.discount_label)}` : '',
        '',
        'Your private coaching sessions are now active. Slot booking will be available when coach availability is opened.',
      ].filter(Boolean).join('\n'),
    })

    return json(200, { ok: true, pass_id: passId })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
