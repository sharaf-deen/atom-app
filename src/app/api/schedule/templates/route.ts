export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageScheduleClassTemplates } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Audience = 'kids_teens' | 'adults' | 'all'
type ActivityType = 'jiu_jitsu' | 'competition' | 'open_drills' | 'open_mat' | 'physical_preparation' | 'wrestling' | 'other'
type Uniform = 'gi' | 'nogi' | 'gi_nogi' | 'none'
type Operation = 'save' | 'set_active'

type Body = {
  operation?: Operation
  id?: string
  name?: string
  audience?: Audience
  ageMin?: number | string | null
  ageMax?: number | string | null
  level?: string
  activityType?: ActivityType
  uniform?: Uniform
  dayOfWeek?: number | string
  startTime?: string
  endTime?: string | null
  mat?: string | null
  notes?: string | null
  effectiveFrom?: string
  effectiveUntil?: string | null
  active?: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const AUDIENCES: Audience[] = ['kids_teens', 'adults', 'all']
const ACTIVITIES: ActivityType[] = ['jiu_jitsu', 'competition', 'open_drills', 'open_mat', 'physical_preparation', 'wrestling', 'other']
const UNIFORMS: Uniform[] = ['gi', 'nogi', 'gi_nogi', 'none']

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function cleanText(value: unknown, max: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanLongText(value: unknown, max: number) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim()
  return text ? text.slice(0, max) : null
}

function nullableText(value: unknown, max: number) {
  const text = cleanText(value, max)
  return text || null
}

function normalizeTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
  if (!match) return null
  const normalized = `${match[1]}:${match[2]}`
  return TIME_RE.test(normalized) ? normalized : null
}

