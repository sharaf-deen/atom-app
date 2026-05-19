export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_MANAGER_ROLES,
  formatPrivateCoachingSlotTime,
  privateCoachingMemberName,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type BookingRow = {
  id: string
  member_id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  status: string
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
  if (text.includes('PRIVATE_COACHING_BOOKING_NOT_FOUND')) return 404
  if (text.includes('PRIVATE_COACHING_FORBIDDEN')) return 403
  return 500
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const bookingId = String(params?.id ?? '').trim()
    if (!bookingId) return json(400, { ok: false, error: 'MISSING_BOOKING_ID' })

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

    const { data: bookingBefore, error: bookingError } = await admin
      .from('private_coaching_bookings')
      .select('id, member_id, coach_id, slot_date, start_time, end_time, status, note')
      .eq('id', bookingId)
      .maybeSingle<BookingRow>()

    if (bookingError) return json(500, { ok: false, error: 'BOOKING_LOOKUP_FAILED', details: bookingError.message })
    if (!bookingBefore?.id) return json(404, { ok: false, error: 'BOOKING_NOT_FOUND' })
    if (me.role === 'head_coach' && bookingBefore.coach_id !== auth.user.id) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { error: rpcError } = await admin.rpc('private_coaching_complete_booking_by_coach', {
      p_booking_id: bookingId,
      p_actor_id: auth.user.id,
    })

    if (rpcError) {
      return json(rpcStatus(rpcError.message), {
        ok: false,
        error: 'COMPLETE_BOOKING_FAILED',
        details: rpcError.message || 'Could not mark booking as completed.',
      })
    }

    if (bookingBefore.status === 'booked') {
      const { data: profiles } = await admin
        .from('profiles')
        .select('user_id, role, first_name, last_name, email')
        .in('user_id', [bookingBefore.member_id, bookingBefore.coach_id, auth.user.id])
        .limit(10)

      const byId = new Map<string, ProfileRow>()
      for (const profile of (profiles ?? []) as ProfileRow[]) byId.set(profile.user_id, profile)
      const coachName = privateCoachingMemberName(byId.get(bookingBefore.coach_id) ?? me)
      const slotLabel = `${formatSlotDate(bookingBefore.slot_date)} · ${formatPrivateCoachingSlotTime(bookingBefore.start_time)} - ${formatPrivateCoachingSlotTime(bookingBefore.end_time)}`

      await admin.from('notifications').insert({
        user_id: bookingBefore.member_id,
        member_id: bookingBefore.member_id,
        created_by: auth.user.id,
        kind: 'info',
        title: 'Private coaching session completed',
        body: [
          `${coachName} marked your private coaching session as completed.`,
          `Session: ${slotLabel}`,
        ].join('\n'),
      })
    }

    return json(200, { ok: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
