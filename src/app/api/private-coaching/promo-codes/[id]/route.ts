export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_MANAGER_ROLES,
  isValidPrivateCoachingPromoCodeFormat,
  isValidPrivateCoachingPromoPercent,
  normalizePrivateCoachingPromoCode,
  normalizePrivateCoachingPromoPercent,
  normalizePrivateCoachingPromoTitle,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

async function getManagerContext() {
  const route = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await route.auth.getUser()
  if (authError) return { response: json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message }) }
  if (!auth.user) return { response: json(401, { ok: false, error: 'NOT_AUTHENTICATED' }) }

  const admin = createSupabaseAdminClient()
  const { data: me, error: meError } = await admin
    .from('profiles')
    .select('user_id, role')
    .eq('user_id', auth.user.id)
    .maybeSingle<ProfileRow>()

  if (meError) return { response: json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message }) }
  if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
    return { response: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  return { admin, auth, me }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const promoId = String(params?.id ?? '').trim()
    if (!promoId) return json(400, { ok: false, error: 'MISSING_PROMO_ID' })

    const context = await getManagerContext()
    if ('response' in context) return context.response

    const { admin, auth } = context
    const body = await req.json().catch(() => ({} as any))
    const code = normalizePrivateCoachingPromoCode(body?.code)
    const title = normalizePrivateCoachingPromoTitle(body?.title)
    const discountPercent = normalizePrivateCoachingPromoPercent(body?.discount_percent)
    const isActive = body?.is_active !== false

    if (!isValidPrivateCoachingPromoCodeFormat(code)) {
      return json(400, { ok: false, error: 'INVALID_CODE', details: 'Promo code must be 2-32 characters using letters, numbers, underscore or dash.' })
    }
    if (!isValidPrivateCoachingPromoPercent(discountPercent)) {
      return json(400, { ok: false, error: 'INVALID_DISCOUNT_PERCENT', details: 'Discount percent must be between 1 and 100.' })
    }

    const { error: updateError } = await admin
      .from('private_coaching_promo_codes')
      .update({
        code,
        title: title || code,
        discount_percent: discountPercent,
        is_active: isActive,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', promoId)
      .is('deleted_at', null)

    if (updateError) return json(500, { ok: false, error: 'UPDATE_FAILED', details: updateError.message })

    return json(200, { ok: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const promoId = String(params?.id ?? '').trim()
    if (!promoId) return json(400, { ok: false, error: 'MISSING_PROMO_ID' })

    const context = await getManagerContext()
    if ('response' in context) return context.response

    const { admin, auth } = context
    const { error: updateError } = await admin
      .from('private_coaching_promo_codes')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', promoId)
      .is('deleted_at', null)

    if (updateError) return json(500, { ok: false, error: 'DELETE_FAILED', details: updateError.message })

    return json(200, { ok: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
