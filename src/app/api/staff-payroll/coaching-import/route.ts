// Staff Payroll 1G — Automatic Coaching Import
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanString(value: unknown, max = 2000) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function normalizeUuid(value: unknown) {
  const s = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : ''
}

function normalizeMonthStart(value: unknown) {
  const raw = cleanString(value, 20)
  const match = raw.match(/^(\d{4})-(\d{2})(?:-01)?$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return ''
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

function currentCairoMonthStart() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (year && month) return `${year}-${month}-01`
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function nextMonthStart(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  const d = new Date(Date.UTC(year, month, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function parsePositiveHours(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > 12) return null
  return Math.round(n * 100) / 100
}

function timeDurationHours(start: unknown, end: unknown) {
  const startText = typeof start === 'string' ? start : ''
  const endText = typeof end === 'string' ? end : ''
  if (!/^\d{2}:\d{2}/.test(startText) || !/^\d{2}:\d{2}/.test(endText)) return null
  const [sh, sm, ss = '0'] = startText.split(':').map(Number)
  const [eh, em, es = '0'] = endText.split(':').map(Number)
  const startSec = sh * 3600 + sm * 60 + ss
  const endSec = eh * 3600 + em * 60 + es
  if (endSec <= startSec) return null
  return Math.round(((endSec - startSec) / 3600) * 100) / 100
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr || !auth.user) {
    return { supabase, actorId: '', role: '', error: authErr?.message || 'NOT_AUTHENTICATED' }
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()
  return {
    supabase,
    actorId: auth.user.id,
    role: profile?.role ?? 'member',
    error: error?.message ?? '',
  }
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // Audit failure must not hide an already completed operational action.
  }
}

async function monthLocked(admin: any, monthStart: string) {
  const { data, error } = await admin
    .from('staff_payroll_monthly_snapshots')
    .select('status,approval_version_no,approved_at')
    .eq('month_start', monthStart)
    .maybeSingle()
  if (error) throw error
  return {
    locked: data?.status === 'approved',
    versionNo: Number(data?.approval_version_no ?? 0),
    approvedAt: data?.approved_at ? String(data.approved_at) : null,
  }
}

async function buildMonthModel(admin: any, monthStart: string) {
  const monthEnd = nextMonthStart(monthStart)
  const lock = await monthLocked(admin, monthStart)

  const [sessionsResult, templatesResult, tasksResult, mappingsResult, confirmationsResult, importsResult, logsResult] =
    await Promise.all([
      admin
        .from('schedule_training_sessions')
        .select('id,class_template_id,session_date,start_time,end_time,name_snapshot,status,mat_snapshot,activity_type_snapshot,uniform_snapshot,level_snapshot')
        .gte('session_date', monthStart)
        .lt('session_date', monthEnd)
        .neq('status', 'cancelled')
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true }),
      admin
        .from('schedule_class_templates')
        .select('id,series_key,name,day_of_week,start_time,end_time,mat,is_active,audience,level,activity_type,uniform')
        .order('sort_order', { ascending: true })
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true }),
      admin
        .from('staff_tasks')
        .select('id,area_id,name,unit,importance_level,importance_multiplier,is_active,sort_order')
        .eq('unit', 'class')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('staff_payroll_coaching_template_mappings')
        .select('id,class_template_id,payroll_task_id,default_duration_hours,is_active,updated_at'),
      admin
        .from('staff_payroll_coaching_confirmations')
        .select('id,month_start,training_session_id,staff_user_id,reason,confirmed_at,confirmed_by,revoked_at,revoke_reason')
        .eq('month_start', monthStart),
      admin
        .from('staff_payroll_coaching_import_items')
        .select('id,month_start,training_session_id,staff_user_id,payroll_task_id,monthly_task_log_id,task_name_snapshot,evidence_type,duration_hours,duration_source,status,imported_at,release_reason')
        .eq('month_start', monthStart),
      admin
        .from('staff_monthly_task_logs')
        .select('id,month_start,staff_user_id,task_id,task_name_snapshot,source,work_quantity,actual_hours,voided_at')
        .eq('month_start', monthStart)
        .is('voided_at', null),
    ])

  const firstError =
    sessionsResult.error ||
    templatesResult.error ||
    tasksResult.error ||
    mappingsResult.error ||
    confirmationsResult.error ||
    importsResult.error ||
    logsResult.error
  if (firstError) throw firstError

  const sessions = (sessionsResult.data ?? []) as any[]
  const sessionIds = sessions.map((row) => String(row.id))

  let assignments: any[] = []
  let qrRows: any[] = []
  let trainingLogs: any[] = []

  if (sessionIds.length > 0) {
    const [assignmentsResult, qrResult, trainingLogsResult] = await Promise.all([
      admin
        .from('schedule_session_coach_assignments')
        .select('id,training_session_id,staff_user_id,assignment_role,staff_name_snapshot,staff_profile_role_snapshot,is_active')
        .in('training_session_id', sessionIds)
        .eq('is_active', true),
      admin
        .from('coach_staff_attendance')
        .select('id,staff_user_id,training_session_id,session_match_status,checked_in_at,assignment_role_snapshot')
        .in('training_session_id', sessionIds)
        .eq('session_match_status', 'matched'),
      admin
        .from('coach_training_session_logs')
        .select('id,training_session_id,coach_user_id,status,completed_at')
        .in('training_session_id', sessionIds)
        .eq('status', 'completed'),
    ])

    const evidenceError = assignmentsResult.error || qrResult.error || trainingLogsResult.error
    if (evidenceError) throw evidenceError
    assignments = assignmentsResult.data ?? []
    qrRows = qrResult.data ?? []
    trainingLogs = trainingLogsResult.data ?? []
  }

  const templates = (templatesResult.data ?? []) as any[]
  const tasks = (tasksResult.data ?? []) as any[]
  const mappings = (mappingsResult.data ?? []) as any[]
  const confirmations = (confirmationsResult.data ?? []) as any[]
  const imports = (importsResult.data ?? []) as any[]
  const monthlyLogs = (logsResult.data ?? []) as any[]

  const sessionMap = new Map(sessions.map((row) => [String(row.id), row]))
  const mappingMap = new Map(
    mappings.filter((row) => row.is_active).map((row) => [String(row.class_template_id), row])
  )
  const taskMap = new Map(tasks.map((row) => [String(row.id), row]))
  const qrKeys = new Set(
    qrRows.map((row) => `${String(row.training_session_id)}:${String(row.staff_user_id)}`)
  )
  const logKeys = new Set(
    trainingLogs.map((row) => `${String(row.training_session_id)}:${String(row.coach_user_id)}`)
  )
  const activeConfirmations = new Map(
    confirmations
      .filter((row) => !row.revoked_at)
      .map((row) => [`${String(row.training_session_id)}:${String(row.staff_user_id)}`, row])
  )
  const activeImports = new Map(
    imports
      .filter((row) => row.status === 'active')
      .map((row) => [`${String(row.training_session_id)}:${String(row.staff_user_id)}`, row])
  )
  const monthlyLogMap = new Map(
    monthlyLogs.map((row) => [`${String(row.staff_user_id)}:${String(row.task_id)}`, row])
  )

  const candidates = assignments
    .map((assignment) => {
      const session = sessionMap.get(String(assignment.training_session_id))
      if (!session) return null

      const key = `${String(session.id)}:${String(assignment.staff_user_id)}`
      const mapping = mappingMap.get(String(session.class_template_id)) ?? null
      const task = mapping ? taskMap.get(String(mapping.payroll_task_id)) ?? null : null
      const hasQr = qrKeys.has(key)
      const hasLog = logKeys.has(key)
      const confirmation = activeConfirmations.get(key) ?? null
      const imported = activeImports.get(key) ?? null

      let evidenceType: string | null = null
      if (hasQr && hasLog) evidenceType = 'qr_and_completed_log'
      else if (hasQr) evidenceType = 'qr'
      else if (hasLog) evidenceType = 'completed_log'
      else if (confirmation) evidenceType = 'manual_confirmation'

      const scheduledDuration = timeDurationHours(session.start_time, session.end_time)
      const defaultDuration = mapping?.default_duration_hours == null
        ? null
        : Number(mapping.default_duration_hours)
      const durationHours = scheduledDuration ?? defaultDuration
      const durationSource = scheduledDuration != null
        ? 'session_end'
        : defaultDuration != null
          ? 'mapping_default'
          : null

      const existingMonthlyLog = task
        ? monthlyLogMap.get(`${String(assignment.staff_user_id)}:${String(task.id)}`) ?? null
        : null
      const conflict = Boolean(existingMonthlyLog && existingMonthlyLog.source !== 'schedule')

      let status = 'ready'
      if (imported) status = 'imported'
      else if (!mapping || !task) status = 'needs_mapping'
      else if (!evidenceType) status = 'needs_confirmation'
      else if (durationHours == null) status = 'missing_duration'
      else if (conflict) status = 'manual_conflict'

      return {
        key,
        session_id: String(session.id),
        class_template_id: String(session.class_template_id),
        session_date: String(session.session_date),
        start_time: String(session.start_time),
        end_time: session.end_time ? String(session.end_time) : null,
        session_name: String(session.name_snapshot),
        mat: session.mat_snapshot ? String(session.mat_snapshot) : null,
        activity_type: String(session.activity_type_snapshot ?? ''),
        uniform: String(session.uniform_snapshot ?? ''),
        level: String(session.level_snapshot ?? ''),
        staff_user_id: String(assignment.staff_user_id),
        staff_name: String(assignment.staff_name_snapshot),
        staff_role: String(assignment.staff_profile_role_snapshot),
        assignment_role: String(assignment.assignment_role),
        payroll_task_id: task ? String(task.id) : imported ? String(imported.payroll_task_id) : null,
        payroll_task_name: task ? String(task.name) : imported?.task_name_snapshot ? String(imported.task_name_snapshot) : null,
        evidence_type: evidenceType,
        has_qr: hasQr,
        has_completed_log: hasLog,
        manual_confirmation: confirmation
          ? {
              id: String(confirmation.id),
              reason: String(confirmation.reason),
              confirmed_at: String(confirmation.confirmed_at),
            }
          : null,
        duration_hours: durationHours,
        duration_source: durationSource,
        status,
        imported: imported
          ? {
              id: String(imported.id),
              evidence_type: String(imported.evidence_type),
              duration_hours: Number(imported.duration_hours),
              duration_source: String(imported.duration_source),
              imported_at: String(imported.imported_at),
              monthly_task_log_id: String(imported.monthly_task_log_id),
            }
          : null,
        existing_monthly_log: existingMonthlyLog
          ? {
              id: String(existingMonthlyLog.id),
              source: String(existingMonthlyLog.source),
              task_name: String(existingMonthlyLog.task_name_snapshot),
              quantity: Number(existingMonthlyLog.work_quantity ?? 0),
              actual_hours: existingMonthlyLog.actual_hours == null
                ? null
                : Number(existingMonthlyLog.actual_hours),
            }
          : null,
      }
    })
    .filter(Boolean)

  const templateIdsInMonth = new Set(sessions.map((row) => String(row.class_template_id)))
  const templateRows = templates
    .filter((row) => row.is_active || templateIdsInMonth.has(String(row.id)))
    .map((row) => {
      const mapping = mappings.find((item) => String(item.class_template_id) === String(row.id)) ?? null
      return {
        id: String(row.id),
        series_key: String(row.series_key),
        name: String(row.name),
        day_of_week: Number(row.day_of_week),
        start_time: String(row.start_time),
        end_time: row.end_time ? String(row.end_time) : null,
        mat: row.mat ? String(row.mat) : null,
        is_active: Boolean(row.is_active),
        audience: String(row.audience ?? ''),
        level: String(row.level ?? ''),
        activity_type: String(row.activity_type ?? ''),
        uniform: String(row.uniform ?? ''),
        occurs_in_month: templateIdsInMonth.has(String(row.id)),
        mapping: mapping
          ? {
              id: String(mapping.id),
              payroll_task_id: String(mapping.payroll_task_id),
              default_duration_hours: mapping.default_duration_hours == null
                ? null
                : Number(mapping.default_duration_hours),
              is_active: Boolean(mapping.is_active),
              updated_at: String(mapping.updated_at),
            }
          : null,
      }
    })

  const summary = candidates.reduce(
    (acc: Record<string, number>, candidate: any) => {
      acc.total += 1
      acc[candidate.status] = (acc[candidate.status] ?? 0) + 1
      return acc
    },
    {
      total: 0,
      ready: 0,
      imported: 0,
      needs_mapping: 0,
      needs_confirmation: 0,
      missing_duration: 0,
      manual_conflict: 0,
    }
  )

  return {
    month_start: monthStart,
    month_locked: lock.locked,
    lock_version: lock.versionNo,
    approved_at: lock.approvedAt,
    templates: templateRows,
    tasks: tasks.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      importance_level: String(row.importance_level ?? 'standard'),
      importance_multiplier: Number(row.importance_multiplier ?? 1),
    })),
    candidates,
    imports: imports.map((row) => ({
      id: String(row.id),
      training_session_id: String(row.training_session_id),
      staff_user_id: String(row.staff_user_id),
      payroll_task_id: String(row.payroll_task_id),
      evidence_type: String(row.evidence_type),
      duration_hours: Number(row.duration_hours),
      duration_source: String(row.duration_source),
      status: String(row.status),
      imported_at: String(row.imported_at),
      release_reason: row.release_reason ? String(row.release_reason) : null,
    })),
    summary,
  }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })
    if (actor.role !== 'admin' && actor.role !== 'super_admin') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const url = new URL(req.url)
    const monthStart = normalizeMonthStart(url.searchParams.get('month'))
    if (!monthStart) return json(400, { ok: false, error: 'INVALID_MONTH' })
    if (monthStart > currentCairoMonthStart()) {
      return json(400, { ok: false, error: 'FUTURE_MONTH_NOT_ALLOWED' })
    }

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const model = await buildMonthModel(admin, monthStart)
    return json(200, { ok: true, ...model })
  } catch (error: any) {
    const message = error?.message ?? String(error)
    if (message.toLowerCase().includes('staff_payroll_coaching_') || message.toLowerCase().includes('does not exist')) {
      return json(500, {
        ok: false,
        error: 'MIGRATION_REQUIRED',
        details: 'Apply Staff Payroll 1G migration, then try again.',
      })
    }
    return json(500, { ok: false, error: 'SERVER_ERROR', details: message })
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })
    if (actor.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const body = await req.json().catch(() => ({} as any))
    const action = cleanString(body?.action, 60)

    if (action === 'save_mapping') {
      const classTemplateId = normalizeUuid(body?.classTemplateId)
      const payrollTaskId = normalizeUuid(body?.payrollTaskId)
      const durationRaw = body?.defaultDurationHours
      const defaultDurationHours = durationRaw === null || durationRaw === undefined || durationRaw === ''
        ? null
        : parsePositiveHours(durationRaw)

      if (!classTemplateId) return json(400, { ok: false, error: 'INVALID_CLASS_TEMPLATE' })
      if (!payrollTaskId) return json(400, { ok: false, error: 'INVALID_PAYROLL_TASK' })
      if (durationRaw !== null && durationRaw !== undefined && durationRaw !== '' && defaultDurationHours === null) {
        return json(400, { ok: false, error: 'INVALID_DEFAULT_DURATION' })
      }

      const [{ data: template, error: templateErr }, { data: task, error: taskErr }] = await Promise.all([
        admin.from('schedule_class_templates').select('id,name').eq('id', classTemplateId).maybeSingle(),
        admin.from('staff_tasks').select('id,name,unit,is_active').eq('id', payrollTaskId).maybeSingle(),
      ])
      if (templateErr || !template?.id) return json(404, { ok: false, error: 'CLASS_TEMPLATE_NOT_FOUND' })
      if (taskErr || !task?.id) return json(404, { ok: false, error: 'PAYROLL_TASK_NOT_FOUND' })
      if (!task.is_active || task.unit !== 'class') {
        return json(409, { ok: false, error: 'PAYROLL_TASK_NOT_ELIGIBLE' })
      }

      const { data: existingMapping, error: mappingLookupError } = await admin
        .from('staff_payroll_coaching_template_mappings')
        .select('id')
        .eq('class_template_id', classTemplateId)
        .maybeSingle()
      if (mappingLookupError) {
        return json(500, { ok: false, error: 'MAPPING_LOOKUP_FAILED', details: mappingLookupError.message })
      }

      const mappingMutation = existingMapping?.id
        ? admin
            .from('staff_payroll_coaching_template_mappings')
            .update({
              payroll_task_id: payrollTaskId,
              default_duration_hours: defaultDurationHours,
              is_active: true,
              updated_by: actor.actorId,
            })
            .eq('id', existingMapping.id)
        : admin
            .from('staff_payroll_coaching_template_mappings')
            .insert({
              class_template_id: classTemplateId,
              payroll_task_id: payrollTaskId,
              default_duration_hours: defaultDurationHours,
              is_active: true,
              created_by: actor.actorId,
              updated_by: actor.actorId,
            })

      const { data: saved, error } = await mappingMutation
        .select('id,class_template_id,payroll_task_id,default_duration_hours,is_active,updated_at')
        .maybeSingle()

      if (error) return json(500, { ok: false, error: 'MAPPING_SAVE_FAILED', details: error.message })

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        action: 'staff_payroll_coaching_mapping_saved',
        action_details: {
          class_template_id: classTemplateId,
          class_template_name: template.name,
          payroll_task_id: payrollTaskId,
          payroll_task_name: task.name,
          default_duration_hours: defaultDurationHours,
        },
      })
      revalidatePath('/admin/staff-payroll/coaching-import')
      return json(200, { ok: true, mapping: saved })
    }

    if (action === 'disable_mapping') {
      const classTemplateId = normalizeUuid(body?.classTemplateId)
      if (!classTemplateId) return json(400, { ok: false, error: 'INVALID_CLASS_TEMPLATE' })
      const { error } = await admin
        .from('staff_payroll_coaching_template_mappings')
        .update({ is_active: false, updated_by: actor.actorId })
        .eq('class_template_id', classTemplateId)
      if (error) return json(500, { ok: false, error: 'MAPPING_DISABLE_FAILED', details: error.message })
      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        action: 'staff_payroll_coaching_mapping_disabled',
        action_details: { class_template_id: classTemplateId },
      })
      revalidatePath('/admin/staff-payroll/coaching-import')
      return json(200, { ok: true })
    }

    if (action === 'confirm' || action === 'revoke_confirmation') {
      const monthStart = normalizeMonthStart(body?.monthStart)
      const sessionId = normalizeUuid(body?.sessionId)
      const staffUserId = normalizeUuid(body?.staffUserId)
      const reason = cleanString(body?.reason, 500)
      if (!monthStart) return json(400, { ok: false, error: 'INVALID_MONTH' })
      if (!sessionId || !staffUserId) return json(400, { ok: false, error: 'INVALID_CONFIRMATION_TARGET' })
      if (reason.length < 3) return json(400, { ok: false, error: 'CONFIRMATION_REASON_REQUIRED' })
      if (monthStart > currentCairoMonthStart()) return json(400, { ok: false, error: 'FUTURE_MONTH_NOT_ALLOWED' })

      const lock = await monthLocked(admin, monthStart)
      if (lock.locked) return json(409, { ok: false, error: 'PAYROLL_MONTH_LOCKED' })

      if (action === 'confirm') {
        const monthEnd = nextMonthStart(monthStart)
        const [{ data: session }, { data: assignment }, { data: imported }] = await Promise.all([
          admin
            .from('schedule_training_sessions')
            .select('id,session_date,status,name_snapshot')
            .eq('id', sessionId)
            .gte('session_date', monthStart)
            .lt('session_date', monthEnd)
            .neq('status', 'cancelled')
            .maybeSingle(),
          admin
            .from('schedule_session_coach_assignments')
            .select('id,staff_name_snapshot')
            .eq('training_session_id', sessionId)
            .eq('staff_user_id', staffUserId)
            .eq('is_active', true)
            .maybeSingle(),
          admin
            .from('staff_payroll_coaching_import_items')
            .select('id')
            .eq('training_session_id', sessionId)
            .eq('staff_user_id', staffUserId)
            .eq('status', 'active')
            .maybeSingle(),
        ])
        if (!session?.id) return json(404, { ok: false, error: 'SESSION_NOT_ELIGIBLE' })
        if (!assignment?.id) return json(409, { ok: false, error: 'ACTIVE_ASSIGNMENT_REQUIRED' })
        if (imported?.id) return json(409, { ok: false, error: 'COACHING_SESSION_ALREADY_IMPORTED' })

        const { data: existing } = await admin
          .from('staff_payroll_coaching_confirmations')
          .select('id')
          .eq('training_session_id', sessionId)
          .eq('staff_user_id', staffUserId)
          .is('revoked_at', null)
          .maybeSingle()
        if (existing?.id) return json(409, { ok: false, error: 'ALREADY_CONFIRMED' })

        const { data: inserted, error } = await admin
          .from('staff_payroll_coaching_confirmations')
          .insert({
            month_start: monthStart,
            training_session_id: sessionId,
            staff_user_id: staffUserId,
            reason,
            confirmed_by: actor.actorId,
          })
          .select('id,confirmed_at')
          .maybeSingle()
        if (error) return json(500, { ok: false, error: 'CONFIRMATION_FAILED', details: error.message })

        await safeAudit(admin, {
          actor_user_id: actor.actorId,
          target_user_id: staffUserId,
          action: 'staff_payroll_coaching_manually_confirmed',
          action_details: {
            confirmation_id: inserted?.id ?? null,
            month_start: monthStart,
            training_session_id: sessionId,
            session_name: session.name_snapshot,
            staff_name: assignment.staff_name_snapshot,
            reason,
          },
        })
        return json(200, { ok: true, confirmation: inserted })
      }

      const { data: confirmation, error: lookupError } = await admin
        .from('staff_payroll_coaching_confirmations')
        .select('id,reason')
        .eq('month_start', monthStart)
        .eq('training_session_id', sessionId)
        .eq('staff_user_id', staffUserId)
        .is('revoked_at', null)
        .maybeSingle()
      if (lookupError) return json(500, { ok: false, error: 'CONFIRMATION_LOOKUP_FAILED', details: lookupError.message })
      if (!confirmation?.id) return json(404, { ok: false, error: 'CONFIRMATION_NOT_FOUND' })

      const { error } = await admin
        .from('staff_payroll_coaching_confirmations')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: actor.actorId,
          revoke_reason: reason,
        })
        .eq('id', confirmation.id)
        .is('revoked_at', null)
      if (error) return json(500, { ok: false, error: 'CONFIRMATION_REVOKE_FAILED', details: error.message })

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: staffUserId,
        action: 'staff_payroll_coaching_confirmation_revoked',
        action_details: {
          confirmation_id: confirmation.id,
          month_start: monthStart,
          training_session_id: sessionId,
          revoke_reason: reason,
        },
      })
      return json(200, { ok: true })
    }

    if (action === 'import') {
      const monthStart = normalizeMonthStart(body?.monthStart)
      if (!monthStart) return json(400, { ok: false, error: 'INVALID_MONTH' })
      if (monthStart > currentCairoMonthStart()) return json(400, { ok: false, error: 'FUTURE_MONTH_NOT_ALLOWED' })
      if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 500) {
        return json(400, { ok: false, error: 'INVALID_IMPORT_ITEMS' })
      }

      const items = body.items.map((item: any) => ({
        session_id: normalizeUuid(item?.sessionId),
        staff_user_id: normalizeUuid(item?.staffUserId),
        duration_hours: parsePositiveHours(item?.durationHours),
      }))
      if (items.some((item: any) => !item.session_id || !item.staff_user_id || item.duration_hours == null)) {
        return json(400, { ok: false, error: 'INVALID_IMPORT_ITEMS' })
      }

      const { data, error } = await (actor.supabase as any).rpc(
        'staff_payroll_import_coaching_sessions',
        { p_month_start: monthStart, p_items: items }
      )
      if (error) {
        const message = error.message ?? String(error)
        const known = [
          'STAFF_PAYROLL_MONTH_LOCKED',
          'PAYROLL_MAPPING_REQUIRED',
          'COACHING_EVIDENCE_REQUIRED',
          'COACHING_SESSION_ALREADY_IMPORTED',
          'MANUAL_MONTHLY_TASK_CONFLICT',
          'ACTIVE_ASSIGNMENT_REQUIRED',
          'SESSION_NOT_ELIGIBLE',
        ].find((code) => message.includes(code))
        return json(known ? 409 : 500, {
          ok: false,
          error: known ?? 'COACHING_IMPORT_FAILED',
          details: message,
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        action: 'staff_payroll_coaching_sessions_imported',
        action_details: {
          month_start: monthStart,
          requested_count: items.length,
          imported_count: Number(data?.imported_count ?? items.length),
          monthly_task_log_ids: data?.monthly_task_log_ids ?? [],
          note_scope: 'Confirmed coaching sessions aggregated into schedule-sourced Monthly Tasks.',
        },
      })
      revalidatePath('/admin/staff-payroll/coaching-import')
      revalidatePath('/admin/staff-payroll/monthly-tasks')
      revalidatePath('/admin/staff-payroll/calculation')
      return json(200, { ok: true, result: data })
    }

    return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (error: any) {
    const message = error?.message ?? String(error)
    if (message.toLowerCase().includes('staff_payroll_coaching_') || message.toLowerCase().includes('does not exist')) {
      return json(500, {
        ok: false,
        error: 'MIGRATION_REQUIRED',
        details: 'Apply Staff Payroll 1G migration, then try again.',
      })
    }
    return json(500, { ok: false, error: 'SERVER_ERROR', details: message })
  }
}
