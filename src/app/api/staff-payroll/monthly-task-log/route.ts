// Staff Payroll 1B — Monthly Task Log
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const STAFF_ROLES = new Set([
  'assistant_coach',
  'coach',
  'head_coach',
  'reception',
  'admin',
  'super_admin',
])

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

function parsePositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
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

  if (!year || !month) {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  }

  return `${year}-${month}-01`
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // Audit must never break the operational task-log flow.
  }
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authErr } = await supabase.auth.getUser()

  if (authErr || !auth.user) {
    return {
      actorId: '',
      role: '',
      error: authErr?.message || 'NOT_AUTHENTICATED',
    }
  }

  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  return {
    actorId: auth.user.id,
    role: me?.role ?? 'member',
    error: meErr?.message ?? '',
  }
}

async function isPayrollMonthLocked(admin: any, monthStart: string) {
  const { data, error } = await admin
    .from('staff_payroll_monthly_snapshots')
    .select('status,approval_version_no')
    .eq('month_start', monthStart)
    .maybeSingle()

  if (error) {
    const message = error.message ?? String(error)
    if (
      message.includes('approval_version_no') ||
      message.toLowerCase().includes('does not exist')
    ) {
      throw new Error('STAFF_PAYROLL_1D_MIGRATION_REQUIRED')
    }
    throw error
  }

  return {
    locked: data?.status === 'approved',
    versionNo: Number(data?.approval_version_no ?? 0),
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
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details:
          'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const action = cleanString(body?.action, 40)

    if (action === 'save') {
      const logId = normalizeUuid(body?.logId ?? body?.log_id)
      const staffUserId = normalizeUuid(body?.staffUserId ?? body?.staff_user_id)
      const taskId = normalizeUuid(body?.taskId ?? body?.task_id)
      const monthStart = normalizeMonthStart(body?.monthStart ?? body?.month_start)
      const note = cleanString(body?.note, 2000) || null
      const quantityInput = parsePositiveNumber(body?.quantity ?? body?.work_quantity)
      const hoursInput = parsePositiveNumber(body?.actualHours ?? body?.actual_hours)

      if (!staffUserId) return json(400, { ok: false, error: 'INVALID_STAFF_USER' })
      if (!taskId) return json(400, { ok: false, error: 'INVALID_TASK' })
      if (!monthStart) return json(400, { ok: false, error: 'INVALID_MONTH' })
      if (monthStart > currentCairoMonthStart()) {
        return json(400, {
          ok: false,
          error: 'FUTURE_MONTH_NOT_ALLOWED',
          details: 'Monthly task logs can be created for the current or a past month only.',
        })
      }

      const monthLock = await isPayrollMonthLocked(admin, monthStart)
      if (monthLock.locked) {
        return json(409, {
          ok: false,
          error: 'PAYROLL_MONTH_LOCKED',
          details: `This payroll month is approved and locked${monthLock.versionNo ? ` (Version ${monthLock.versionNo})` : ''}. Reopen it before changing monthly tasks.`,
        })
      }

      const [{ data: staff, error: staffErr }, { data: task, error: taskErr }] =
        await Promise.all([
          admin
            .from('profiles')
            .select('user_id,role,email,first_name,last_name')
            .eq('user_id', staffUserId)
            .maybeSingle(),
          admin
            .from('staff_tasks')
            .select(
              'id,area_id,name,unit,importance_level,importance_multiplier,is_active'
            )
            .eq('id', taskId)
            .maybeSingle(),
        ])

      if (staffErr) {
        return json(500, {
          ok: false,
          error: 'STAFF_LOOKUP_FAILED',
          details: staffErr.message,
        })
      }

      if (!staff?.user_id || !STAFF_ROLES.has(String(staff.role ?? ''))) {
        return json(400, { ok: false, error: 'STAFF_PROFILE_NOT_ELIGIBLE' })
      }

      if (taskErr) {
        return json(500, {
          ok: false,
          error: 'TASK_LOOKUP_FAILED',
          details: taskErr.message,
        })
      }

      if (!task?.id) return json(404, { ok: false, error: 'TASK_NOT_FOUND' })

      const { data: area, error: areaErr } = await admin
        .from('staff_task_areas')
        .select('id,name')
        .eq('id', task.area_id)
        .maybeSingle()

      if (areaErr || !area?.id) {
        return json(500, {
          ok: false,
          error: 'AREA_LOOKUP_FAILED',
          details: areaErr?.message ?? 'Task area not found.',
        })
      }

      let existing: any = null

      if (logId) {
        const { data, error } = await admin
          .from('staff_monthly_task_logs')
          .select(
            'id,month_start,staff_user_id,task_id,voided_at,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot'
          )
          .eq('id', logId)
          .maybeSingle()

        if (error) {
          return json(500, {
            ok: false,
            error: 'LOG_LOOKUP_FAILED',
            details: error.message,
          })
        }

        if (!data?.id || data.voided_at) {
          return json(404, { ok: false, error: 'LOG_NOT_FOUND' })
        }

        if (
          String(data.staff_user_id) !== staffUserId ||
          String(data.task_id) !== taskId ||
          String(data.month_start) !== monthStart
        ) {
          return json(409, {
            ok: false,
            error: 'LOG_IDENTITY_IMMUTABLE',
            details: 'Month, staff member and task cannot be changed on an existing monthly log row.',
          })
        }

        existing = data
      } else {
        const { data, error } = await admin
          .from('staff_monthly_task_logs')
          .select(
            'id,month_start,staff_user_id,task_id,voided_at,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot'
          )
          .eq('month_start', monthStart)
          .eq('staff_user_id', staffUserId)
          .eq('task_id', taskId)
          .is('voided_at', null)
          .maybeSingle()

        if (error) {
          const message = error.message ?? String(error)
          if (message.toLowerCase().includes('staff_monthly_task_logs')) {
            return json(500, {
              ok: false,
              error: 'MIGRATION_REQUIRED',
              details: 'Apply Staff Payroll 1B migration, then try again.',
            })
          }
          return json(500, {
            ok: false,
            error: 'LOG_LOOKUP_FAILED',
            details: message,
          })
        }

        existing = data
      }

      if (!existing && !task.is_active) {
        return json(409, {
          ok: false,
          error: 'INACTIVE_TASK_CANNOT_BE_ADDED',
        })
      }

      const unit = String(existing?.unit_snapshot ?? task.unit ?? 'task')
      let quantity = quantityInput
      let actualHours = hoursInput

      if (unit === 'hour') {
        if (!actualHours) {
          return json(400, {
            ok: false,
            error: 'HOURS_REQUIRED',
            details: 'Hour-based tasks require actual hours.',
          })
        }
        quantity = actualHours
      } else if (!quantity) {
        return json(400, {
          ok: false,
          error: 'QUANTITY_REQUIRED',
        })
      }

      if (existing?.id) {
        const { data: updated, error: updateErr } = await admin
          .from('staff_monthly_task_logs')
          .update({
            work_quantity: quantity,
            actual_hours: actualHours,
            note,
            updated_by: actor.actorId,
          })
          .eq('id', existing.id)
          .is('voided_at', null)
          .select(
            'id,month_start,staff_user_id,task_id,work_quantity,actual_hours,weighted_hours,note,updated_at'
          )
          .maybeSingle()

        if (updateErr) {
          const message = updateErr.message ?? String(updateErr)
          if (message.includes('STAFF_PAYROLL_MONTH_LOCKED')) {
            return json(409, {
              ok: false,
              error: 'PAYROLL_MONTH_LOCKED',
              details: 'This payroll month is approved and locked.',
            })
          }
          return json(500, {
            ok: false,
            error: 'LOG_UPDATE_FAILED',
            details: message,
          })
        }

        await safeAudit(admin, {
          actor_user_id: actor.actorId,
          target_user_id: staffUserId,
          action: 'staff_payroll_monthly_task_updated',
          action_details: {
            log_id: existing.id,
            month_start: monthStart,
            task_id: taskId,
            task_name: existing.task_name_snapshot,
            quantity,
            actual_hours: actualHours,
            note,
            note_scope: 'Monthly task log only. No salary calculation or payment was changed.',
          },
        })

        revalidatePath('/admin/staff-payroll/monthly-tasks')
        return json(200, { ok: true, log: updated, mode: 'updated' })
      }

      const { data: inserted, error: insertErr } = await admin
        .from('staff_monthly_task_logs')
        .insert({
          month_start: monthStart,
          staff_user_id: staffUserId,
          task_id: taskId,
          area_id_snapshot: area.id,
          task_name_snapshot: task.name,
          area_name_snapshot: area.name,
          unit_snapshot: task.unit,
          importance_level_snapshot: task.importance_level,
          importance_multiplier_snapshot: Number(task.importance_multiplier ?? 1),
          work_quantity: quantity,
          actual_hours: actualHours,
          note,
          source: 'manual',
          created_by: actor.actorId,
          updated_by: actor.actorId,
        })
        .select(
          'id,month_start,staff_user_id,task_id,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot,work_quantity,actual_hours,weighted_hours,note,source,created_at,updated_at'
        )
        .maybeSingle()

      if (insertErr) {
        const message = insertErr.message ?? String(insertErr)
        if (message.includes('STAFF_PAYROLL_MONTH_LOCKED')) {
          return json(409, {
            ok: false,
            error: 'PAYROLL_MONTH_LOCKED',
            details: 'This payroll month is approved and locked.',
          })
        }
        if (message.toLowerCase().includes('unique')) {
          return json(409, {
            ok: false,
            error: 'TASK_ALREADY_LOGGED_FOR_MONTH',
          })
        }
        if (message.toLowerCase().includes('staff_monthly_task_logs')) {
          return json(500, {
            ok: false,
            error: 'MIGRATION_REQUIRED',
            details: 'Apply Staff Payroll 1B migration, then try again.',
          })
        }
        return json(500, {
          ok: false,
          error: 'LOG_CREATE_FAILED',
          details: message,
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: staffUserId,
        action: 'staff_payroll_monthly_task_created',
        action_details: {
          log_id: inserted?.id ?? null,
          month_start: monthStart,
          task_id: taskId,
          task_name: task.name,
          area_name: area.name,
          unit: task.unit,
          importance_level: task.importance_level,
          importance_multiplier: Number(task.importance_multiplier ?? 1),
          quantity,
          actual_hours: actualHours,
          note,
          note_scope: 'Monthly task log only. No salary calculation or payment was created.',
        },
      })

      revalidatePath('/admin/staff-payroll/monthly-tasks')
      return json(200, { ok: true, log: inserted, mode: 'created' })
    }

    if (action === 'void') {
      const logId = normalizeUuid(body?.logId ?? body?.log_id)
      const reason = cleanString(body?.reason, 500)

      if (!logId) return json(400, { ok: false, error: 'INVALID_LOG_ID' })
      if (reason.length < 3) {
        return json(400, { ok: false, error: 'VOID_REASON_REQUIRED' })
      }

      const { data: existing, error: lookupErr } = await admin
        .from('staff_monthly_task_logs')
        .select(
          'id,month_start,staff_user_id,task_id,task_name_snapshot,work_quantity,actual_hours,voided_at'
        )
        .eq('id', logId)
        .maybeSingle()

      if (lookupErr) {
        return json(500, {
          ok: false,
          error: 'LOG_LOOKUP_FAILED',
          details: lookupErr.message,
        })
      }

      if (!existing?.id) return json(404, { ok: false, error: 'LOG_NOT_FOUND' })
      if (existing.voided_at) {
        return json(409, { ok: false, error: 'LOG_ALREADY_VOIDED' })
      }

      const monthLock = await isPayrollMonthLocked(admin, String(existing.month_start))
      if (monthLock.locked) {
        return json(409, {
          ok: false,
          error: 'PAYROLL_MONTH_LOCKED',
          details: `This payroll month is approved and locked${monthLock.versionNo ? ` (Version ${monthLock.versionNo})` : ''}. Reopen it before changing monthly tasks.`,
        })
      }

      const now = new Date().toISOString()
      const { error: voidErr } = await admin
        .from('staff_monthly_task_logs')
        .update({
          voided_at: now,
          voided_by: actor.actorId,
          void_reason: reason,
          updated_by: actor.actorId,
        })
        .eq('id', logId)
        .is('voided_at', null)

      if (voidErr) {
        const message = voidErr.message ?? String(voidErr)
        if (message.includes('STAFF_PAYROLL_MONTH_LOCKED')) {
          return json(409, {
            ok: false,
            error: 'PAYROLL_MONTH_LOCKED',
            details: 'This payroll month is approved and locked.',
          })
        }
        return json(500, {
          ok: false,
          error: 'LOG_VOID_FAILED',
          details: message,
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: existing.staff_user_id,
        action: 'staff_payroll_monthly_task_voided',
        action_details: {
          log_id: existing.id,
          month_start: existing.month_start,
          task_id: existing.task_id,
          task_name: existing.task_name_snapshot,
          previous_quantity: existing.work_quantity,
          previous_actual_hours: existing.actual_hours,
          void_reason: reason,
          note_scope: 'Monthly task log void only. No salary calculation or payment was changed.',
        },
      })

      revalidatePath('/admin/staff-payroll/monthly-tasks')
      return json(200, { ok: true })
    }

    return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (error: any) {
    const message = error?.message ?? String(error)
    if (message.includes('STAFF_PAYROLL_1D_MIGRATION_REQUIRED')) {
      return json(500, {
        ok: false,
        error: 'MIGRATION_REQUIRED',
        details: 'Apply Staff Payroll 1D migration first.',
      })
    }
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: message,
    })
  }
}
