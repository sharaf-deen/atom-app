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

type BookingRow = {
  id: string
  coach_id: string
  status: string
  archived_at: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

async function getContext(bookingId: string) {
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

  const { data: row, error } = await admin
    .from('private_coaching_bookings')
    .select('id, coach_id, status, archived_at')
    .eq('id', bookingId)
    .maybeSingle<BookingRow>()

  if (error) return { response: json(500, { ok: false, error: 'BOOKING_LOOKUP_FAILED', details: error.message }) }
  if (!row?.id) return { response: json(404, { ok: false, error: 'BOOKING_NOT_FOUND' }) }
  if (me.role === 'head_coach' && row.coach_id !== auth.user.id) {
    return { response: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  return { admin, auth, row }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const bookingId = String(params?.id ?? '').trim()
    if (!bookingId) return json(400, { ok: false, error: 'MISSING_BOOKING_ID' })

    const context = await getContext(bookingId)
    if ('response' in context) return context.response
    const { admin, auth, row } = context

    if (row.archived_at) return json(200, { ok: true, archived: true })
    if (row.status === 'booked') {
      return json(409, {
        ok: false,
        error: 'BOOKING_MUST_BE_CLOSED_FIRST',
        details: 'Booked sessions must be completed or cancelled before they can be archived.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const reason = String(body?.reason ?? '').trim().slice(0, 500) || null
    const now = new Date().toISOString()
    const { error: updateError } = await admin
      .from('private_coaching_bookings')
      .update({ archived_at: now, archived_by: auth.user.id, archive_reason: reason, updated_by: auth.user.id })
      .eq('id', row.id)

    if (updateError) return json(500, { ok: false, error: 'ARCHIVE_FAILED', details: updateError.message })
    return json(200, { ok: true, archived: true })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const bookingId = String(params?.id ?? '').trim()
    if (!bookingId) return json(400, { ok: false, error: 'MISSING_BOOKING_ID' })

    const context = await getContext(bookingId)
    if ('response' in context) return context.response
    const { admin, auth, row } = context

    if (!row.archived_at) return json(200, { ok: true, archived: false })

    const { error: updateError } = await admin
      .from('private_coaching_bookings')
      .update({ archived_at: null, archived_by: null, archive_reason: null, updated_by: auth.user.id })
      .eq('id', row.id)

    if (updateError) return json(500, { ok: false, error: 'RESTORE_FAILED', details: updateError.message })
    return json(200, { ok: true, archived: false })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
