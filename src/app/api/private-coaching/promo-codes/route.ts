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

export async function GET() {
  try {
    const context = await getManagerContext()
    if ('response' in context) return context.response

    const { admin } = context
    const { data, error } = await admin
      .from('private_coaching_promo_codes')
      .select('id, code, title, discount_percent, is_active, created_at, updated_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) return json(500, { ok: false, error: 'PROMO_CODES_LOOKUP_FAILED', details: error.message })

    return json(200, { ok: true, rows: data ?? [] })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}

export async function POST(req: Request) {
  try {
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

    const { data: inserted, error: insertError } = await admin
      .from('private_coaching_promo_codes')
      .insert({
        code,
        title: title || code,
        discount_percent: discountPercent,
        is_active: isActive,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertError) return json(500, { ok: false, error: 'CREATE_FAILED', details: insertError.message })

    return json(200, { ok: true, id: inserted.id })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
