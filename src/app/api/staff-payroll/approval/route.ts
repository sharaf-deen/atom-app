// Staff Payroll 1D — Payroll Approval & Monthly Locking
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { cairoDayBoundsUTC } from '@/lib/cairoTime'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  buildPayrollCalculationsHash,
  buildPayrollSnapshotHash,
  buildPayrollSourceHashes,
} from '@/lib/staffPayrollIntegrity'

const STAFF_ROLES = [
  'assistant_coach',
  'coach',
  'head_coach',
  'reception',
  'admin',
  'super_admin',
] as const

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

function nextMonthStart(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return next.toISOString().slice(0, 10)
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
    // Audit must never break payroll approval/reopen after the DB action succeeded.
  }
}

function migrationMissing(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('staff_payroll_approval_versions') ||
    lower.includes('staff_payroll_reopen_events') ||
    lower.includes('financial_source_hash') ||
    lower.includes('staff_payroll_approve_snapshot') ||
    lower.includes('staff_payroll_reopen_snapshot') ||
    lower.includes('does not exist')
  )
}

function rpcErrorDetails(message: string) {
  if (message.includes('STAFF_PAYROLL_MISSING_HOURS')) {
    return 'Complete all missing actual hours, recalculate the payroll draft, then approve.'
  }
  if (message.includes('STAFF_PAYROLL_UNCONFIGURED_STAFF')) {
    return 'Configure compensation for every staff member in the draft, recalculate, then approve.'
  }
  if (message.includes('STAFF_PAYROLL_RECALC_REQUIRED')) {
    return 'This draft predates the 1D integrity checks or was reopened. Recalculate it before approval.'
  }
  if (message.includes('STAFF_PAYROLL_DRAFT_OUTDATED')) {
    return 'The draft is outdated. Source data changed after the last calculation. Recalculate payroll first.'
  }
  if (message.includes('STAFF_PAYROLL_NOT_DRAFT')) {
    return 'This payroll month is already approved or is no longer a draft.'
  }
  if (message.includes('STAFF_PAYROLL_NOT_APPROVED')) {
    return 'Only an approved payroll can be reopened.'
  }
  if (message.includes('STAFF_PAYROLL_REOPEN_REASON_REQUIRED')) {
    return 'A reason is required to reopen an approved payroll.'
  }
  if (message.includes('STAFF_PAYROLL_ACTIVE_PAYMENTS_BLOCK_REOPEN')) {
    return 'This payroll has active salary payments. Reverse all active payments first, then reopen if a payroll correction is still required.'
  }
  return message
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
    const snapshotId = normalizeUuid(body?.snapshotId ?? body?.snapshot_id)

    if (!snapshotId) {
      return json(400, { ok: false, error: 'INVALID_SNAPSHOT_ID' })
    }

    if (action === 'approve') {
      const approvalNote = cleanString(body?.approvalNote ?? body?.approval_note, 2000)

      const { data: snapshot, error: snapshotError } = await admin
        .from('staff_payroll_monthly_snapshots')
        .select(
          'id,month_start,status,approval_version_no,eligible_revenue_scope,bonus_pool_percent,membership_revenue,membership_payment_count,paid_membership_refunds,paid_membership_refund_count,net_membership_revenue,eligible_operating_expenses,eligible_expense_count,excluded_payroll_expenses,excluded_payroll_expense_count,operating_result_before_payroll,guaranteed_payroll,available_result_after_guaranteed_payroll,performance_bonus_pool,calculated_payroll_total,staff_count,missing_hours_task_count,unconfigured_staff_count,financial_source_hash,task_source_hash,compensation_source_hash,staff_source_hash,draft_snapshot_hash,draft_calculation_hash'
        )
        .eq('id', snapshotId)
        .maybeSingle()

      if (snapshotError) {
        const message = snapshotError.message ?? String(snapshotError)
        return json(500, {
          ok: false,
          error: migrationMissing(message) ? 'MIGRATION_REQUIRED' : 'SNAPSHOT_LOOKUP_FAILED',
          details: migrationMissing(message)
            ? 'Apply Staff Payroll 1D migration, then recalculate the draft.'
            : message,
        })
      }

      if (!snapshot?.id) return json(404, { ok: false, error: 'SNAPSHOT_NOT_FOUND' })
      if (snapshot.status !== 'draft') {
        return json(409, {
          ok: false,
          error: 'PAYROLL_ALREADY_LOCKED',
          details: 'This payroll month is already approved and locked.',
        })
      }
      if (Number(snapshot.missing_hours_task_count ?? 0) > 0) {
        return json(409, {
          ok: false,
          error: 'MISSING_HOURS',
          details: 'Complete all missing actual hours and recalculate before approval.',
        })
      }
      if (Number(snapshot.unconfigured_staff_count ?? 0) > 0) {
        return json(409, {
          ok: false,
          error: 'UNCONFIGURED_STAFF',
          details: 'Configure compensation for every staff member and recalculate before approval.',
        })
      }
      if (Number(snapshot.staff_count ?? 0) < 1) {
        return json(409, {
          ok: false,
          error: 'NO_STAFF_IN_DRAFT',
          details: 'There is no staff calculation to approve.',
        })
      }

      const storedHashes = {
        financial_source_hash: String(snapshot.financial_source_hash ?? ''),
        task_source_hash: String(snapshot.task_source_hash ?? ''),
        compensation_source_hash: String(snapshot.compensation_source_hash ?? ''),
        staff_source_hash: String(snapshot.staff_source_hash ?? ''),
        draft_snapshot_hash: String(snapshot.draft_snapshot_hash ?? ''),
        draft_calculation_hash: String(snapshot.draft_calculation_hash ?? ''),
      }

      if (Object.values(storedHashes).some((value) => !value)) {
        return json(409, {
          ok: false,
          error: 'RECALC_REQUIRED',
          details: 'Recalculate this payroll draft once after applying Staff Payroll 1D before approval.',
        })
      }

      const monthStart = String(snapshot.month_start)
      const nextMonth = nextMonthStart(monthStart)
      const startISO = cairoDayBoundsUTC(monthStart).startISO
      const endISO = cairoDayBoundsUTC(nextMonth).startISO

      const [
        paymentsResult,
        refundsResult,
        expensesResult,
        logsResult,
        compensationResult,
        staffResult,
        calculationsResult,
      ] = await Promise.all([
        admin
          .from('subscription_payments')
          .select('id,amount')
          .gte('paid_at', startISO)
          .lt('paid_at', endISO)
          .limit(100000),
        admin
          .from('membership_refunds')
          .select('id,amount')
          .eq('status', 'paid')
          .gte('paid_at', startISO)
          .lt('paid_at', endISO)
          .limit(100000),
        admin
          .from('expenses')
          .select('id,date,category_key,amount')
          .gte('date', monthStart)
          .lt('date', nextMonth)
          .limit(100000),
        admin
          .from('staff_monthly_task_logs')
          .select(
            'id,staff_user_id,task_id,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot,work_quantity,actual_hours,weighted_hours,note,updated_at,voided_at'
          )
          .eq('month_start', monthStart)
          .is('voided_at', null)
          .limit(100000),
        admin
          .from('staff_compensation_profiles')
          .select('staff_user_id,fixed_monthly_base,weighted_hour_rate,bonus_eligible,updated_at')
          .limit(10000),
        admin
          .from('profiles')
          .select('user_id,email,first_name,last_name,role')
          .in('role', [...STAFF_ROLES])
          .limit(10000),
        admin
          .from('staff_payroll_monthly_calculations')
          .select(
            'staff_user_id,staff_name_snapshot,staff_role_snapshot,compensation_configured,fixed_monthly_base,weighted_hour_rate,bonus_eligible,active_task_count,missing_hours_task_count,actual_hours,weighted_hours,task_compensation,guaranteed_compensation,bonus_weight_share_percent,performance_bonus,calculated_salary'
          )
          .eq('snapshot_id', snapshotId)
          .limit(10000),
      ])

      const sourceError =
        paymentsResult.error?.message ||
        refundsResult.error?.message ||
        expensesResult.error?.message ||
        logsResult.error?.message ||
        compensationResult.error?.message ||
        staffResult.error?.message ||
        calculationsResult.error?.message ||
        ''

      if (sourceError) {
        return json(500, {
          ok: false,
          error: migrationMissing(sourceError) ? 'MIGRATION_REQUIRED' : 'APPROVAL_SOURCE_LOAD_FAILED',
          details: migrationMissing(sourceError)
            ? 'Apply Staff Payroll 1D migration, then recalculate the draft.'
            : sourceError,
        })
      }

      const currentHashes = buildPayrollSourceHashes({
        payments: (paymentsResult.data ?? []) as any[],
        refunds: (refundsResult.data ?? []) as any[],
        expenses: (expensesResult.data ?? []) as any[],
        logs: (logsResult.data ?? []) as any[],
        compensationProfiles: (compensationResult.data ?? []) as any[],
        staffProfiles: (staffResult.data ?? []) as any[],
      })

      const currentSnapshotHash = buildPayrollSnapshotHash(snapshot as any)
      const currentCalculationHash = buildPayrollCalculationsHash(
        (calculationsResult.data ?? []) as any[]
      )

      const changedScopes: string[] = []
      if (currentHashes.financial_source_hash !== storedHashes.financial_source_hash) changedScopes.push('financial data')
      if (currentHashes.task_source_hash !== storedHashes.task_source_hash) changedScopes.push('monthly tasks')
      if (currentHashes.compensation_source_hash !== storedHashes.compensation_source_hash) changedScopes.push('staff compensation settings')
      if (currentHashes.staff_source_hash !== storedHashes.staff_source_hash) changedScopes.push('staff profiles')
      if (currentSnapshotHash !== storedHashes.draft_snapshot_hash) changedScopes.push('draft financial snapshot')
      if (currentCalculationHash !== storedHashes.draft_calculation_hash) changedScopes.push('staff calculations')

      if (changedScopes.length) {
        return json(409, {
          ok: false,
          error: 'DRAFT_OUTDATED',
          details: `Draft is outdated: ${changedScopes.join(', ')} changed after the last calculation. Recalculate payroll first.`,
          changedScopes,
        })
      }

      const { data: approvalRows, error: approvalError } = await admin.rpc(
        'staff_payroll_approve_snapshot',
        {
          p_snapshot_id: snapshotId,
          p_actor_id: actor.actorId,
          p_approval_note: approvalNote || null,
          p_financial_source_hash: currentHashes.financial_source_hash,
          p_task_source_hash: currentHashes.task_source_hash,
          p_compensation_source_hash: currentHashes.compensation_source_hash,
          p_staff_source_hash: currentHashes.staff_source_hash,
          p_draft_snapshot_hash: currentSnapshotHash,
          p_draft_calculation_hash: currentCalculationHash,
        }
      )

      if (approvalError) {
        const message = approvalError.message ?? String(approvalError)
        return json(migrationMissing(message) ? 500 : 409, {
          ok: false,
          error: migrationMissing(message) ? 'MIGRATION_REQUIRED' : 'APPROVAL_FAILED',
          details: migrationMissing(message)
            ? 'Apply Staff Payroll 1D migration, then recalculate the draft.'
            : rpcErrorDetails(message),
        })
      }

      const approval = Array.isArray(approvalRows) ? approvalRows[0] : approvalRows

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: null,
        action: 'staff_payroll_approved_locked',
        action_details: {
          snapshot_id: snapshotId,
          month_start: monthStart,
          approval_version_id: approval?.approval_version_id ?? null,
          version_no: approval?.version_no ?? null,
          calculated_payroll_total: Number(snapshot.calculated_payroll_total ?? 0),
          staff_count: Number(snapshot.staff_count ?? 0),
          approval_note: approvalNote || null,
          source_integrity_verified: true,
          note_scope: 'Payroll approval and monthly lock only. No salary payment was created.',
        },
      })

      revalidatePath('/admin/staff-payroll/calculation')
      revalidatePath('/admin/staff-payroll/monthly-tasks')
      revalidatePath('/admin/staff-payroll/payments')
      return json(200, {
        ok: true,
        versionNo: approval?.version_no ?? null,
        approvalVersionId: approval?.approval_version_id ?? null,
      })
    }

    if (action === 'reopen') {
      const reason = cleanString(body?.reason, 1000)
      if (reason.length < 3) {
        return json(400, {
          ok: false,
          error: 'REOPEN_REASON_REQUIRED',
          details: 'A reason of at least 3 characters is required.',
        })
      }

      const { data: snapshot, error: snapshotError } = await admin
        .from('staff_payroll_monthly_snapshots')
        .select('id,month_start,status,approval_version_no,calculated_payroll_total')
        .eq('id', snapshotId)
        .maybeSingle()

      if (snapshotError) {
        const message = snapshotError.message ?? String(snapshotError)
        return json(500, {
          ok: false,
          error: migrationMissing(message) ? 'MIGRATION_REQUIRED' : 'SNAPSHOT_LOOKUP_FAILED',
          details: migrationMissing(message)
            ? 'Apply Staff Payroll 1D migration first.'
            : message,
        })
      }

      if (!snapshot?.id) return json(404, { ok: false, error: 'SNAPSHOT_NOT_FOUND' })
      if (snapshot.status !== 'approved') {
        return json(409, {
          ok: false,
          error: 'PAYROLL_NOT_APPROVED',
          details: 'Only an approved payroll month can be reopened.',
        })
      }

      const { data: reopenRows, error: reopenError } = await admin.rpc(
        'staff_payroll_reopen_snapshot',
        {
          p_snapshot_id: snapshotId,
          p_actor_id: actor.actorId,
          p_reason: reason,
        }
      )

      if (reopenError) {
        const message = reopenError.message ?? String(reopenError)
        return json(migrationMissing(message) ? 500 : 409, {
          ok: false,
          error: migrationMissing(message) ? 'MIGRATION_REQUIRED' : 'REOPEN_FAILED',
          details: migrationMissing(message)
            ? 'Apply Staff Payroll 1D migration first.'
            : rpcErrorDetails(message),
        })
      }

      const reopen = Array.isArray(reopenRows) ? reopenRows[0] : reopenRows

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: null,
        action: 'staff_payroll_reopened',
        action_details: {
          snapshot_id: snapshotId,
          month_start: snapshot.month_start,
          reopened_version_no: reopen?.reopened_version_no ?? snapshot.approval_version_no,
          previous_calculated_payroll_total: Number(snapshot.calculated_payroll_total ?? 0),
          reopen_reason: reason,
          recalculate_required: true,
          note_scope: 'Exceptional payroll reopen only. Prior approval version remains preserved.',
        },
      })

      revalidatePath('/admin/staff-payroll/calculation')
      revalidatePath('/admin/staff-payroll/monthly-tasks')
      revalidatePath('/admin/staff-payroll/payments')
      return json(200, {
        ok: true,
        reopenedVersionNo: reopen?.reopened_version_no ?? null,
      })
    }

    return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: error?.message ?? String(error),
    })
  }
}
