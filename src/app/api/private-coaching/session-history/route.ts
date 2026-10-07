export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { PRIVATE_COACHING_ALLOWED_MEMBER_ROLES, privateCoachingMemberName } from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type BookingRow = {
  id: string
  coach_id: string
  slot_date: string
  start_time: string
  end_time: string
  status: string
  booked_at: string
  completed_at: string | null
  cancelled_at: string | null
  archived_at: string | null
}

function json(status: number, body: unknown) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return response
}

export async function GET() {
  try {
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
    if (!me?.user_id || !(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { data: bookingsData, error: bookingsError } = await admin
      .from('private_coaching_bookings')
      .select('id, coach_id, slot_date, start_time, end_time, status, booked_at, completed_at, cancelled_at, archived_at')
      .eq('member_id', auth.user.id)
      .neq('status', 'cancelled')
      .order('slot_date', { ascending: false })
      .order('start_time', { ascending: false })
      .limit(100)

    if (bookingsError) {
      return json(500, { ok: false, error: 'BOOKINGS_LOOKUP_FAILED', details: bookingsError.message })
    }

    const bookings = (bookingsData ?? []) as BookingRow[]
    if (!bookings.length) {
      return json(200, { ok: true, sessions: [] })
    }

    const bookingIds = bookings.map((row) => row.id)
    const coachIds = Array.from(new Set(bookings.map((row) => row.coach_id).filter(Boolean)))

    const [coachesRes, contentRes, blocksRes, techniquesRes, situationsRes] = await Promise.all([
      coachIds.length
        ? admin.from('profiles')
            .select('user_id, role, first_name, last_name, email')
            .in('user_id', coachIds)
        : Promise.resolve({ data: [], error: null } as any),
      admin.from('private_coaching_session_contents')
        .select('booking_id, session_notes, updated_at')
        .in('booking_id', bookingIds),
      admin.from('private_coaching_session_blocks')
        .select('booking_id, block_name_snapshot, sort_order')
        .in('booking_id', bookingIds)
        .order('sort_order', { ascending: true }),
      admin.from('private_coaching_session_techniques')
        .select('booking_id, technique_name_snapshot, block_name_snapshot, sort_order')
        .in('booking_id', bookingIds)
        .order('sort_order', { ascending: true }),
      admin.from('private_coaching_session_situations')
        .select('booking_id, situation_name_snapshot, technique_name_snapshot, sort_order')
        .in('booking_id', bookingIds)
        .order('sort_order', { ascending: true }),
    ])

    const loadError =
      coachesRes.error ||
      contentRes.error ||
      blocksRes.error ||
      techniquesRes.error ||
      situationsRes.error

    if (loadError) {
      return json(500, { ok: false, error: 'SESSION_HISTORY_LOAD_FAILED', details: loadError.message })
    }

    const coachesById = new Map<string, ProfileRow>()
    for (const coach of (coachesRes.data ?? []) as ProfileRow[]) {
      coachesById.set(coach.user_id, coach)
    }

    const contentByBooking = new Map<string, { session_notes: string | null; updated_at: string | null }>()
    for (const row of (contentRes.data ?? []) as Array<{ booking_id: string; session_notes: string | null; updated_at: string | null }>) {
      contentByBooking.set(row.booking_id, row)
    }

    const blocksByBooking = new Map<string, string[]>()
    for (const row of (blocksRes.data ?? []) as Array<{ booking_id: string; block_name_snapshot: string }>) {
      blocksByBooking.set(row.booking_id, [...(blocksByBooking.get(row.booking_id) ?? []), row.block_name_snapshot])
    }

    const techniquesByBooking = new Map<string, Array<{ name: string; block: string | null }>>()
    for (const row of (techniquesRes.data ?? []) as Array<{ booking_id: string; technique_name_snapshot: string; block_name_snapshot: string | null }>) {
      techniquesByBooking.set(row.booking_id, [
        ...(techniquesByBooking.get(row.booking_id) ?? []),
        { name: row.technique_name_snapshot, block: row.block_name_snapshot },
      ])
    }

    const situationsByBooking = new Map<string, Array<{ name: string; technique: string | null }>>()
    for (const row of (situationsRes.data ?? []) as Array<{ booking_id: string; situation_name_snapshot: string; technique_name_snapshot: string | null }>) {
      situationsByBooking.set(row.booking_id, [
        ...(situationsByBooking.get(row.booking_id) ?? []),
        { name: row.situation_name_snapshot, technique: row.technique_name_snapshot },
      ])
    }

    const sessions = bookings.map((booking) => {
      const content = contentByBooking.get(booking.id)
      const blocks = blocksByBooking.get(booking.id) ?? []
      const techniques = techniquesByBooking.get(booking.id) ?? []
      const situations = situationsByBooking.get(booking.id) ?? []
      const hasTechnicalContent =
        blocks.length > 0 ||
        techniques.length > 0 ||
        situations.length > 0 ||
        Boolean(content?.session_notes?.trim())

      return {
        id: booking.id,
        coach_name: privateCoachingMemberName(coachesById.get(booking.coach_id) ?? {}),
        slot_date: booking.slot_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        status: booking.status,
        completed_at: booking.completed_at,
        archived_at: booking.archived_at,
        technical_content_updated_at: content?.updated_at ?? null,
        has_technical_content: hasTechnicalContent,
        blocks,
        techniques,
        situations,
        session_notes: content?.session_notes ?? null,
      }
    })

    return json(200, { ok: true, sessions })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
