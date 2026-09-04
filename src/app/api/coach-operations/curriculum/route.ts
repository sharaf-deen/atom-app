export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageCoachCurriculum } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Entity = 'type' | 'block' | 'technique' | 'situation'
type Operation = 'create' | 'update' | 'set_active'

type Body = {
  operation?: Operation
  entity?: Entity
  id?: string
  parentId?: string
  name?: string
  description?: string | null
  opponentReaction?: string | null
  coachingResponse?: string | null
  sortOrder?: number | string | null
  isActive?: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function normalizeName(value: unknown, maxLength: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function normalizeLongText(value: unknown, maxLength: number) {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function normalizeSortOrder(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 100
  return Math.max(0, Math.min(10000, parsed))
}

function slugify(value: string) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110)
  return slug || `type-${Date.now()}`
}

function tableFor(entity: Entity) {
  switch (entity) {
    case 'type':
      return 'coach_curriculum_types'
    case 'block':
      return 'coach_curriculum_blocks'
    case 'technique':
      return 'coach_curriculum_techniques'
    case 'situation':
      return 'coach_curriculum_situations'
  }
}

function parentColumnFor(entity: Entity) {
  switch (entity) {
    case 'block':
      return 'type_id'
    case 'technique':
      return 'block_id'
    case 'situation':
      return 'technique_id'
    default:
      return null
  }
}

function entityNameLimit(entity: Entity) {
  if (entity === 'type') return 100
  if (entity === 'block') return 140
  if (entity === 'technique') return 160
  return 180
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageCoachCurriculum(me.role)) {
    return json({ ok: false, error: 'FORBIDDEN' }, 403)
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const operation = body.operation
  const entity = body.entity
  if (!operation || !['create', 'update', 'set_active'].includes(operation)) {
    return json({ ok: false, error: 'INVALID_OPERATION' }, 400)
  }
  if (!entity || !['type', 'block', 'technique', 'situation'].includes(entity)) {
    return json({ ok: false, error: 'INVALID_ENTITY' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const table = tableFor(entity)
  const now = new Date().toISOString()

  if (operation === 'create') {
    const name = normalizeName(body.name, entityNameLimit(entity))
    if (name.length < 2) return json({ ok: false, error: 'INVALID_NAME' }, 400)

    const row: Record<string, unknown> = {
      name,
      sort_order: normalizeSortOrder(body.sortOrder),
      is_active: true,
      created_by: me.id,
      updated_by: me.id,
      updated_at: now,
    }

    if (entity === 'type') {
      row.slug = slugify(name)
      row.description = normalizeLongText(body.description, 1000)
    } else {
      const parentColumn = parentColumnFor(entity)
      const parentId = String(body.parentId ?? '').trim()
      if (!parentColumn || !UUID_RE.test(parentId)) {
        return json({ ok: false, error: 'INVALID_PARENT_ID' }, 400)
      }
      row[parentColumn] = parentId

      if (entity === 'block' || entity === 'technique') {
        row.description = normalizeLongText(body.description, 1500)
      } else {
        const opponentReaction = normalizeLongText(body.opponentReaction, 1000)
        if (!opponentReaction || opponentReaction.length < 2) {
          return json({ ok: false, error: 'OPPONENT_REACTION_REQUIRED' }, 400)
        }
        row.opponent_reaction = opponentReaction
        row.coaching_response = normalizeLongText(body.coachingResponse, 1500)
      }
    }

    const { data, error } = await supabase.from(table).insert(row).select('*').single()
    if (error) {
      const status = error.code === '23505' ? 409 : error.code === '23503' ? 400 : 500
      const apiError = error.code === '23505' ? 'DUPLICATE_NAME' : error.code === '23503' ? 'INVALID_PARENT' : 'CREATE_FAILED'
      return json({ ok: false, error: apiError, details: error.message }, status)
    }

    revalidatePath('/coach-operations/curriculum')
    return json({ ok: true, item: data })
  }

  const id = String(body.id ?? '').trim()
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)

  if (operation === 'set_active') {
    if (typeof body.isActive !== 'boolean') {
      return json({ ok: false, error: 'INVALID_ACTIVE_STATE' }, 400)
    }
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: body.isActive, updated_by: me.id, updated_at: now })
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) return json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, 500)
    if (!data) return json({ ok: false, error: 'NOT_FOUND' }, 404)

    revalidatePath('/coach-operations/curriculum')
    return json({ ok: true, item: data })
  }

  const name = normalizeName(body.name, entityNameLimit(entity))
  if (name.length < 2) return json({ ok: false, error: 'INVALID_NAME' }, 400)

  const patch: Record<string, unknown> = {
    name,
    sort_order: normalizeSortOrder(body.sortOrder),
    updated_by: me.id,
    updated_at: now,
  }

  if (entity === 'type' || entity === 'block' || entity === 'technique') {
    patch.description = normalizeLongText(body.description, entity === 'type' ? 1000 : 1500)
  } else {
    const opponentReaction = normalizeLongText(body.opponentReaction, 1000)
    if (!opponentReaction || opponentReaction.length < 2) {
      return json({ ok: false, error: 'OPPONENT_REACTION_REQUIRED' }, 400)
    }
    patch.opponent_reaction = opponentReaction
    patch.coaching_response = normalizeLongText(body.coachingResponse, 1500)
  }

  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select('*').maybeSingle()
  if (error) {
    const status = error.code === '23505' ? 409 : 500
    return json(
      { ok: false, error: error.code === '23505' ? 'DUPLICATE_NAME' : 'UPDATE_FAILED', details: error.message },
      status,
    )
  }
  if (!data) return json({ ok: false, error: 'NOT_FOUND' }, 404)

  revalidatePath('/coach-operations/curriculum')
  return json({ ok: true, item: data })
}
