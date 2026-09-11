// Staff Payroll 1A — Task Catalog & Compensation Foundation
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type CatalogAction =
  | 'create_area'
  | 'update_area'
  | 'toggle_area'
  | 'create_task'
  | 'update_task'
  | 'toggle_task'

const ACTIONS = new Set<CatalogAction>([
  'create_area',
  'update_area',
  'toggle_area',
  'create_task',
  'update_task',
  'toggle_task',
])

const UNITS = new Set([
  'hour',
  'class',
  'meeting',
  'event',
  'day',
  'task',
  'report',
  'project',
])

const IMPORTANCE = {
  standard: 1.0,
  important: 1.15,
  responsibility: 1.35,
  high_responsibility: 1.6,
  critical: 2.0,
} as const

const ELIGIBLE_STAFF_ROLES = [
  'assistant_coach',
  'coach',
  'head_coach',
  'reception',
  'admin',
  'super_admin',
]

function json(status: number, body: any) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
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
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeUuid(value: unknown) {
  const cleaned = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)
    ? cleaned
    : ''
}

function slugify(value: string) {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)

  return base || 'area'
}

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 168) {
    return Number.NaN
  }

  return Math.round(parsed * 100) / 100
}

function normalizeAssigneeIds(value: unknown) {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .map(normalizeUuid)
        .filter(Boolean)
        .slice(0, 20)
    )
  )
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()

  if (authError || !auth.user) {
    return {
      actorId: '',
      role: '',
      error: authError?.message || 'NOT_AUTHENTICATED',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  return {
    actorId: auth.user.id,
    role: profile?.role ?? 'member',
    error: profileError?.message ?? '',
  }
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // Audit logging must not break catalog maintenance.
  }
}

