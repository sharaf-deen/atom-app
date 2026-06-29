export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  PRIVATE_COACHING_ALLOWED_MEMBER_ROLES,
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
  member_id?: string | null
  phone?: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
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
    const assignedMemberId = String(body?.assigned_member_id ?? '').trim()
    const backdatedReason = String(body?.backdated_reason ?? '').trim()
    const isBackdated = slotDate < todayInputValue()

    if (!isValidPrivateCoachingSlotDate(slotDate)) return json(400, { ok: false, error: 'INVALID_DATE' })
    if (!isValidPrivateCoachingSlotTime(startTime)) return json(400, { ok: false, error: 'INVALID_START_TIME' })
    if (!isValidPrivateCoachingSlotTime(endTime)) return json(400, { ok: false, error: 'INVALID_END_TIME' })
    if (minutes(endTime) <= minutes(startTime)) return json(400, { ok: false, error: 'INVALID_TIME_RANGE', details: 'End time must be after start time.' })
    if (note.length > 500) return json(400, { ok: false, error: 'NOTE_TOO_LONG' })
    if (backdatedReason.length > 500) return json(400, { ok: false, error: 'BACKDATED_REASON_TOO_LONG' })
    if (isBackdated && !assignedMemberId) {
      return json(400, { ok: false, error: 'ASSIGNED_MEMBER_REQUIRED', details: 'Choose the member for this past slot correction.' })
    }
    if (isBackdated && backdatedReason.length < 3) {
      return json(400, { ok: false, error: 'BACKDATED_REASON_REQUIRED', details: 'Add a short reason for this past slot correction.' })
    }

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

    let assignedMember: ProfileRow | null = null
    if (isBackdated) {
      const { data: member, error: memberError } = await admin
        .from('profiles')
        .select('user_id, role, first_name, last_name, email, member_id, phone')
        .eq('user_id', assignedMemberId)
        .maybeSingle<ProfileRow>()

      if (memberError) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: memberError.message })
      if (!member?.user_id || !(PRIVATE_COACHING_ALLOWED_MEMBER_ROLES as readonly string[]).includes(String(member.role ?? ''))) {
        return json(400, { ok: false, error: 'INVALID_ASSIGNED_MEMBER', details: 'Choose a valid member for this backdated correction.' })
      }
      assignedMember = member
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
        is_backdated: isBackdated,
        assigned_member_id: isBackdated ? assignedMember?.user_id : null,
        backdated_reason: isBackdated ? backdatedReason : null,
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
        details: duplicate ? 'A slot already exists for this coach at this date and time. Switch the slots list to Past or All to view, cancel, or use the existing slot.' : insertError.message,
      })
    }

    return json(200, { ok: true, id: inserted.id, coach_name: privateCoachingMemberName(coach) })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
