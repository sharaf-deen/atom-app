export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_ALLOWED_MEMBER_ROLES,
  formatPrivateCoachingSlotTime,
  privateCoachingMemberName,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  member_id?: string | null
  phone?: string | null
}

type BookingRow = {
  id: string
  member_id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  note: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function formatSlotDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })
}

function rpcStatus(message?: string | null) {
  const text = String(message ?? '')
  if (text.includes('PRIVATE_COACHING_SLOT_NOT_FOUND')) return 404
  if (text.includes('PRIVATE_COACHING_SLOT_NOT_AVAILABLE')) return 409
  if (text.includes('PRIVATE_COACHING_SLOT_IN_PAST')) return 409
  if (text.includes('PRIVATE_COACHING_NO_TOKENS')) return 409
  if (text.includes('PRIVATE_COACHING_FORBIDDEN')) return 403
  return 500
}

function rpcDetails(message?: string | null) {
  const text = String(message ?? '')
  if (text.includes('PRIVATE_COACHING_SLOT_NOT_AVAILABLE')) return 'This slot is no longer available.'
  if (text.includes('PRIVATE_COACHING_SLOT_IN_PAST')) return 'This slot is in the past and cannot be booked unless it is assigned by the head coach as a correction.'
  if (text.includes('PRIVATE_COACHING_NO_TOKENS')) return 'You do not have an active private coaching token for this coach.'
  if (text.includes('PRIVATE_COACHING_FORBIDDEN')) return 'You are not allowed to book private coaching slots.'
  return message || 'Could not book this slot.'
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
      .select('user_id, role, first_name, last_name, email, member_id, phone')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id || !(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { data: bookingId, error: rpcError } = await admin.rpc('private_coaching_book_slot', {
      p_slot_id: slotId,
      p_member_id: auth.user.id,
    })

    if (rpcError) {
      return json(rpcStatus(rpcError.message), {
        ok: false,
        error: 'BOOK_SLOT_FAILED',
        details: rpcDetails(rpcError.message),
      })
    }

    const { data: booking } = await admin
      .from('private_coaching_bookings')
      .select('id, member_id, coach_id, slot_date, start_time, end_time, note')
      .eq('id', bookingId)
      .maybeSingle<BookingRow>()

    if (booking?.id) {
      const { data: coach } = await admin
        .from('profiles')
        .select('user_id, role, first_name, last_name, email')
        .eq('user_id', booking.coach_id)
        .maybeSingle<ProfileRow>()

      const memberName = privateCoachingMemberName(me)
      const slotLabel = `${formatSlotDate(booking.slot_date)} · ${formatPrivateCoachingSlotTime(booking.start_time)} - ${formatPrivateCoachingSlotTime(booking.end_time)}`

      await admin.from('notifications').insert({
        user_id: booking.coach_id,
        member_id: booking.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'New private coaching booking',
        body: [
          `${memberName} booked a private coaching slot${coach ? ` with ${privateCoachingMemberName(coach)}` : ''}.`,
          `Slot: ${slotLabel}`,
          booking.note ? `Note: ${booking.note}` : '',
          '',
          'Open /head-coach/private-coaching to view bookings.',
        ].filter(Boolean).join('\n'),
      })
    }

    return json(200, { ok: true, booking_id: bookingId })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
