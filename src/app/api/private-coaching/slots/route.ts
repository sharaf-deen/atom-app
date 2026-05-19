export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_MANAGER_ROLES,
  isValidPrivateCoachingSlotDate,
  isValidPrivateCoachingSlotTime,
  privateCoachingMemberName,
} from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function minutes(value: string) {
  const [h, m] = value.split(':').map((part) => Number(part))
  return h * 60 + m
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
      .select('user_id, role, first_name, last_name, email')
      .eq('user_id', auth.user.id)
      .maybeSingle<ProfileRow>()

    if (meError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message })
    if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const body = await req.json().catch(() => ({} as any))
    const slotDate = String(body?.slot_date ?? '').trim()
    const startTime = String(body?.start_time ?? '').trim()
    const endTime = String(body?.end_time ?? '').trim()
    const note = String(body?.note ?? '').trim()
    const requestedCoachId = String(body?.coach_id ?? '').trim()

    if (!isValidPrivateCoachingSlotDate(slotDate)) return json(400, { ok: false, error: 'INVALID_DATE' })
    if (!isValidPrivateCoachingSlotTime(startTime)) return json(400, { ok: false, error: 'INVALID_START_TIME' })
    if (!isValidPrivateCoachingSlotTime(endTime)) return json(400, { ok: false, error: 'INVALID_END_TIME' })
    if (minutes(endTime) <= minutes(startTime)) return json(400, { ok: false, error: 'INVALID_TIME_RANGE', details: 'End time must be after start time.' })
    if (note.length > 500) return json(400, { ok: false, error: 'NOTE_TOO_LONG' })

    let coachId = auth.user.id
    if (me.role === 'super_admin') {
      coachId = requestedCoachId || auth.user.id
    }

    const { data: coach, error: coachError } = await admin
      .from('profiles')
      .select('user_id, role, first_name, last_name, email')
      .eq('user_id', coachId)
      .maybeSingle<ProfileRow>()

    if (coachError) return json(500, { ok: false, error: 'COACH_LOOKUP_FAILED', details: coachError.message })
    if (!coach?.user_id || coach.role !== 'head_coach') {
      return json(400, { ok: false, error: 'HEAD_COACH_NOT_FOUND' })
    }

    const { data: inserted, error: insertError } = await admin
      .from('private_coaching_slots')
      .insert({
        coach_id: coach.user_id,
        slot_date: slotDate,
        start_time: startTime,
        end_time: endTime,
        status: 'available',
        note: note || null,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertError) {
      const duplicate = insertError.message?.toLowerCase().includes('duplicate') || insertError.code === '23505'
      return json(duplicate ? 409 : 500, {
        ok: false,
        error: duplicate ? 'SLOT_ALREADY_EXISTS' : 'CREATE_FAILED',
        details: duplicate ? 'An available slot already exists for this coach at the same date and time.' : insertError.message,
      })
    }

    return json(200, { ok: true, id: inserted.id, coach_name: privateCoachingMemberName(coach) })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