function nullableInteger(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

function slugify(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return normalized || 'class-template'
}

function sortOrder(dayOfWeek: number, startTime: string) {
  const [hours, minutes] = startTime.split(':').map(Number)
  return dayOfWeek * 10000 + hours * 100 + minutes
}

function dbFailure(error: any, fallback: string) {
  if (error?.code === '23505') {
    return json(
      {
        ok: false,
        error: 'DUPLICATE_TEMPLATE',
        details: 'An active template for this class, day, time and mat already exists.',
      },
      409,
    )
  }
  return json({ ok: false, error: fallback, details: String(error?.message || error || fallback) }, 500)
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageScheduleClassTemplates(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const operation = body.operation
  if (!operation || !['save', 'set_active'].includes(operation)) {
    return json({ ok: false, error: 'INVALID_OPERATION' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const now = new Date().toISOString()

  if (operation === 'set_active') {
    const id = String(body.id ?? '').trim()
    if (!UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)
    if (typeof body.active !== 'boolean') return json({ ok: false, error: 'INVALID_ACTIVE_STATE' }, 400)

    const { data, error } = await supabase
      .from('schedule_class_templates')
      .update({ is_active: body.active, updated_by: me.id, updated_at: now })
      .eq('id', id)
      .select('id,is_active')
      .maybeSingle()

    if (error) return dbFailure(error, 'STATUS_UPDATE_FAILED')
    if (!data) return json({ ok: false, error: 'NOT_FOUND' }, 404)

    revalidatePath('/schedule/templates')
    return json({ ok: true, template: data })
  }

  const id = String(body.id ?? '').trim()
  if (id && !UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)

  const name = cleanText(body.name, 180)
  const audience = body.audience
  const ageMin = nullableInteger(body.ageMin)
  const ageMax = nullableInteger(body.ageMax)
  const level = cleanText(body.level, 100)
  const activityType = body.activityType
  const uniform = body.uniform
  const dayOfWeek = Number(body.dayOfWeek)
  const startTime = normalizeTime(body.startTime)
  const endTimeRaw = String(body.endTime ?? '').trim()
  const endTime = endTimeRaw ? normalizeTime(endTimeRaw) : null
  const mat = nullableText(body.mat, 80)
  const notes = cleanLongText(body.notes, 2000)
  const effectiveFrom = String(body.effectiveFrom ?? '').trim()
  const effectiveUntilRaw = String(body.effectiveUntil ?? '').trim()
  const effectiveUntil = effectiveUntilRaw || null

  if (name.length < 2) return json({ ok: false, error: 'INVALID_NAME' }, 400)
  if (!audience || !AUDIENCES.includes(audience)) return json({ ok: false, error: 'INVALID_AUDIENCE' }, 400)
  if (!level || level.length < 2) return json({ ok: false, error: 'INVALID_LEVEL' }, 400)
  if (!activityType || !ACTIVITIES.includes(activityType)) return json({ ok: false, error: 'INVALID_ACTIVITY' }, 400)
  if (!uniform || !UNIFORMS.includes(uniform)) return json({ ok: false, error: 'INVALID_UNIFORM' }, 400)
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return json({ ok: false, error: 'INVALID_DAY' }, 400)
  if (!startTime) return json({ ok: false, error: 'INVALID_START_TIME' }, 400)
  if (endTimeRaw && !endTime) return json({ ok: false, error: 'INVALID_END_TIME' }, 400)
  if (endTime && endTime <= startTime) return json({ ok: false, error: 'INVALID_TIME_RANGE' }, 400)
  if (!DATE_RE.test(effectiveFrom)) return json({ ok: false, error: 'INVALID_EFFECTIVE_FROM' }, 400)
  if (effectiveUntil && !DATE_RE.test(effectiveUntil)) return json({ ok: false, error: 'INVALID_EFFECTIVE_UNTIL' }, 400)
  if (effectiveUntil && effectiveUntil < effectiveFrom) return json({ ok: false, error: 'INVALID_EFFECTIVE_RANGE' }, 400)

  if ((typeof ageMin === 'number' && Number.isNaN(ageMin)) || (typeof ageMax === 'number' && Number.isNaN(ageMax))) {
    return json({ ok: false, error: 'INVALID_AGE_RANGE' }, 400)
  }
  const hasAgeMin = Number.isInteger(ageMin)
  const hasAgeMax = Number.isInteger(ageMax)
  if (hasAgeMin !== hasAgeMax) return json({ ok: false, error: 'INVALID_AGE_RANGE' }, 400)
  if (hasAgeMin && hasAgeMax) {
    if ((ageMin as number) < 0 || (ageMax as number) > 99 || (ageMax as number) < (ageMin as number)) {
      return json({ ok: false, error: 'INVALID_AGE_RANGE' }, 400)
    }
  }

  let seriesKey = slugify(name)
  if (id) {
    const { data: existing, error: existingError } = await supabase
      .from('schedule_class_templates')
      .select('series_key')
      .eq('id', id)
      .maybeSingle()

    if (existingError) return dbFailure(existingError, 'LOAD_TEMPLATE_FAILED')
    if (!existing) return json({ ok: false, error: 'NOT_FOUND' }, 404)
    seriesKey = String(existing.series_key)
  }

  const payload = {
    series_key: seriesKey,
    name,
    audience,
    age_min: hasAgeMin ? ageMin : null,
    age_max: hasAgeMax ? ageMax : null,
    level,
    activity_type: activityType,
    uniform,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
    mat,
    notes,
    sort_order: sortOrder(dayOfWeek, startTime),
    effective_from: effectiveFrom,
    effective_until: effectiveUntil,
    updated_by: me.id,
    updated_at: now,
  }

  if (id) {
    const { data, error } = await supabase
      .from('schedule_class_templates')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) return dbFailure(error, 'UPDATE_FAILED')
    if (!data) return json({ ok: false, error: 'NOT_FOUND' }, 404)

    revalidatePath('/schedule/templates')
    return json({ ok: true, template: data })
  }

  const { data, error } = await supabase
    .from('schedule_class_templates')
    .insert({ ...payload, created_by: me.id })
    .select('*')
    .single()

  if (error) return dbFailure(error, 'CREATE_FAILED')

  revalidatePath('/schedule/templates')
  return json({ ok: true, template: data })
}