async function validateArea(admin: any, areaId: string) {
  const { data, error } = await admin
    .from('staff_task_areas')
    .select('id,name,is_active')
    .eq('id', areaId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

async function validateAssignees(admin: any, ids: string[]) {
  if (!ids.length) return []

  const { data, error } = await admin
    .from('profiles')
    .select('user_id,role')
    .in('user_id', ids)
    .in('role', ELIGIBLE_STAFF_ROLES)

  if (error) throw new Error(error.message)

  const validIds = ((data ?? []) as any[])
    .map((row) => String(row.user_id))
    .filter(Boolean)

  if (validIds.length !== ids.length) {
    throw new Error('INVALID_DEFAULT_ASSIGNEE')
  }

  return validIds
}

async function replaceAssignees(
  admin: any,
  taskId: string,
  assigneeIds: string[],
  actorId: string
) {
  const validIds = await validateAssignees(admin, assigneeIds)

  const { error: deleteError } = await admin
    .from('staff_task_default_assignees')
    .delete()
    .eq('task_id', taskId)

  if (deleteError) throw new Error(deleteError.message)

  if (!validIds.length) return

  const { error: insertError } = await admin
    .from('staff_task_default_assignees')
    .insert(
      validIds.map((userId) => ({
        task_id: taskId,
        user_id: userId,
        created_by: actorId,
      }))
    )

  if (insertError) throw new Error(insertError.message)
}

function taskPayload(body: any) {
  const name = cleanString(body?.name, 160)
  const areaId = normalizeUuid(body?.areaId ?? body?.area_id)
  const frequencyLabel = cleanString(
    body?.frequencyLabel ?? body?.frequency_label,
    120
  )
  const estimatedTimeLabel = cleanString(
    body?.estimatedTimeLabel ?? body?.estimated_time_label,
    120
  )
  const minHours = parseNullableNumber(
    body?.estimatedMinHoursPerWeek ?? body?.estimated_min_hours_per_week
  )
  const maxHours = parseNullableNumber(
    body?.estimatedMaxHoursPerWeek ?? body?.estimated_max_hours_per_week
  )
  const unit = cleanString(body?.unit, 40)
  const importanceLevel = cleanString(
    body?.importanceLevel ?? body?.importance_level,
    80
  ) as keyof typeof IMPORTANCE
  const notes = cleanString(body?.notes, 2000)
  const assigneeIds = normalizeAssigneeIds(
    body?.defaultAssigneeIds ?? body?.default_assignee_ids
  )

  if (name.length < 2) {
    return { error: 'TASK_NAME_REQUIRED' as const }
  }
  if (!areaId) {
    return { error: 'AREA_REQUIRED' as const }
  }
  if (!UNITS.has(unit)) {
    return { error: 'INVALID_UNIT' as const }
  }
  if (!(importanceLevel in IMPORTANCE)) {
    return { error: 'INVALID_IMPORTANCE' as const }
  }
  if (Number.isNaN(minHours) || Number.isNaN(maxHours)) {
    return { error: 'INVALID_ESTIMATED_HOURS' as const }
  }
  if (
    minHours !== null &&
    maxHours !== null &&
    maxHours < minHours
  ) {
    return { error: 'INVALID_ESTIMATED_HOURS_RANGE' as const }
  }

  return {
    value: {
      name,
      area_id: areaId,
      frequency_label: frequencyLabel || null,
      estimated_time_label: estimatedTimeLabel || null,
      estimated_min_hours_per_week: minHours,
      estimated_max_hours_per_week: maxHours,
      unit,
      importance_level: importanceLevel,
      importance_multiplier: IMPORTANCE[importanceLevel],
      notes: notes || null,
      assigneeIds,
    },
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()

    if (!actor.actorId) {
      return json(401, {
        ok: false,
        error: 'NOT_AUTHENTICATED',
        details: actor.error,
      })
    }

    if (actor.error) {
      return json(500, {
        ok: false,
        error: 'PROFILE_LOOKUP_FAILED',
        details: actor.error,
      })
    }

    if (actor.role !== 'super_admin') {
      return json(403, {
        ok: false,
        error: 'SUPER_ADMIN_REQUIRED',
      })
    }

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details:
          'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const actionRaw = cleanString(body?.action, 60) as CatalogAction
    const action = ACTIONS.has(actionRaw) ? actionRaw : null

    if (!action) {
      return json(400, {
        ok: false,
        error: 'INVALID_ACTION',
      })
    }

    if (action === 'create_area') {
      const name = cleanString(body?.name, 100)

      if (name.length < 2) {
        return json(400, {
          ok: false,
          error: 'AREA_NAME_REQUIRED',
        })
      }

      const baseSlug = slugify(name)
      let slug = baseSlug

      const { data: slugCollision } = await admin
        .from('staff_task_areas')
        .select('id')
        .eq('slug', slug)
        .maybeSingle()

      if (slugCollision?.id) {
        slug = `${baseSlug}-${Date.now().toString(36).slice(-5)}`
      }

      const { data: area, error } = await admin
        .from('staff_task_areas')
        .insert({
          slug,
          name,
          sort_order: Number(body?.sortOrder ?? 1000),
          created_by: actor.actorId,
          updated_by: actor.actorId,
        })
        .select('id,slug,name,sort_order,is_active')
        .single()

      if (error) {
        const duplicate =
          String(error.message ?? '').toLowerCase().includes('duplicate') ||
          String(error.code ?? '') === '23505'

        return json(duplicate ? 409 : 500, {
          ok: false,
          error: duplicate ? 'AREA_ALREADY_EXISTS' : 'AREA_CREATE_FAILED',
          details: error.message,
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: actor.actorId,
        action: 'staff_payroll_area_created',
        action_details: {
          area_id: area.id,
          area_name: area.name,
        },
      })

      revalidatePath('/admin/staff-payroll/tasks')
      return json(200, { ok: true, area })
    }

    if (action === 'update_area') {
      const areaId = normalizeUuid(body?.areaId ?? body?.area_id)
      const name = cleanString(body?.name, 100)

      if (!areaId) {
        return json(400, { ok: false, error: 'INVALID_AREA_ID' })
      }
      if (name.length < 2) {
        return json(400, { ok: false, error: 'AREA_NAME_REQUIRED' })
      }

      const { data: area, error } = await admin
        .from('staff_task_areas')
        .update({
          name,
          updated_by: actor.actorId,
        })
        .eq('id', areaId)
        .select('id,slug,name,sort_order,is_active')
        .maybeSingle()

      if (error) {
        const duplicate =
          String(error.message ?? '').toLowerCase().includes('duplicate') ||
          String(error.code ?? '') === '23505'

        return json(duplicate ? 409 : 500, {
          ok: false,
          error: duplicate ? 'AREA_ALREADY_EXISTS' : 'AREA_UPDATE_FAILED',
          details: error.message,
        })
      }

      if (!area) {
        return json(404, { ok: false, error: 'AREA_NOT_FOUND' })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: actor.actorId,
        action: 'staff_payroll_area_updated',
        action_details: {
          area_id: area.id,
          area_name: area.name,
        },
      })

      revalidatePath('/admin/staff-payroll/tasks')
      return json(200, { ok: true, area })
    }

    if (action === 'toggle_area') {
      const areaId = normalizeUuid(body?.areaId ?? body?.area_id)
      const isActive = Boolean(body?.isActive ?? body?.is_active)

      if (!areaId) {
        return json(400, { ok: false, error: 'INVALID_AREA_ID' })
      }

      if (!isActive) {
        const { count, error: countError } = await admin
          .from('staff_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('area_id', areaId)
          .eq('is_active', true)

        if (countError) {
          return json(500, {
            ok: false,
            error: 'AREA_ACTIVE_TASK_CHECK_FAILED',
            details: countError.message,
          })
        }

        if ((count ?? 0) > 0) {
          return json(409, {
            ok: false,
            error: 'AREA_HAS_ACTIVE_TASKS',
            details:
              'Deactivate or move the active tasks before deactivating this area.',
          })
        }
      }

      const { data: area, error } = await admin
        .from('staff_task_areas')
        .update({
          is_active: isActive,
          updated_by: actor.actorId,
        })
        .eq('id', areaId)
        .select('id,name,is_active')
        .maybeSingle()

      if (error) {
        return json(500, {
          ok: false,
          error: 'AREA_STATUS_UPDATE_FAILED',
          details: error.message,
        })
      }

      if (!area) {
        return json(404, { ok: false, error: 'AREA_NOT_FOUND' })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: actor.actorId,
        action: isActive
          ? 'staff_payroll_area_reactivated'
          : 'staff_payroll_area_deactivated',
        action_details: {
          area_id: area.id,
          area_name: area.name,
        },
      })

      revalidatePath('/admin/staff-payroll/tasks')
      return json(200, { ok: true, area })
    }

    if (action === 'create_task') {
      const parsed = taskPayload(body)
      if ('error' in parsed) {
        return json(400, { ok: false, error: parsed.error })
      }

      const payload = parsed.value
      const area = await validateArea(admin, payload.area_id)

      if (!area) {
        return json(404, { ok: false, error: 'AREA_NOT_FOUND' })
      }
      if (!area.is_active) {
        return json(409, { ok: false, error: 'AREA_INACTIVE' })
      }

      const { assigneeIds, ...taskRow } = payload

      const { data: task, error } = await admin
        .from('staff_tasks')
        .insert({
          ...taskRow,
          sort_order: Number(body?.sortOrder ?? 1000),
          created_by: actor.actorId,
          updated_by: actor.actorId,
        })
        .select(
          'id,area_id,name,frequency_label,estimated_time_label,estimated_min_hours_per_week,estimated_max_hours_per_week,unit,importance_level,importance_multiplier,notes,sort_order,is_active'
        )
        .single()

      if (error) {
        const duplicate =
          String(error.message ?? '').toLowerCase().includes('duplicate') ||
          String(error.code ?? '') === '23505'

        return json(duplicate ? 409 : 500, {
          ok: false,
          error: duplicate ? 'TASK_ALREADY_EXISTS_IN_AREA' : 'TASK_CREATE_FAILED',
          details: error.message,
        })
      }

      try {
        await replaceAssignees(admin, task.id, assigneeIds, actor.actorId)
      } catch (error: any) {
        await admin.from('staff_tasks').delete().eq('id', task.id)

        return json(400, {
          ok: false,
          error:
            error?.message === 'INVALID_DEFAULT_ASSIGNEE'
              ? 'INVALID_DEFAULT_ASSIGNEE'
              : 'DEFAULT_ASSIGNEE_SAVE_FAILED',
          details: error?.message ?? String(error),
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: actor.actorId,
        action: 'staff_payroll_task_created',
        action_details: {
          task_id: task.id,
          task_name: task.name,
          area_id: task.area_id,
          importance_level: task.importance_level,
          importance_multiplier: task.importance_multiplier,
          default_assignee_ids: assigneeIds,
        },
      })

      revalidatePath('/admin/staff-payroll/tasks')
      return json(200, { ok: true, task })
    }

    if (action === 'update_task') {
      const taskId = normalizeUuid(body?.taskId ?? body?.task_id)
      if (!taskId) {
        return json(400, { ok: false, error: 'INVALID_TASK_ID' })
      }

      const parsed = taskPayload(body)
      if ('error' in parsed) {
        return json(400, { ok: false, error: parsed.error })
      }

      const payload = parsed.value
      const area = await validateArea(admin, payload.area_id)

      if (!area) {
        return json(404, { ok: false, error: 'AREA_NOT_FOUND' })
      }
      if (!area.is_active) {
        return json(409, { ok: false, error: 'AREA_INACTIVE' })
      }

      const { data: existing, error: lookupError } = await admin
        .from('staff_tasks')
        .select(
          'id,area_id,name,importance_level,importance_multiplier,is_active'
        )
        .eq('id', taskId)
        .maybeSingle()

      if (lookupError) {
        return json(500, {
          ok: false,
          error: 'TASK_LOOKUP_FAILED',
          details: lookupError.message,
        })
      }
      if (!existing) {
        return json(404, { ok: false, error: 'TASK_NOT_FOUND' })
      }

      const { assigneeIds, ...taskRow } = payload

      const { data: task, error } = await admin
        .from('staff_tasks')
        .update({
          ...taskRow,
          updated_by: actor.actorId,
        })
        .eq('id', taskId)
        .select(
          'id,area_id,name,frequency_label,estimated_time_label,estimated_min_hours_per_week,estimated_max_hours_per_week,unit,importance_level,importance_multiplier,notes,sort_order,is_active'
        )
        .maybeSingle()

      if (error) {
        const duplicate =
          String(error.message ?? '').toLowerCase().includes('duplicate') ||
          String(error.code ?? '') === '23505'

        return json(duplicate ? 409 : 500, {
          ok: false,
          error: duplicate ? 'TASK_ALREADY_EXISTS_IN_AREA' : 'TASK_UPDATE_FAILED',
          details: error.message,
        })
      }

      if (!task) {
        return json(404, { ok: false, error: 'TASK_NOT_FOUND' })
      }

      try {
        await replaceAssignees(admin, task.id, assigneeIds, actor.actorId)
      } catch (error: any) {
        return json(400, {
          ok: false,
          error:
            error?.message === 'INVALID_DEFAULT_ASSIGNEE'
              ? 'INVALID_DEFAULT_ASSIGNEE'
              : 'DEFAULT_ASSIGNEE_SAVE_FAILED',
          details: error?.message ?? String(error),
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: actor.actorId,
        action: 'staff_payroll_task_updated',
        action_details: {
          task_id: task.id,
          previous: {
            area_id: existing.area_id,
            name: existing.name,
            importance_level: existing.importance_level,
            importance_multiplier: existing.importance_multiplier,
          },
          current: {
            area_id: task.area_id,
            name: task.name,
            importance_level: task.importance_level,
            importance_multiplier: task.importance_multiplier,
          },
          default_assignee_ids: assigneeIds,
        },
      })

      revalidatePath('/admin/staff-payroll/tasks')
      return json(200, { ok: true, task })
    }

    const taskId = normalizeUuid(body?.taskId ?? body?.task_id)
    const isActive = Boolean(body?.isActive ?? body?.is_active)

    if (!taskId) {
      return json(400, { ok: false, error: 'INVALID_TASK_ID' })
    }

    if (isActive) {
      const { data: existing, error: lookupError } = await admin
        .from('staff_tasks')
        .select('id,area_id')
        .eq('id', taskId)
        .maybeSingle()

      if (lookupError) {
        return json(500, {
          ok: false,
          error: 'TASK_LOOKUP_FAILED',
          details: lookupError.message,
        })
      }
      if (!existing) {
        return json(404, { ok: false, error: 'TASK_NOT_FOUND' })
      }

      const area = await validateArea(admin, existing.area_id)
      if (!area?.is_active) {
        return json(409, { ok: false, error: 'AREA_INACTIVE' })
      }
    }

    const { data: task, error } = await admin
      .from('staff_tasks')
      .update({
        is_active: isActive,
        updated_by: actor.actorId,
      })
      .eq('id', taskId)
      .select('id,name,is_active')
      .maybeSingle()

    if (error) {
      return json(500, {
        ok: false,
        error: 'TASK_STATUS_UPDATE_FAILED',
        details: error.message,
      })
    }

    if (!task) {
      return json(404, { ok: false, error: 'TASK_NOT_FOUND' })
    }

    await safeAudit(admin, {
      actor_user_id: actor.actorId,
      target_user_id: actor.actorId,
      action: isActive
        ? 'staff_payroll_task_reactivated'
        : 'staff_payroll_task_deactivated',
      action_details: {
        task_id: task.id,
        task_name: task.name,
      },
    })

    revalidatePath('/admin/staff-payroll/tasks')
    return json(200, { ok: true, task })
  } catch (error: any) {
    const message = error?.message ?? String(error)

    if (
      message.includes('staff_task_areas') ||
      message.includes('staff_tasks') ||
      message.includes('staff_task_default_assignees')
    ) {
      return json(500, {
        ok: false,
        error: 'MIGRATION_REQUIRED',
        details:
          'Apply the Staff Payroll 1A migration before using the Task Catalog.',
      })
    }

    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: message,
    })
  }
}
