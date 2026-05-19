export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { PRIVATE_COACHING_MANAGER_ROLES } from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
}

type SlotRow = {
  id: string
  coach_id: string
  status: string
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const slotId = String(params?.id ?? '').trim()
    if (!slotId) return json(400, { ok: false, error: 'MISSING_SLOT_ID' })

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
    if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { data: slot, error: slotError } = await admin
      .from('private_coaching_slots')
      .select('id, coach_id, status')
      .eq('id', slotId)
      .maybeSingle<SlotRow>()

    if (slotError) return json(500, { ok: false, error: 'SLOT_LOOKUP_FAILED', details: slotError.message })
    if (!slot?.id) return json(404, { ok: false, error: 'SLOT_NOT_FOUND' })
    if (me.role === 'head_coach' && slot.coach_id !== auth.user.id) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }
    if (slot.status === 'cancelled') return json(200, { ok: true })
    if (slot.status === 'booked') {
      return json(409, {
        ok: false,
        error: 'SLOT_ALREADY_BOOKED',
        details: 'This slot is already booked. Cancel the booking from the bookings list so the member token is returned.',
      })
    }

    const { error: updateError } = await admin
      .from('private_coaching_slots')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .eq('id', slotId)

    if (updateError) return json(500, { ok: false, error: 'CANCEL_FAILED', details: updateError.message })

    return json(200, { ok: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
