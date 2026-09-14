export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageScheduleSessionCoachAssignments } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SERIES_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageScheduleSessionCoachAssignments(me.role)) {
    return json({ ok: false, error: 'FORBIDDEN' }, 403)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const seriesKey = String(body?.seriesKey ?? '').trim()
  const primaryUserId =
    body?.primaryUserId == null || String(body.primaryUserId).trim() === ''
      ? null
      : String(body.primaryUserId).trim()

  const assistantUserIds: string[] = Array.from(
    new Set<string>(
      (Array.isArray(body?.assistantUserIds) ? body.assistantUserIds : [])
        .map((value: unknown) => String(value ?? '').trim())
        .filter((value: string) => value.length > 0),
    ),
  )

  if (!SERIES_RE.test(seriesKey)) return json({ ok: false, error: 'INVALID_SERIES_KEY' }, 400)
  if (primaryUserId && !UUID_RE.test(primaryUserId)) return json({ ok: false, error: 'INVALID_PRIMARY_COACH' }, 400)
  if (assistantUserIds.length > 2 || assistantUserIds.some((id) => !UUID_RE.test(id))) {
    return json({ ok: false, error: 'INVALID_ASSISTANTS', details: 'Choose up to two assistant coaches.' }, 400)
  }
  if (!primaryUserId && assistantUserIds.length > 0) {
    return json({ ok: false, error: 'PRIMARY_COACH_REQUIRED' }, 400)
  }
  if (primaryUserId && assistantUserIds.includes(primaryUserId)) {
    return json({ ok: false, error: 'DUPLICATE_STAFF_ASSIGNMENT' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const { data, error } = await supabase.rpc('set_schedule_series_coaching_team', {
    p_series_key: seriesKey,
    p_primary_user_id: primaryUserId,
    p_assistant_user_ids: assistantUserIds,
  })

  if (error) {
    const message = String(error.message || '')
    if (message.includes('FORBIDDEN') || error.code === '42501') return json({ ok: false, error: 'FORBIDDEN' }, 403)
    if (message.includes('SERIES_NOT_FOUND')) return json({ ok: false, error: 'SERIES_NOT_FOUND' }, 404)
    if (message.includes('PRIMARY_COACH_REQUIRED')) return json({ ok: false, error: 'PRIMARY_COACH_REQUIRED' }, 400)
    if (message.includes('TOO_MANY_ASSISTANTS')) return json({ ok: false, error: 'TOO_MANY_ASSISTANTS', details: 'Choose up to two assistant coaches.' }, 400)
    if (message.includes('INVALID_PRIMARY_COACH')) return json({ ok: false, error: 'INVALID_PRIMARY_COACH' }, 400)
    if (message.includes('INVALID_ASSISTANT_COACH')) return json({ ok: false, error: 'INVALID_ASSISTANT_COACH' }, 400)
    return json({ ok: false, error: 'DEFAULT_TEAM_UPDATE_FAILED', details: message || 'Unable to update the default coaching team.' }, 500)
  }

  revalidatePath('/schedule/sessions')
  revalidatePath('/coach-operations/training-logs')
  revalidatePath('/admin/staff-payroll/coaching-import')

  return json({ ok: true, result: data ?? null })
}
