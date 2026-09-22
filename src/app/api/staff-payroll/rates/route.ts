// Staff Payroll 2D — Effective-dated Compensation Rates
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
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeUuid(value: unknown) {
  const raw = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : ''
}

function normalizeEffectiveMonth(value: unknown) {
  const raw = cleanString(value, 20)
  const match = raw.match(/^(\d{4})-(\d{2})(?:-01)?$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2026 || year > 2200 || month < 1 || month > 12) return ''
  const result = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
  return result >= '2026-08-01' ? result : ''
}

function parseMoney(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) {
    return { actorId: '', role: '', error: authError?.message || 'NOT_AUTHENTICATED' }
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

function errorDetails(message: string) {
  if (message.includes('STAFF_PAYROLL_RATE_PERIOD_USED_BY_APPROVED_PAYROLL')) {
    return 'This rate period is already used by an approved payroll. Create a new future period instead.'
  }
  if (message.includes('STAFF_PAYROLL_TASK_RATE_USED_BY_APPROVED_PAYROLL')) {
    return 'Task rates in this period are already used by an approved payroll and cannot be changed.'
  }
  if (message.includes('STAFF_PAYROLL_RATE_PERIOD_ALREADY_EXISTS')) {
    return 'A rate period already starts in this month for this staff member.'
  }
  if (message.includes('STAFF_PAYROLL_RATE_PERIOD_OVERLAP')) {
    return 'This rate period overlaps another period for the same staff member.'
  }
  if (message.includes('STAFF_PAYROLL_INVALID_OR_DUPLICATE_TASK_RATE')) {
    return 'One or more task overrides are invalid, duplicated or refer to an inactive task.'
  }
  if (message.toLowerCase().includes('does not exist')) {
    return 'Deploy the Staff Payroll 2D database migration, then try again.'
  }
  return message
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED', details: actor.error })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })
    if (actor.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    if (cleanString(body?.action, 40) !== 'save_rate_period') {
      return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
    }

    const periodId = body?.periodId ? normalizeUuid(body.periodId) : ''
    const staffUserId = normalizeUuid(body?.staffUserId)
    const effectiveFrom = normalizeEffectiveMonth(body?.effectiveFrom)
    const fixedMonthlyBase = parseMoney(body?.fixedMonthlyBase)
    const weightedHourRate = parseMoney(body?.weightedHourRate)
    const bonusEligible = Boolean(body?.bonusEligible)
    const rawTaskRates = Array.isArray(body?.taskRates) ? body.taskRates : []

    if (body?.periodId && !periodId) return json(400, { ok: false, error: 'INVALID_PERIOD_ID' })
    if (!staffUserId) return json(400, { ok: false, error: 'INVALID_STAFF_USER' })
    if (!effectiveFrom) return json(400, { ok: false, error: 'INVALID_EFFECTIVE_MONTH' })
    if (fixedMonthlyBase === null) return json(400, { ok: false, error: 'INVALID_FIXED_MONTHLY_BASE' })
    if (weightedHourRate === null) return json(400, { ok: false, error: 'INVALID_WEIGHTED_HOUR_RATE' })
    if (rawTaskRates.length > 100) return json(400, { ok: false, error: 'TOO_MANY_TASK_OVERRIDES' })

    const taskIds = new Set<string>()
    const taskRates: Array<{ task_id: string; weighted_hour_rate: number }> = []
    for (const row of rawTaskRates) {
      const taskId = normalizeUuid(row?.taskId ?? row?.task_id)
      const rate = parseMoney(row?.weightedHourRate ?? row?.weighted_hour_rate)
      if (!taskId || rate === null || taskIds.has(taskId)) {
        return json(400, { ok: false, error: 'INVALID_OR_DUPLICATE_TASK_RATE' })
      }
      taskIds.add(taskId)
      taskRates.push({ task_id: taskId, weighted_hour_rate: rate })
    }

    const { data: savedPeriodId, error: saveError } = await admin.rpc(
      'staff_payroll_save_rate_period',
      {
        p_actor_id: actor.actorId,
        p_staff_user_id: staffUserId,
        p_effective_from: effectiveFrom,
        p_fixed_monthly_base: fixedMonthlyBase,
        p_weighted_hour_rate: weightedHourRate,
        p_bonus_eligible: bonusEligible,
        p_task_rates: taskRates,
        p_period_id: periodId || null,
      }
    )

    if (saveError) {
      const message = saveError.message ?? String(saveError)
      return json(message.toLowerCase().includes('does not exist') ? 500 : 409, {
        ok: false,
        error: 'RATE_PERIOD_SAVE_FAILED',
        details: errorDetails(message),
      })
    }

    try {
      await admin.from('audit_logs').insert({
        actor_user_id: actor.actorId,
        target_user_id: staffUserId,
        action: periodId
          ? 'staff_payroll_rate_period_updated'
          : 'staff_payroll_rate_period_created',
        action_details: {
          rate_period_id: savedPeriodId,
          staff_user_id: staffUserId,
          effective_from: effectiveFrom,
          fixed_monthly_base: fixedMonthlyBase,
          weighted_hour_rate: weightedHourRate,
          bonus_eligible: bonusEligible,
          task_override_count: taskRates.length,
          historical_payroll_unchanged: true,
        },
      })
    } catch {
      // Audit must not invalidate a successfully saved guarded rate period.
    }

    revalidatePath('/admin/staff-payroll')
    revalidatePath('/admin/staff-payroll/rates')
    revalidatePath('/admin/staff-payroll/calculation')
    return json(200, { ok: true, periodId: savedPeriodId })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message ?? String(error) })
  }
}
