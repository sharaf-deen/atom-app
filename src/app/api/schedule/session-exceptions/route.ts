export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageScheduleTrainingSessions } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Operation = 'details' | 'cancel' | 'restore' | 'replace_staff'

type Body = {
  sessionId?: string
  operation?: Operation
  reason?: string
  startTime?: string | null
  endTime?: string | null
  mat?: string | null
  primaryUserId?: string | null
  assistantUserIds?: unknown[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const OPERATIONS = new Set<Operation>(['details', 'cancel', 'restore', 'replace_staff'])

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function normalizedNullableString(value: unknown) {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageScheduleTrainingSessions(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const sessionId = String(body.sessionId ?? '').trim()
  const operation = String(body.operation ?? '').trim() as Operation
  const reason = String(body.reason ?? '').trim()

  if (!UUID_RE.test(sessionId)) return json({ ok: false, error: 'INVALID_SESSION_ID' }, 400)
  if (!OPERATIONS.has(operation)) return json({ ok: false, error: 'INVALID_OPERATION' }, 400)
  if (reason.length < 3 || reason.length > 1000) {
    return json({ ok: false, error: 'INVALID_REASON', details: 'Enter a reason between 3 and 1000 characters.' }, 400)
  }

  let startTime: string | null = null
  let endTime: string | null = null
  let mat: string | null = null
  let primaryUserId: string | null = null
  let assistantUserIds: string[] = []

  if (operation === 'details') {
    startTime = normalizedNullableString(body.startTime)
    endTime = normalizedNullableString(body.endTime)
    mat = normalizedNullableString(body.mat)

    if (!startTime || !TIME_RE.test(startTime)) {
      return json({ ok: false, error: 'INVALID_START_TIME' }, 400)
    }
    if (endTime && !TIME_RE.test(endTime)) return json({ ok: false, error: 'INVALID_END_TIME' }, 400)
    if (endTime && endTime <= startTime) {
      return json({ ok: false, error: 'INVALID_END_TIME', details: 'End time must be after start time.' }, 400)
    }
    if (mat && mat.length > 80) return json({ ok: false, error: 'INVALID_MAT' }, 400)
  }

  if (operation === 'replace_staff') {
    primaryUserId = normalizedNullableString(body.primaryUserId)
    const rawAssistants = Array.isArray(body.assistantUserIds) ? body.assistantUserIds : []
    assistantUserIds = Array.from(
      new Set<string>(
        rawAssistants
          .map((value: unknown) => String(value ?? '').trim())
          .filter((value: string) => value.length > 0),
      ),
    )

    if (!primaryUserId || !UUID_RE.test(primaryUserId)) {
      return json({ ok: false, error: 'INVALID_PRIMARY_COACH' }, 400)
    }
    if (assistantUserIds.length > 6 || assistantUserIds.some((id) => !UUID_RE.test(id))) {
      return json({ ok: false, error: 'INVALID_ASSISTANTS' }, 400)
    }
    if (assistantUserIds.includes(primaryUserId)) {
      return json({ ok: false, error: 'DUPLICATE_STAFF_ASSIGNMENT' }, 400)
    }
  }

  const supabase = createSupabaseServerActionClient()
  const { data, error } = await supabase.rpc('apply_schedule_session_exception', {
    p_session_id: sessionId,
    p_operation: operation,
    p_reason: reason,
    p_start_time: startTime,
    p_end_time: endTime,
    p_mat: mat,
    p_primary_user_id: primaryUserId,
    p_assistant_user_ids: assistantUserIds,
  })

  if (error) {
    const message = String(error.message || '')

    if (message.includes('SESSION_NOT_FOUND')) return json({ ok: false, error: 'SESSION_NOT_FOUND' }, 404)
    if (message.includes('SESSION_NOT_SCHEDULED')) return json({ ok: false, error: 'SESSION_NOT_SCHEDULED' }, 409)
    if (message.includes('SESSION_NOT_CANCELLED')) return json({ ok: false, error: 'SESSION_NOT_CANCELLED' }, 409)
    if (message.includes('SESSION_HAS_OPERATIONAL_HISTORY')) {
      return json(
        {
          ok: false,
          error: 'SESSION_HAS_OPERATIONAL_HISTORY',
          details: 'Time or mat cannot be changed after a staff QR check-in or Training Log has been linked to this session.',
        },
        409,
      )
    }
    if (message.includes('SESSION_HAS_TRAINING_LOG')) {
      return json(
        {
          ok: false,
          error: 'SESSION_HAS_TRAINING_LOG',
          details: 'This action is locked because a Training Log is already linked to the session.',
        },
        409,
      )
    }
    if (message.includes('PRIMARY_COACH_REQUIRED')) return json({ ok: false, error: 'PRIMARY_COACH_REQUIRED' }, 400)
    if (message.includes('TOO_MANY_ASSISTANTS')) return json({ ok: false, error: 'TOO_MANY_ASSISTANTS' }, 400)
    if (message.includes('INVALID_PRIMARY_COACH')) return json({ ok: false, error: 'INVALID_PRIMARY_COACH' }, 400)
    if (message.includes('INVALID_ASSISTANT_COACH')) return json({ ok: false, error: 'INVALID_ASSISTANT_COACH' }, 400)
    if (message.includes('INVALID_START_TIME')) return json({ ok: false, error: 'INVALID_START_TIME' }, 400)
    if (message.includes('INVALID_END_TIME')) return json({ ok: false, error: 'INVALID_END_TIME' }, 400)
    if (message.includes('INVALID_MAT')) return json({ ok: false, error: 'INVALID_MAT' }, 400)
    if (message.includes('INVALID_REASON')) return json({ ok: false, error: 'INVALID_REASON' }, 400)
    if (message.includes('FORBIDDEN') || error.code === '42501') return json({ ok: false, error: 'FORBIDDEN' }, 403)

    return json({ ok: false, error: 'SESSION_EXCEPTION_FAILED', details: message || 'Unable to apply the schedule exception.' }, 500)
  }

  revalidatePath('/schedule/sessions')
  revalidatePath('/schedule')
  revalidatePath('/coach-operations/staff-attendance')
  revalidatePath('/coach-operations/training-logs')

  return json({ ok: true, result: data ?? null })
}
