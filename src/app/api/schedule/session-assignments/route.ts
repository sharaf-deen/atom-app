export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canAccessScheduleTrainingSessions, canManageScheduleSessionCoachAssignments } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return null
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET() {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canAccessScheduleTrainingSessions(me.role)) {
    return json({ ok: false, error: 'FORBIDDEN' }, 403)
  }
  const canManage = canManageScheduleSessionCoachAssignments(me.role)

  const admin = adminClient()
  if (!admin) return json({ ok: false, error: 'SERVER_ENV_MISSING' }, 500)

  const { data, error } = await admin
    .from('profiles')
    .select('user_id,email,first_name,last_name,member_id,role')
    .in('role', ['assistant_coach', 'coach', 'head_coach', 'super_admin'])
    .not('user_id', 'is', null)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })

  if (error) {
    return json({ ok: false, error: 'STAFF_LOOKUP_FAILED', details: error.message }, 500)
  }

  const items = (data ?? []).map((row: any) => {
    const fullName =
      [row.first_name ?? '', row.last_name ?? ''].join(' ').trim()
      || row.email
      || row.member_id
      || 'Staff'

    return {
      user_id: String(row.user_id),
      full_name: fullName,
      email: canManage ? row.email ?? null : null,
      member_id: canManage ? row.member_id ?? null : null,
      role: String(row.role ?? 'coach'),
    }
  })

  return json({ ok: true, items })
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canAccessScheduleTrainingSessions(me.role)) {
    return json({ ok: false, error: 'FORBIDDEN' }, 403)
  }
  const canManage = canManageScheduleSessionCoachAssignments(me.role)

  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const sessionId = String(body?.sessionId ?? '').trim()
  const primaryUserId =
    body?.primaryUserId == null || String(body.primaryUserId).trim() === ''
      ? null
      : String(body.primaryUserId).trim()

  const rawAssistants = Array.isArray(body?.assistantUserIds) ? body.assistantUserIds : []
  const assistantUserIds: string[] = Array.from(
    new Set<string>(
      rawAssistants
        .map((value: unknown) => String(value ?? '').trim())
        .filter((value: string) => value.length > 0),
    ),
  )

  if (!UUID_RE.test(sessionId)) {
    return json({ ok: false, error: 'INVALID_SESSION_ID' }, 400)
  }
  if (primaryUserId && !UUID_RE.test(primaryUserId)) {
    return json({ ok: false, error: 'INVALID_PRIMARY_COACH' }, 400)
  }
  const assistantLimit = canManage ? 6 : 2
  if (assistantUserIds.length > assistantLimit || assistantUserIds.some((id) => !UUID_RE.test(id))) {
    return json({ ok: false, error: 'INVALID_ASSISTANTS', details: canManage ? 'Choose up to 6 assistants.' : 'Responsible Coach can choose up to 2 assistants.' }, 400)
  }
  if (primaryUserId && assistantUserIds.includes(primaryUserId)) {
    return json({ ok: false, error: 'DUPLICATE_STAFF_ASSIGNMENT' }, 400)
  }
  if (!primaryUserId && assistantUserIds.length > 0) {
    return json({ ok: false, error: 'PRIMARY_COACH_REQUIRED' }, 400)
  }
  if (!canManage && primaryUserId !== me.id) {
    return json({ ok: false, error: 'RESPONSIBLE_COACH_ONLY', details: 'Only the Responsible / Primary Coach can change assistants for this session.' }, 403)
  }

  const supabase = createSupabaseServerActionClient()
  const { data, error } = await supabase.rpc('set_schedule_session_coach_assignments', {
    p_session_id: sessionId,
    p_primary_user_id: primaryUserId,
    p_assistant_user_ids: assistantUserIds,
  })

  if (error) {
    const message = String(error.message || '')
    if (message.includes('FORBIDDEN') || error.code === '42501') {
      return json({ ok: false, error: 'FORBIDDEN', details: 'Only Head Coach / Super Admin, or the Responsible Coach for this session, can update the coaching team.' }, 403)
    }
    if (message.includes('TOO_MANY_ASSISTANTS')) {
      return json({ ok: false, error: 'TOO_MANY_ASSISTANTS', details: canManage ? 'Choose up to 6 assistants.' : 'Responsible Coach can choose up to 2 assistants.' }, 400)
    }
    if (message.includes('SESSION_LOG_COMPLETED')) {
      return json({ ok: false, error: 'SESSION_LOG_COMPLETED', details: 'Assistants cannot be changed after this session Training Log is completed.' }, 409)
    }
    return json(
      {
        ok: false,
        error: 'ASSIGNMENT_UPDATE_FAILED',
        details: message,
      },
      400,
    )
  }

  revalidatePath('/schedule/sessions')
  return json({ ok: true, result: data ?? null })
}
