export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canManageScheduleSessionCoachAssignments } from '@/lib/rbac'
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
  if (!canManageScheduleSessionCoachAssignments(me.role)) {
    return json({ ok: false, error: 'FORBIDDEN' }, 403)
  }

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
      email: row.email ?? null,
      member_id: row.member_id ?? null,
      role: String(row.role ?? 'coach'),
    }
  })

  return json({ ok: true, items })
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

  const sessionId = String(body?.sessionId ?? '').trim()
  const primaryUserId =
    body?.primaryUserId == null || String(body.primaryUserId).trim() === ''
      ? null
      : String(body.primaryUserId).trim()

  const rawAssistants = Array.isArray(body?.assistantUserIds) ? body.assistantUserIds : []
  const assistantUserIds = Array.from(
    new Set(
      rawAssistants
        .map((value: unknown) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  )

  if (!UUID_RE.test(sessionId)) {
    return json({ ok: false, error: 'INVALID_SESSION_ID' }, 400)
  }
  if (primaryUserId && !UUID_RE.test(primaryUserId)) {
    return json({ ok: false, error: 'INVALID_PRIMARY_COACH' }, 400)
  }
  if (assistantUserIds.length > 6 || assistantUserIds.some((id) => !UUID_RE.test(id))) {
    return json({ ok: false, error: 'INVALID_ASSISTANTS' }, 400)
  }
  if (primaryUserId && assistantUserIds.includes(primaryUserId)) {
    return json({ ok: false, error: 'DUPLICATE_STAFF_ASSIGNMENT' }, 400)
  }
  if (!primaryUserId && assistantUserIds.length > 0) {
    return json({ ok: false, error: 'PRIMARY_COACH_REQUIRED' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const { data, error } = await supabase.rpc('set_schedule_session_coach_assignments', {
    p_session_id: sessionId,
    p_primary_user_id: primaryUserId,
    p_assistant_user_ids: assistantUserIds,
  })

  if (error) {
    return json(
      {
        ok: false,
        error: 'ASSIGNMENT_UPDATE_FAILED',
        details: error.message,
      },
      400,
    )
  }

  revalidatePath('/schedule/sessions')
  return json({ ok: true, result: data ?? null })
}
