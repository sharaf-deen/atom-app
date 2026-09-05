export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import {
  MEMBER_LIKE_ROLES,
  canAccessCoachMemberIncidents,
  canCreateCoachMemberIncidents,
  canManageCoachMemberIncidents,
} from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type IncidentCategory = 'behaviour' | 'safety' | 'injury' | 'repeated_lateness' | 'disrespect' | 'other'
type IncidentSeverity = 'low' | 'medium' | 'high'
type Operation = 'create' | 'resolve' | 'reopen'

type Body = {
  operation?: Operation
  id?: string
  memberId?: string
  trainingLogId?: string | null
  category?: IncidentCategory
  severity?: IncidentSeverity
  description?: string
  resolutionNote?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CATEGORIES = new Set<IncidentCategory>(['behaviour','safety','injury','repeated_lateness','disrespect','other'])
const SEVERITIES = new Set<IncidentSeverity>(['low','medium','high'])

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function cleanText(value: unknown, max: number) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)
}

function fullName(first?: string | null, last?: string | null, fallback?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim() || fallback || 'ATOM member'
}

export async function GET(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canAccessCoachMemberIncidents(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  const url = new URL(request.url)
  const action = String(url.searchParams.get('action') ?? '').trim()

  if (action !== 'members') {
    return json({ ok: false, error: 'INVALID_ACTION' }, 400)
  }

  const q = String(url.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return json({ ok: true, items: [] })

  const admin = createSupabaseAdminClient()
  const escaped = q.replace(/[%_,()]/g, ' ').trim()
  if (!escaped) return json({ ok: true, items: [] })

  let query = admin
    .from('profiles')
    .select('user_id,member_id,first_name,last_name,email,role')
    .in('role', [...MEMBER_LIKE_ROLES])
    .order('first_name', { ascending: true })
    .limit(20)

  query = query.or(
    [
      `first_name.ilike.%${escaped}%`,
      `last_name.ilike.%${escaped}%`,
      `member_id.ilike.%${escaped}%`,
    ].join(','),
  )

  const { data, error } = await query
  if (error) return json({ ok: false, error: 'MEMBER_SEARCH_FAILED', details: error.message }, 500)

  return json({
    ok: true,
    items: (data ?? []).map((row: any) => ({
      userId: String(row.user_id),
      memberId: row.member_id ? String(row.member_id) : null,
      name: fullName(row.first_name, row.last_name, row.email),
    })),
  })
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const operation = body.operation
  if (!operation || !['create','resolve','reopen'].includes(operation)) {
    return json({ ok: false, error: 'INVALID_OPERATION' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const now = new Date().toISOString()

  if (operation === 'create') {
    if (!canCreateCoachMemberIncidents(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

    const memberId = String(body.memberId ?? '').trim()
    const trainingLogId = String(body.trainingLogId ?? '').trim() || null
    const category = String(body.category ?? '').trim() as IncidentCategory
    const severity = String(body.severity ?? '').trim() as IncidentSeverity
    const description = cleanText(body.description, 3000)

    if (!UUID_RE.test(memberId)) return json({ ok: false, error: 'INVALID_MEMBER' }, 400)
    if (trainingLogId && !UUID_RE.test(trainingLogId)) return json({ ok: false, error: 'INVALID_TRAINING_LOG' }, 400)
    if (!CATEGORIES.has(category)) return json({ ok: false, error: 'INVALID_CATEGORY' }, 400)
    if (!SEVERITIES.has(severity)) return json({ ok: false, error: 'INVALID_SEVERITY' }, 400)
    if (description.length < 5) return json({ ok: false, error: 'DESCRIPTION_REQUIRED' }, 400)

    const admin = createSupabaseAdminClient()
    const { data: member, error: memberError } = await admin
      .from('profiles')
      .select('user_id,member_id,first_name,last_name,email,role')
      .eq('user_id', memberId)
      .maybeSingle()

    if (memberError) return json({ ok: false, error: 'MEMBER_LOOKUP_FAILED', details: memberError.message }, 500)
    if (!member || !MEMBER_LIKE_ROLES.includes(member.role as any)) {
      return json({ ok: false, error: 'MEMBER_NOT_FOUND' }, 404)
    }

    let trainingGroup: string | null = null
    let trainingDate: string | null = null

    if (trainingLogId) {
      const { data: log, error: logError } = await supabase
        .from('coach_training_session_logs')
        .select('id,target_group_snapshot,training_date,status')
        .eq('id', trainingLogId)
        .maybeSingle()

      if (logError) return json({ ok: false, error: 'TRAINING_LOG_LOOKUP_FAILED', details: logError.message }, 500)
      if (!log || log.status !== 'completed') return json({ ok: false, error: 'TRAINING_LOG_NOT_AVAILABLE' }, 400)

      trainingGroup = String(log.target_group_snapshot ?? '').trim() || null
      trainingDate = String(log.training_date ?? '').trim() || null
    }

    const reporterName = fullName(me.first_name, me.last_name, me.email)
    const memberName = fullName(member.first_name, member.last_name, member.email)

    const { data, error } = await supabase
      .from('coach_member_incidents')
      .insert({
        member_id: memberId,
        member_name_snapshot: memberName,
        member_code_snapshot: member.member_id ?? null,
        training_log_id: trainingLogId,
        training_group_snapshot: trainingGroup,
        training_date_snapshot: trainingDate,
        category,
        severity,
        description,
        status: 'open',
        reported_by: me.id,
        reporter_name_snapshot: reporterName,
        reporter_role_snapshot: me.role,
      })
      .select('id')
      .single()

    if (error) return json({ ok: false, error: 'CREATE_FAILED', details: error.message }, 500)

    revalidatePath('/coach-operations/incidents')
    revalidatePath(`/members/${memberId}`)
    return json({ ok: true, id: data.id })
  }

  if (!canManageCoachMemberIncidents(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  const id = String(body.id ?? '').trim()
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)

  if (operation === 'resolve') {
    const resolutionNote = cleanText(body.resolutionNote, 2000)
    const { data, error } = await supabase
      .from('coach_member_incidents')
      .update({
        status: 'resolved',
        resolved_by: me.id,
        resolved_at: now,
        resolution_note: resolutionNote || null,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'open')
      .select('id,member_id')
      .maybeSingle()

    if (error) return json({ ok: false, error: 'RESOLVE_FAILED', details: error.message }, 500)
    if (!data) return json({ ok: false, error: 'NOT_FOUND_OR_ALREADY_RESOLVED' }, 404)

    revalidatePath('/coach-operations/incidents')
    revalidatePath(`/members/${data.member_id}`)
    return json({ ok: true })
  }

  const { data, error } = await supabase
    .from('coach_member_incidents')
    .update({
      status: 'open',
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
      reopened_by: me.id,
      reopened_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'resolved')
    .select('id,member_id')
    .maybeSingle()

  if (error) return json({ ok: false, error: 'REOPEN_FAILED', details: error.message }, 500)
  if (!data) return json({ ok: false, error: 'NOT_FOUND_OR_NOT_RESOLVED' }, 404)

  revalidatePath('/coach-operations/incidents')
  revalidatePath(`/members/${data.member_id}`)
  return json({ ok: true })
}
