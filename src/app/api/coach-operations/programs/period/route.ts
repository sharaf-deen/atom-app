export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageCoachTrainingPrograms } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function reply(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

type Body = {
  operation?: 'preview' | 'apply'
  programId?: string
  startDate?: string
  endDate?: string
  expectedUpdatedAt?: string
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return reply({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageCoachTrainingPrograms(me.role) || !['head_coach', 'super_admin'].includes(me.role)) {
    return reply({ ok: false, error: 'FORBIDDEN' }, 403)
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return reply({ ok: false, error: 'INVALID_BODY' }, 400)
  }
  if (!['preview', 'apply'].includes(String(body.operation ?? ''))) {
    return reply({ ok: false, error: 'INVALID_OPERATION' }, 400)
  }
  const programId = String(body.programId ?? '')
  const startDate = String(body.startDate ?? '')
  const endDate = String(body.endDate ?? '')
  if (!UUID_RE.test(programId)) return reply({ ok: false, error: 'INVALID_PROGRAM_ID' }, 400)
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || endDate < startDate) {
    return reply({ ok: false, error: 'INVALID_DATE_RANGE' }, 400)
  }

  const apply = body.operation === 'apply'
  const expectedUpdatedAt = String(body.expectedUpdatedAt ?? '')
  if (apply && (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt)))) {
    return reply({ ok: false, error: 'PREVIEW_REQUIRED' }, 409)
  }
  const supabase = createSupabaseServerActionClient()
  const { data, error } = await supabase.rpc('coach_training_program_period_change', {
    p_program_id: programId,
    p_new_start: startDate,
    p_new_end: endDate,
    p_mode: apply ? 'apply' : 'preview',
    p_expected_updated_at: apply ? expectedUpdatedAt : null,
  })

  if (error) {
    const message = String(error.message || '')
    const conflict = ['PROGRAM_CHANGED_REFRESH_PREVIEW','PROGRAM_TEMPLATE_PERIOD_CONFLICT',
      'PROGRAM_PERIOD_HAS_PROTECTED_FUTURE_LINKS','PROGRAM_PERIOD_SYNC_CONFLICT']
    if (conflict.some((item) => message.includes(item))) {
      return reply({ ok: false, error: message, details: 'Refresh the preview before retrying.' }, 409)
    }
    if (message.includes('PROGRAM_NOT_FOUND')) return reply({ ok: false, error: 'PROGRAM_NOT_FOUND' }, 404)
    if (message.includes('PUBLISHED_PROGRAM_REQUIRED')) return reply({ ok: false, error: 'PUBLISHED_PROGRAM_REQUIRED' }, 409)
    if (message.includes('INVALID_PERIOD')) return reply({ ok: false, error: 'INVALID_PERIOD' }, 400)
    if (message.includes('FORBIDDEN') || error.code === '42501') return reply({ ok: false, error: 'FORBIDDEN' }, 403)
    return reply({ ok: false, error: 'PERIOD_EDIT_FAILED', details: message }, 500)
  }

  if (apply) {
    revalidatePath('/coach-operations/programs')
    revalidatePath('/coach-operations/training-logs')
    revalidatePath('/schedule/sessions')
    revalidatePath('/schedule')
  }
  return reply(data ?? { ok: false, error: 'EMPTY_RESPONSE' })
}
