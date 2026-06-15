export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_ALLOWED_MEMBER_ROLES,
  calculatePrivateCoachingDiscountPricing,
  isPrivateCoachingPackageSessions,
  normalizePrivateCoachingPromoCode,
  privateCoachingPackageBySessions,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
}

type PromoRow = {
  code: string
  title: string | null
  discount_percent: number
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
      .select('user_id, role')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id || !(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const body = await req.json().catch(() => ({} as any))
    const code = normalizePrivateCoachingPromoCode(body?.code)
    const packageSessionsRaw = body?.package_sessions

    if (!code) return json(200, { ok: true, valid: false })
    if (!isPrivateCoachingPackageSessions(packageSessionsRaw)) return json(400, { ok: false, error: 'INVALID_PACKAGE' })

    const { data: promo, error: promoError } = await admin
      .from('private_coaching_promo_codes')
      .select('code, title, discount_percent')
      .eq('code', code)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle<PromoRow>()

    if (promoError) return json(500, { ok: false, error: 'PROMO_LOOKUP_FAILED', details: promoError.message })
    if (!promo?.code) {
      return json(200, { ok: true, valid: false, details: 'This private coaching code is not valid.' })
    }

    const selectedPackage = privateCoachingPackageBySessions(packageSessionsRaw)
    const pricing = calculatePrivateCoachingDiscountPricing(selectedPackage.amountCents, {
      code: promo.code,
      title: promo.title,
      discountPercent: Number(promo.discount_percent ?? 0),
    })

    return json(200, {
      ok: true,
      valid: true,
      code: pricing.discountCode,
      title: pricing.discountLabel,
      discount_percent: pricing.discountPercent,
      original_amount_cents: pricing.originalAmountCents,
      discount_amount_cents: pricing.discountAmountCents,
      final_amount_cents: pricing.finalAmountCents,
    })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
