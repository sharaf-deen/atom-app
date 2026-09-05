export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageScheduleTrainingSessions } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Operation = 'sync'

type Body = {
  operation?: Operation
  fromDate?: string
  toDate?: string
}

type ClassTemplate = {
  id: string
  series_key: string
  name: string
  audience: 'kids_teens' | 'adults' | 'all'
  age_min: number | null
  age_max: number | null
  level: string
  activity_type:
    | 'jiu_jitsu'
    | 'competition'
    | 'open_drills'
    | 'open_mat'
    | 'physical_preparation'
    | 'wrestling'
    | 'other'
  uniform: 'gi' | 'nogi' | 'gi_nogi' | 'none'
  day_of_week: number
  start_time: string
  end_time: string | null
  mat: string | null
  notes: string | null
  effective_from: string
  effective_until: string | null
}

type ExistingSession = {
  id: string
  class_template_id: string
  session_date: string
  status: 'scheduled' | 'completed' | 'cancelled'
  template_managed: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SYNC_DAYS = 120
const CHUNK_SIZE = 250

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function cairoDateIso() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dateToUtc(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function dateIso(value: Date) {
  return value.toISOString().slice(0, 10)
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86400000)
}

function inclusiveDayCount(fromDate: string, toDate: string) {
  return Math.floor((dateToUtc(toDate).getTime() - dateToUtc(fromDate).getTime()) / 86400000) + 1
}

function normalizeTime(value: string | null) {
  if (!value) return null
  const match = String(value).match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : value
}

function sessionKey(templateId: string, sessionDate: string) {
  return `${templateId}|${sessionDate}`
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function desiredRow(template: ClassTemplate, sessionDate: string, now: string) {
  return {
    class_template_id: template.id,
    session_date: sessionDate,
    start_time: normalizeTime(template.start_time) ?? template.start_time,
    end_time: normalizeTime(template.end_time),
    series_key_snapshot: template.series_key,
    name_snapshot: template.name,
    audience_snapshot: template.audience,
    age_min_snapshot: template.age_min,
    age_max_snapshot: template.age_max,
    level_snapshot: template.level,
    activity_type_snapshot: template.activity_type,
    uniform_snapshot: template.uniform,
    mat_snapshot: template.mat,
    notes_snapshot: template.notes,
    status: 'scheduled' as const,
    template_managed: true,
    synced_at: now,
    updated_at: now,
  }
}

function dbFailure(error: any, fallback: string) {
  return json({ ok: false, error: fallback, details: String(error?.message || error || fallback) }, 500)
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

  if (body.operation !== 'sync') return json({ ok: false, error: 'INVALID_OPERATION' }, 400)

  const fromDate = String(body.fromDate ?? '').trim()
  const toDate = String(body.toDate ?? '').trim()
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return json({ ok: false, error: 'INVALID_DATE_RANGE' }, 400)
  if (toDate < fromDate) return json({ ok: false, error: 'INVALID_DATE_RANGE' }, 400)

  const today = cairoDateIso()
  if (fromDate < today) {
    return json(
      {
        ok: false,
        error: 'PAST_RANGE_NOT_ALLOWED',
        details: `Session synchronization starts from today (${today}) or later so historical session snapshots are never rewritten.`,
      },
      400,
    )
  }

  const dayCount = inclusiveDayCount(fromDate, toDate)
  if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > MAX_SYNC_DAYS) {
    return json(
      {
        ok: false,
        error: 'RANGE_TOO_LARGE',
        details: `Choose a range of 1 to ${MAX_SYNC_DAYS} days.`,
      },
      400,
    )
  }

  const supabase = createSupabaseServerActionClient()
  const { data: templateData, error: templateError } = await supabase
    .from('schedule_class_templates')
    .select(
      'id,series_key,name,audience,age_min,age_max,level,activity_type,uniform,day_of_week,start_time,end_time,mat,notes,effective_from,effective_until',
    )
    .eq('is_active', true)
    .lte('effective_from', toDate)
    .or(`effective_until.is.null,effective_until.gte.${fromDate}`)

  if (templateError) return dbFailure(templateError, 'LOAD_TEMPLATES_FAILED')

  const templates = (templateData ?? []) as ClassTemplate[]
  const now = new Date().toISOString()
  const desired = new Map<string, ReturnType<typeof desiredRow>>()

  for (const template of templates) {
    const effectiveStart = template.effective_from > fromDate ? template.effective_from : fromDate
    const effectiveEnd =
      template.effective_until && template.effective_until < toDate ? template.effective_until : toDate

    let cursor = dateToUtc(effectiveStart)
    const end = dateToUtc(effectiveEnd)

    while (cursor.getTime() <= end.getTime()) {
      const currentIso = dateIso(cursor)
      if (cursor.getUTCDay() === template.day_of_week) {
        desired.set(sessionKey(template.id, currentIso), desiredRow(template, currentIso, now))
      }
      cursor = addDays(cursor, 1)
    }
  }

  const { data: existingData, error: existingError } = await supabase
    .from('schedule_training_sessions')
    .select('id,class_template_id,session_date,status,template_managed')
    .gte('session_date', fromDate)
    .lte('session_date', toDate)

  if (existingError) return dbFailure(existingError, 'LOAD_EXISTING_SESSIONS_FAILED')

  const existing = (existingData ?? []) as ExistingSession[]
  const existingByKey = new Map(existing.map((row) => [sessionKey(row.class_template_id, row.session_date), row]))

  const insertRows: Array<Record<string, unknown>> = []
  const refreshRows: Array<Record<string, unknown>> = []
  let protectedCount = 0

  for (const [key, row] of desired.entries()) {
    const current = existingByKey.get(key)
    if (!current) {
      insertRows.push({
        ...row,
        generated_by: me.id,
        generated_at: now,
        created_at: now,
      })
      continue
    }

    if (current.status === 'scheduled' && current.template_managed) {
      refreshRows.push(row)
    } else {
      protectedCount += 1
    }
  }

  const staleIds = existing
    .filter(
      (row) =>
        row.status === 'scheduled' &&
        row.template_managed &&
        !desired.has(sessionKey(row.class_template_id, row.session_date)),
    )
    .map((row) => row.id)

  let createdCount = 0
  for (const batch of chunks(insertRows, CHUNK_SIZE)) {
    if (!batch.length) continue
    const { data, error } = await supabase
      .from('schedule_training_sessions')
      .upsert(batch, { onConflict: 'class_template_id,session_date', ignoreDuplicates: true })
      .select('id')

    if (error) return dbFailure(error, 'CREATE_SESSIONS_FAILED')
    createdCount += data?.length ?? 0
  }

  let refreshedCount = 0
  for (const batch of chunks(refreshRows, CHUNK_SIZE)) {
    if (!batch.length) continue
    const { data, error } = await supabase
      .from('schedule_training_sessions')
      .upsert(batch, { onConflict: 'class_template_id,session_date' })
      .select('id')

    if (error) return dbFailure(error, 'REFRESH_SESSIONS_FAILED')
    refreshedCount += data?.length ?? 0
  }

  let removedCount = 0
  for (const batch of chunks(staleIds, CHUNK_SIZE)) {
    if (!batch.length) continue
    const { data, error } = await supabase.from('schedule_training_sessions').delete().in('id', batch).select('id')

    if (error) return dbFailure(error, 'REMOVE_STALE_SESSIONS_FAILED')
    removedCount += data?.length ?? 0
  }

  revalidatePath('/schedule/sessions')

  return json({
    ok: true,
    range: { fromDate, toDate, days: dayCount },
    templates: templates.length,
    desiredSessions: desired.size,
    created: createdCount,
    refreshed: refreshedCount,
    removed: removedCount,
    protected: protectedCount,
  })
}
