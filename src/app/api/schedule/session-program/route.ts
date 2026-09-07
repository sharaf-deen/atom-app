export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageCoachTrainingPrograms } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Body = {
  sessionId?: string
  programId?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageCoachTrainingPrograms(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const sessionId = String(body.sessionId ?? '').trim()
  const rawProgramId = body.programId == null ? '' : String(body.programId).trim()
  if (!UUID_RE.test(sessionId)) return json({ ok: false, error: 'INVALID_SESSION_ID' }, 400)
  if (rawProgramId && !UUID_RE.test(rawProgramId)) return json({ ok: false, error: 'INVALID_PROGRAM_ID' }, 400)

  const supabase = createSupabaseServerActionClient()
  const { data, error } = await supabase.rpc('set_schedule_session_training_program', {
    p_session_id: sessionId,
    p_program_id: rawProgramId || null,
  })

  if (error) {
    const message = String(error.message || '')
    if (message.includes('SESSION_NOT_FOUND')) return json({ ok: false, error: 'SESSION_NOT_FOUND' }, 404)
    if (message.includes('SESSION_NOT_SCHEDULED')) return json({ ok: false, error: 'SESSION_NOT_SCHEDULED' }, 409)
    if (message.includes('PUBLISHED_PROGRAM_NOT_FOUND')) return json({ ok: false, error: 'PUBLISHED_PROGRAM_NOT_FOUND' }, 400)
    if (message.includes('SESSION_OUTSIDE_PROGRAM_PERIOD')) {
      return json({ ok: false, error: 'SESSION_OUTSIDE_PROGRAM_PERIOD', details: 'Choose a published program whose date range includes this scheduled session.' }, 400)
    }
    if (message.includes('SESSION_HAS_TRAINING_LOG')) {
      return json({ ok: false, error: 'SESSION_HAS_TRAINING_LOG', details: 'The planned program cannot be changed after a Training Log has been linked to this session.' }, 409)
    }
    if (message.includes('FORBIDDEN') || error.code === '42501') return json({ ok: false, error: 'FORBIDDEN' }, 403)
    return json({ ok: false, error: 'PROGRAM_ASSIGNMENT_FAILED', details: message || 'Unable to update the session Training Program.' }, 500)
  }

  revalidatePath('/schedule/sessions')
  revalidatePath('/coach-operations/training-logs')
  return json({ ok: true, result: data })
}
