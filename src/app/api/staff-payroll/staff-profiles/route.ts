// Staff Payroll 2O — Staff Profiles & Default Task Assignments
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

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
  return value.trim().slice(0, max)
}

function normalizeUuid(value: unknown) {
  const raw = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : ''
}

function normalizeDate(value: unknown) {
  const raw = cleanString(value, 20)
  if (!raw) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function normalizeStringArray(value: unknown, maxItems = 100) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => cleanString(item, 80))
        .filter(Boolean)
        .slice(0, maxItems)
    )
  )
}

function normalizeUuidArray(value: unknown, maxItems = 500) {
  if (!Array.isArray(value)) return []
  const ids = value.map(normalizeUuid).filter(Boolean).slice(0, maxItems)
  return Array.from(new Set(ids))
}

function mapRpcError(message: string) {
  const value = message.toUpperCase()

  const known = [
    'STAFF_PAYROLL_SUPER_ADMIN_REQUIRED',
    'STAFF_PAYROLL_INVALID_STAFF_USER',
    'STAFF_PAYROLL_STAFF_PROFILE_NOT_ELIGIBLE',
    'STAFF_PAYROLL_CANONICAL_ACCOUNT_ALREADY_LINKED',
    'STAFF_PAYROLL_INVALID_PRIMARY_ROLE',
    'STAFF_PAYROLL_INVALID_EMPLOYMENT_STATUS',
    'STAFF_PAYROLL_INVALID_EMPLOYMENT_DATES',
    'STAFF_PAYROLL_NOTES_TOO_LONG',
    'STAFF_PAYROLL_TOO_MANY_SECONDARY_ROLES',
    'STAFF_PAYROLL_INVALID_SECONDARY_ROLE',
    'STAFF_PAYROLL_DUPLICATE_LINKED_ACCOUNT',
    'STAFF_PAYROLL_CANNOT_LINK_CANONICAL_TO_ITSELF',
    'STAFF_PAYROLL_LINKED_ACCOUNT_NOT_ELIGIBLE',
    'STAFF_PAYROLL_LINKED_ACCOUNT_IS_ANOTHER_CANONICAL_PROFILE',
    'STAFF_PAYROLL_LINKED_ACCOUNT_ALREADY_ASSIGNED',
    'STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_ACTIVE_COMPENSATION',
    'STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_CURRENT_TASKS',
    'STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_CURRENT_ADJUSTMENTS',
    'STAFF_PAYROLL_DUPLICATE_DEFAULT_TASK',
    'STAFF_PAYROLL_INVALID_DEFAULT_TASK',
    'STAFF_PAYROLL_DEFAULT_TASK_SAVE_MISMATCH',
  ]

  return known.find((code) => value.includes(code)) ?? 'STAFF_PAYROLL_PROFILE_SAVE_FAILED'
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
    // Audit failure must not hide an already completed Staff Payroll configuration save.
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
      })
    }

    const body = await req.json().catch(() => ({}))
    const action = cleanString(body?.action, 40)

    if (action !== 'save') {
      return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
    }

    const staffUserId = normalizeUuid(body?.staffUserId ?? body?.staff_user_id)
    const primaryRole = cleanString(body?.primaryRole ?? body?.primary_role, 60)
    const secondaryRoles = normalizeStringArray(
      body?.secondaryRoles ?? body?.secondary_roles,
      12
    )
    const employmentStatus = cleanString(
      body?.employmentStatus ?? body?.employment_status,
      20
    )
    const employmentStartDate = normalizeDate(
      body?.employmentStartDate ?? body?.employment_start_date
    )
    const employmentEndDate = normalizeDate(
      body?.employmentEndDate ?? body?.employment_end_date
    )
    const notes = cleanString(body?.notes, 2000) || null
    const linkedUserIds = normalizeUuidArray(
      body?.linkedUserIds ?? body?.linked_user_ids,
      20
    )
    const defaultTaskIds = normalizeUuidArray(
      body?.defaultTaskIds ?? body?.default_task_ids,
      500
    )

    if (!staffUserId) {
      return json(400, { ok: false, error: 'INVALID_STAFF_USER' })
    }
    if (!primaryRole) {
      return json(400, { ok: false, error: 'INVALID_PRIMARY_ROLE' })
    }
    if (!['active', 'inactive'].includes(employmentStatus)) {
      return json(400, { ok: false, error: 'INVALID_EMPLOYMENT_STATUS' })
    }
    if (employmentStartDate === '' || employmentEndDate === '') {
      return json(400, { ok: false, error: 'INVALID_EMPLOYMENT_DATE' })
    }

    const result = await admin.rpc('staff_payroll_save_staff_profile', {
      p_actor_id: actor.actorId,
      p_staff_user_id: staffUserId,
      p_primary_role: primaryRole,
      p_secondary_roles: secondaryRoles,
      p_employment_status: employmentStatus,
      p_employment_start_date: employmentStartDate,
      p_employment_end_date: employmentEndDate,
      p_notes: notes,
      p_linked_user_ids: linkedUserIds,
      p_default_task_ids: defaultTaskIds,
    })

    if (result.error) {
      const message = result.error.message || String(result.error)
      if (
        message.toLowerCase().includes('staff_payroll_staff_profiles') ||
        message.toLowerCase().includes('staff_payroll_save_staff_profile') ||
        message.toLowerCase().includes('does not exist')
      ) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Deploy Staff Payroll 2O database migration first.',
        })
      }

      return json(409, {
        ok: false,
        error: mapRpcError(message),
        details: message,
      })
    }

    await safeAudit(admin, {
      actor_user_id: actor.actorId,
      target_user_id: staffUserId,
      action: 'staff_payroll_staff_profile_saved',
      action_details: {
        staff_user_id: staffUserId,
        primary_role: primaryRole,
        secondary_roles: secondaryRoles,
        employment_status: employmentStatus,
        employment_start_date: employmentStartDate,
        employment_end_date: employmentEndDate,
        linked_user_ids: linkedUserIds,
        default_task_ids: defaultTaskIds,
        note_scope:
          'Staff profile/default-template configuration only. Historical payroll calculations and approvals were not changed.',
      },
    })

    revalidatePath('/admin/staff-payroll/staff')
    revalidatePath('/admin/staff-payroll/tasks')
    revalidatePath('/admin/staff-payroll/monthly-tasks')
    revalidatePath('/admin/staff-payroll/rates')
    revalidatePath('/admin/staff-payroll/calculation')

    return json(200, {
      ok: true,
      staffUserId,
      linkedAccountCount: linkedUserIds.length,
      defaultTaskCount: defaultTaskIds.length,
    })
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: error?.message ?? String(error),
    })
  }
}
