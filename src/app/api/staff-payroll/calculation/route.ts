// Staff Payroll 1C — Financial Snapshot & Salary Calculation Engine
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

const PAYROLL_EXPENSE_CATEGORY_KEYS = new Set([
  'coaches',
  'reception',
  'assistants',
  'bonuses',
])
const PAYROLL_BASELINE_MONTH = '2026-08-01'

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

function round2(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseMoney(value: unknown) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return null
  return round2(numberValue)
}

function parsePercent(value: unknown) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) {
    return null
  }
  return round2(numberValue)
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

function nextMonthStart(monthStart: string) {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return next.toISOString().slice(0, 10)
}

function staffName(profile: any) {
  const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
  return name || profile?.email || String(profile?.user_id ?? '').slice(0, 8) || 'Staff'
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
    // Audit must never break draft payroll configuration/calculation.
  }
}

function looksLikeMigrationMissing(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('staff_compensation_profiles') ||
    lower.includes('staff_compensation_rate_periods') ||
    lower.includes('staff_compensation_task_rates') ||
    lower.includes('compensation_rate_period_id') ||
    lower.includes('staff_payroll_monthly_snapshots') ||
    lower.includes('staff_payroll_monthly_calculations') ||
    lower.includes('staff_payroll_monthly_adjustments') ||
    lower.includes('staff_payroll_task_minimum_rate_periods') ||
    lower.includes('minimum_task_compensation') ||
    lower.includes('variable_payroll_percent') ||
    lower.includes('salary_before_adjustments') ||
    lower.includes('financial_source_hash') ||
    lower.includes('task_source_hash') ||
    lower.includes('draft_snapshot_hash') ||
    lower.includes('draft_calculation_hash') ||
    lower.includes('does not exist')
  )
}

type DraftStaffRow = {
  staff_user_id: string
  staff_name_snapshot: string
  staff_role_snapshot: string | null
  compensation_configured: boolean
  compensation_rate_period_id: string | null
  compensation_effective_from: string | null
  compensation_effective_until: string | null
  fixed_monthly_base: number
  weighted_hour_rate: number
  bonus_eligible: boolean
  active_task_count: number
  missing_hours_task_count: number
  actual_hours: number
  weighted_hours: number
  task_compensation: number
  minimum_task_compensation: number
  dynamic_task_supplement: number
  dynamic_weight_share_percent: number
  guaranteed_compensation: number
  bonus_weight_share_percent: number
  performance_bonus: number
  salary_before_adjustments: number
  manual_bonus: number
  manual_deduction: number
  net_manual_adjustment: number
  calculated_salary: number
  adjustment_breakdown: Array<{
    adjustment_id: string
    adjustment_type: 'bonus' | 'deduction'
    amount: number
    reason: string
    created_at: string
    created_by_name_snapshot: string
  }>
  task_rate_breakdown: Array<{
    task_log_id: string
    task_id: string
    task_name: string
    actual_hours: number
    importance_multiplier: number
    weighted_hours: number
    applied_rate: number
    rate_source: 'catalog_minimum' | 'employee_rate' | 'employee_task_override' | 'variable_pool'
    task_minimum_rate_period_id: string
    catalog_minimum_hourly_rate: number
    employee_floor_hourly_rate: number
    guaranteed_hourly_rate: number
    minimum_amount: number
    dynamic_supplement: number
    effective_hourly_rate: number
    amount: number
  }>
}

function allocateVariablePool(rows: DraftStaffRow[], targetPool: number) {
  const eligible = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.bonus_eligible && row.weighted_hours > 0)

  const totalWeight = eligible.reduce((sum, item) => sum + item.row.weighted_hours, 0)
  const targetCents = Math.max(0, Math.round(round2(targetPool) * 100))

  if (!eligible.length || totalWeight <= 0 || targetCents <= 0) {
    for (const row of rows) {
      row.bonus_weight_share_percent = 0
      row.performance_bonus = 0
      row.dynamic_weight_share_percent = 0
      row.dynamic_task_supplement = 0
      row.task_compensation = 0
      row.guaranteed_compensation = round2(row.fixed_monthly_base)
      row.calculated_salary = round2(row.fixed_monthly_base)
    }
    return 0
  }

  const allocations = eligible.map(({ row, index }) => {
    const exactCents = (targetCents * row.weighted_hours) / totalWeight
    const floorCents = Math.floor(exactCents)
    return {
      index,
      exactCents,
      cents: floorCents,
      fraction: exactCents - floorCents,
    }
  })

  let remaining = targetCents - allocations.reduce((sum, item) => sum + item.cents, 0)
  allocations.sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (let i = 0; i < allocations.length && remaining > 0; i += 1) {
    allocations[i].cents += 1
    remaining -= 1
    if (i === allocations.length - 1 && remaining > 0) i = -1
  }

  const byIndex = new Map(allocations.map((item) => [item.index, item.cents]))

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    row.bonus_weight_share_percent =
      row.bonus_eligible && row.weighted_hours > 0
        ? round2((row.weighted_hours / totalWeight) * 100)
        : 0
    row.dynamic_weight_share_percent = row.bonus_weight_share_percent
    row.performance_bonus = 0
    row.dynamic_task_supplement = round2((byIndex.get(index) ?? 0) / 100)
    row.task_compensation = row.dynamic_task_supplement
    row.guaranteed_compensation = round2(row.fixed_monthly_base)
    row.calculated_salary = round2(row.fixed_monthly_base + row.task_compensation)

    const eligibleLines = row.task_rate_breakdown.filter((line) => line.weighted_hours > 0)
    const lineWeight = eligibleLines.reduce((sum, line) => sum + line.weighted_hours, 0)
    let remainingCents = byIndex.get(index) ?? 0
    for (let lineIndex = 0; lineIndex < eligibleLines.length; lineIndex += 1) {
      const line = eligibleLines[lineIndex]
      const cents = lineIndex === eligibleLines.length - 1
        ? remainingCents
        : Math.min(remainingCents, Math.floor(((byIndex.get(index) ?? 0) * line.weighted_hours) / lineWeight))
      remainingCents -= cents
      line.dynamic_supplement = round2(cents / 100)
      line.amount = line.dynamic_supplement
      line.effective_hourly_rate = line.actual_hours > 0 ? round2(line.amount / line.actual_hours) : 0
    }
  }

  return round2(
    rows.reduce((sum, row) => sum + Number(row.dynamic_task_supplement || 0), 0)
  )
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
    const action = cleanString(body?.action, 60)

    if (action === 'save_compensation_profile') {
      return json(410, {
        ok: false,
        error: 'EFFECTIVE_RATE_PERIOD_REQUIRED',
        details: 'Use Compensation Rates to create an effective-dated rate period.',
      })
    }

    if (action === 'refresh_draft') {
      const monthStart = normalizeMonthStart(body?.monthStart ?? body?.month_start)
      const variablePayrollPercent = parsePercent(
        body?.variablePayrollPercent ?? body?.variable_payroll_percent ??
          body?.bonusPoolPercent ?? body?.bonus_pool_percent ?? 30
      )
      const safetyReservePercent = parsePercent(
        body?.safetyReservePercent ?? body?.safety_reserve_percent ?? 20
      )

      if (!monthStart) return json(400, { ok: false, error: 'INVALID_MONTH' })
      if (monthStart < PAYROLL_BASELINE_MONTH) {
        return json(400, {
          ok: false,
          error: 'BEFORE_RELIABLE_BASELINE',
          details: 'Staff Payroll financial snapshots start from August 2026.',
        })
      }
      if (monthStart >= currentCairoMonthStart()) {
        return json(400, {
          ok: false,
          error: 'MONTH_NOT_CLOSED',
          details: 'Salary calculation is available for completed months only.',
        })
      }
      if (variablePayrollPercent === null) {
        return json(400, { ok: false, error: 'INVALID_VARIABLE_PAYROLL_PERCENT' })
      }
      if (safetyReservePercent === null) {
        return json(400, { ok: false, error: 'INVALID_SAFETY_RESERVE_PERCENT' })
      }

      const { data: existingSnapshot, error: existingSnapshotError } = await admin
        .from('staff_payroll_monthly_snapshots')
        .select('id,status')
        .eq('month_start', monthStart)
        .maybeSingle()

      if (existingSnapshotError) {
        const message = existingSnapshotError.message ?? String(existingSnapshotError)
        if (looksLikeMigrationMissing(message)) {
          return json(500, {
            ok: false,
            error: 'MIGRATION_REQUIRED',
            details: 'Required database changes are not available yet. Deploy the latest database changes, then try again.',
          })
        }
        return json(500, {
          ok: false,
          error: 'SNAPSHOT_LOOKUP_FAILED',
          details: message,
        })
      }

      if (existingSnapshot?.status && existingSnapshot.status !== 'draft') {
        return json(409, {
          ok: false,
          error: 'PAYROLL_MONTH_LOCKED',
          details: 'This payroll month is no longer a draft and cannot be recalculated.',
        })
      }

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
        adjustmentsResult,
        taskMinimumRatesResult,
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
          .from('staff_compensation_rate_periods')
          .select(
            'id,staff_user_id,effective_from,effective_until,fixed_monthly_base,weighted_hour_rate,bonus_eligible,updated_at,staff_compensation_task_rates(id,task_id,weighted_hour_rate,updated_at)'
          )
          .lte('effective_from', monthStart)
          .or(`effective_until.is.null,effective_until.gt.${monthStart}`)
          .limit(10000),
        admin
          .from('profiles')
          .select('user_id,email,first_name,last_name,role')
          .in('role', [...STAFF_ROLES])
          .limit(10000),
        admin
          .from('staff_payroll_monthly_adjustments')
          .select('id,month_start,staff_user_id,adjustment_type,amount,reason,status,created_at,created_by_name_snapshot')
          .eq('month_start', monthStart)
          .eq('status', 'active')
          .limit(10000),
        admin
          .from('staff_payroll_task_minimum_rate_periods')
          .select('id,task_id,effective_from,effective_until,minimum_hourly_rate,updated_at')
          .lte('effective_from', monthStart)
          .or(`effective_until.is.null,effective_until.gt.${monthStart}`)
          .limit(10000),
      ])

      const sourceError =
        paymentsResult.error?.message ||
        refundsResult.error?.message ||
        expensesResult.error?.message ||
        logsResult.error?.message ||
        compensationResult.error?.message ||
        staffResult.error?.message ||
        adjustmentsResult.error?.message ||
        taskMinimumRatesResult.error?.message ||
        ''

      if (sourceError) {
        return json(500, {
          ok: false,
          error: looksLikeMigrationMissing(sourceError)
            ? 'MIGRATION_REQUIRED'
            : 'PAYROLL_SOURCE_LOAD_FAILED',
          details: looksLikeMigrationMissing(sourceError)
            ? 'Required database changes are not available yet. Deploy the latest database changes, then try again.'
            : sourceError,
        })
      }

      const payments = (paymentsResult.data ?? []) as any[]
      const refunds = (refundsResult.data ?? []) as any[]
      const expenses = (expensesResult.data ?? []) as any[]
      const logs = (logsResult.data ?? []) as any[]
      const compensationProfiles = (compensationResult.data ?? []) as any[]
      const staffProfiles = (staffResult.data ?? []) as any[]
      const adjustments = (adjustmentsResult.data ?? []) as any[]
      const sourceHashes = buildPayrollSourceHashes({
        payments,
        refunds,
        expenses,
        logs,
        compensationProfiles,
        staffProfiles,
        adjustments,
        // Legacy 2H rates are retained for history, but are not an input to 2I.
        taskMinimumRates: [],
      })

      const membershipRevenue = round2(
        payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      )
      const paidMembershipRefunds = round2(
        refunds.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      )
      const netMembershipRevenue = round2(
        membershipRevenue - paidMembershipRefunds
      )

      let eligibleOperatingExpenses = 0
      let excludedPayrollExpenses = 0
      let eligibleExpenseCount = 0
      let excludedPayrollExpenseCount = 0

      for (const expense of expenses) {
        const amount = Number(expense.amount ?? 0)
        if (!Number.isFinite(amount)) continue
        const categoryKey = String(expense.category_key ?? '')

        if (PAYROLL_EXPENSE_CATEGORY_KEYS.has(categoryKey)) {
          excludedPayrollExpenses += amount
          excludedPayrollExpenseCount += 1
        } else {
          eligibleOperatingExpenses += amount
          eligibleExpenseCount += 1
        }
      }

      eligibleOperatingExpenses = round2(eligibleOperatingExpenses)
      excludedPayrollExpenses = round2(excludedPayrollExpenses)

      const operatingResultBeforePayroll = round2(
        netMembershipRevenue - eligibleOperatingExpenses
      )

      const staffMap = new Map<string, any>(
        staffProfiles.map((profile) => [String(profile.user_id), profile])
      )
      const compensationMap = new Map<string, any>(
        compensationProfiles.map((profile) => [
          String(profile.staff_user_id),
          profile,
        ])
      )

      type Stats = {
        activeTaskCount: number
        missingHoursTaskCount: number
        actualHours: number
        weightedHours: number
        taskCompensation: number
        taskRateBreakdown: DraftStaffRow['task_rate_breakdown']
      }

      const statsMap = new Map<string, Stats>()
      for (const log of logs) {
        const staffUserId = String(log.staff_user_id ?? '')
        if (!staffUserId) continue

        const stats = statsMap.get(staffUserId) ?? {
          activeTaskCount: 0,
          missingHoursTaskCount: 0,
          actualHours: 0,
          weightedHours: 0,
          taskCompensation: 0,
          taskRateBreakdown: [],
        }

        stats.activeTaskCount += 1
        if (log.actual_hours === null || log.actual_hours === undefined) {
          stats.missingHoursTaskCount += 1
        } else {
          const hours = Number(log.actual_hours ?? 0)
          if (Number.isFinite(hours)) stats.actualHours += hours
        }

        const weighted = Number(log.weighted_hours ?? 0)
        if (Number.isFinite(weighted)) stats.weightedHours += weighted

        const taskId = String(log.task_id ?? '')
        const actualHours = round2(Number(log.actual_hours ?? 0))
        const importanceMultiplier = round2(
          Number(log.importance_multiplier_snapshot ?? 0)
        )
        const weightedHours = round2(Number(log.weighted_hours ?? 0))
        stats.taskRateBreakdown.push({
          task_log_id: String(log.id ?? ''),
          task_id: taskId,
          task_name: String(log.task_name_snapshot ?? 'Task'),
          actual_hours: actualHours,
          importance_multiplier: importanceMultiplier,
          weighted_hours: weightedHours,
          applied_rate: 0,
          rate_source: 'variable_pool',
          task_minimum_rate_period_id: '',
          catalog_minimum_hourly_rate: 0,
          employee_floor_hourly_rate: 0,
          guaranteed_hourly_rate: 0,
          minimum_amount: 0,
          dynamic_supplement: 0,
          effective_hourly_rate: 0,
          amount: 0,
        })
        statsMap.set(staffUserId, stats)
      }

      const staffIds = new Set<string>()
      for (const staffUserId of statsMap.keys()) staffIds.add(staffUserId)
      for (const profile of compensationProfiles) {
        const staffUserId = String(profile.staff_user_id ?? '')
        if (staffUserId && staffMap.has(staffUserId)) staffIds.add(staffUserId)
      }
      for (const adjustment of adjustments) {
        const staffUserId = String(adjustment.staff_user_id ?? '')
        if (staffUserId && staffMap.has(staffUserId)) staffIds.add(staffUserId)
      }

      const draftRows: DraftStaffRow[] = []

      for (const staffUserId of staffIds) {
        const profile = staffMap.get(staffUserId)
        if (!profile) continue

        const compensation = compensationMap.get(staffUserId)
        const configured = Boolean(compensation)
        const stats = statsMap.get(staffUserId) ?? {
          activeTaskCount: 0,
          missingHoursTaskCount: 0,
          actualHours: 0,
          weightedHours: 0,
          taskCompensation: 0,
          taskRateBreakdown: [],
        }

        const fixedMonthlyBase = configured
          ? round2(Number(compensation.fixed_monthly_base ?? 0))
          : 0
        const weightedHourRate = configured
          ? round2(Number(compensation.weighted_hour_rate ?? 0))
          : 0
        const bonusEligible = configured
          ? Boolean(compensation.bonus_eligible)
          : false
        const actualHours = round2(stats.actualHours)
        const weightedHours = round2(stats.weightedHours)
        const taskCompensation = 0
        const guaranteedCompensation = fixedMonthlyBase

        draftRows.push({
          staff_user_id: staffUserId,
          staff_name_snapshot: staffName(profile),
          staff_role_snapshot: profile.role ? String(profile.role) : null,
          compensation_configured: configured,
          compensation_rate_period_id: configured
            ? String(compensation.id)
            : null,
          compensation_effective_from: configured
            ? String(compensation.effective_from)
            : null,
          compensation_effective_until: configured && compensation.effective_until
            ? String(compensation.effective_until)
            : null,
          fixed_monthly_base: fixedMonthlyBase,
          weighted_hour_rate: weightedHourRate,
          bonus_eligible: bonusEligible,
          active_task_count: stats.activeTaskCount,
          missing_hours_task_count: stats.missingHoursTaskCount,
          actual_hours: actualHours,
          weighted_hours: weightedHours,
          task_compensation: taskCompensation,
          minimum_task_compensation: taskCompensation,
          dynamic_task_supplement: 0,
          dynamic_weight_share_percent: 0,
          guaranteed_compensation: guaranteedCompensation,
          bonus_weight_share_percent: 0,
          performance_bonus: 0,
          salary_before_adjustments: guaranteedCompensation,
          manual_bonus: 0,
          manual_deduction: 0,
          net_manual_adjustment: 0,
          calculated_salary: guaranteedCompensation,
          adjustment_breakdown: [],
          task_rate_breakdown: stats.taskRateBreakdown,
        })
      }

      draftRows.sort((a, b) =>
        a.staff_name_snapshot.localeCompare(b.staff_name_snapshot)
      )

      const fixedBasePayroll = round2(
        draftRows.reduce(
          (sum, row) => sum + Number(row.guaranteed_compensation || 0),
          0
        )
      )
      const availableResultAfterGuaranteedPayroll = round2(
        operatingResultBeforePayroll - fixedBasePayroll
      )
      const manualBonusCommitment = round2(adjustments.filter((adjustment) => adjustment.adjustment_type === 'bonus').reduce((sum, adjustment) => sum + Number(adjustment.amount ?? 0), 0))
      const safetyReserveAmount = round2(Math.max(0, availableResultAfterGuaranteedPayroll) * (safetyReservePercent / 100))
      const potentialVariablePool = round2(
        Math.max(0, availableResultAfterGuaranteedPayroll - manualBonusCommitment - safetyReserveAmount) *
          (variablePayrollPercent / 100)
      )
      const variablePayrollPool = allocateVariablePool(draftRows, potentialVariablePool)
      const variablePoolWeightedHours = round2(
        draftRows
          .filter((row) => row.bonus_eligible && row.weighted_hours > 0)
          .reduce((sum, row) => sum + row.weighted_hours, 0)
      )
      const variableWeightedHourValue = variablePoolWeightedHours > 0
        ? Math.round((variablePayrollPool / variablePoolWeightedHours) * 10000) / 10000
        : 0
      const adjustmentsByStaff = new Map<string, any[]>()
      for (const adjustment of adjustments) {
        const staffUserId = String(adjustment.staff_user_id ?? '')
        const list = adjustmentsByStaff.get(staffUserId) ?? []
        list.push(adjustment)
        adjustmentsByStaff.set(staffUserId, list)
      }

      for (const row of draftRows) {
        const staffAdjustments = adjustmentsByStaff.get(row.staff_user_id) ?? []
        row.salary_before_adjustments = round2(row.calculated_salary)
        row.manual_bonus = round2(
          staffAdjustments
            .filter((adjustment) => adjustment.adjustment_type === 'bonus')
            .reduce((sum, adjustment) => sum + Number(adjustment.amount ?? 0), 0)
        )
        row.manual_deduction = round2(
          staffAdjustments
            .filter((adjustment) => adjustment.adjustment_type === 'deduction')
            .reduce((sum, adjustment) => sum + Number(adjustment.amount ?? 0), 0)
        )
        row.net_manual_adjustment = round2(row.manual_bonus - row.manual_deduction)
        row.calculated_salary = round2(
          row.salary_before_adjustments + row.net_manual_adjustment
        )
        row.adjustment_breakdown = staffAdjustments
          .map((adjustment) => ({
            adjustment_id: String(adjustment.id ?? ''),
            adjustment_type: String(adjustment.adjustment_type) as 'bonus' | 'deduction',
            amount: round2(Number(adjustment.amount ?? 0)),
            reason: String(adjustment.reason ?? ''),
            created_at: String(adjustment.created_at ?? ''),
            created_by_name_snapshot: String(
              adjustment.created_by_name_snapshot ?? 'Super Admin'
            ),
          }))
          .sort((a, b) => a.adjustment_id.localeCompare(b.adjustment_id))
      }

      const negativeSalaryRows = draftRows.filter((row) => row.calculated_salary < 0)
      if (negativeSalaryRows.length) {
        return json(409, {
          ok: false,
          error: 'DEDUCTIONS_EXCEED_SALARY',
          details: `Deductions exceed salary before adjustments for: ${negativeSalaryRows
            .map((row) => row.staff_name_snapshot)
            .join(', ')}. Reduce or void the deduction before recalculating.`,
        })
      }

      const salaryBeforeAdjustmentsTotal = round2(
        draftRows.reduce(
          (sum, row) => sum + Number(row.salary_before_adjustments || 0),
          0
        )
      )
      const manualBonusTotal = round2(
        draftRows.reduce((sum, row) => sum + Number(row.manual_bonus || 0), 0)
      )
      const manualDeductionTotal = round2(
        draftRows.reduce((sum, row) => sum + Number(row.manual_deduction || 0), 0)
      )
      const netManualAdjustmentTotal = round2(
        manualBonusTotal - manualDeductionTotal
      )
      const calculatedPayrollTotal = round2(
        draftRows.reduce(
          (sum, row) => sum + Number(row.calculated_salary || 0),
          0
        )
      )
      const missingHoursTaskCount = draftRows.reduce(
        (sum, row) => sum + row.missing_hours_task_count,
        0
      )
      const unconfiguredStaffCount = draftRows.filter(
        (row) => !row.compensation_configured
      ).length

      const now = new Date().toISOString()
      const snapshotPayload = {
        month_start: monthStart,
        status: 'draft',
        eligible_revenue_scope: 'membership_only',
        rate_model: 'variable_payroll_pool',
        bonus_pool_percent: variablePayrollPercent,
        variable_payroll_percent: variablePayrollPercent,
        safety_reserve_percent: safetyReservePercent,
        safety_reserve_amount: safetyReserveAmount,
        membership_revenue: membershipRevenue,
        membership_payment_count: payments.length,
        paid_membership_refunds: paidMembershipRefunds,
        paid_membership_refund_count: refunds.length,
        net_membership_revenue: netMembershipRevenue,
        eligible_operating_expenses: eligibleOperatingExpenses,
        eligible_expense_count: eligibleExpenseCount,
        excluded_payroll_expenses: excludedPayrollExpenses,
        excluded_payroll_expense_count: excludedPayrollExpenseCount,
        operating_result_before_payroll: operatingResultBeforePayroll,
        guaranteed_payroll: fixedBasePayroll,
        fixed_base_payroll: fixedBasePayroll,
        minimum_task_payroll: 0,
        available_result_after_guaranteed_payroll:
          availableResultAfterGuaranteedPayroll,
        performance_bonus_pool: 0,
        dynamic_task_supplement_pool: variablePayrollPool,
        variable_payroll_pool: variablePayrollPool,
        variable_pool_weighted_hours: variablePoolWeightedHours,
        variable_weighted_hour_value: variableWeightedHourValue,
        salary_before_adjustments_total: salaryBeforeAdjustmentsTotal,
        manual_bonus_total: manualBonusTotal,
        manual_deduction_total: manualDeductionTotal,
        net_manual_adjustment_total: netManualAdjustmentTotal,
        calculated_payroll_total: calculatedPayrollTotal,
        staff_count: draftRows.length,
        missing_hours_task_count: missingHoursTaskCount,
        unconfigured_staff_count: unconfiguredStaffCount,
        calculated_at: now,
        calculated_by: actor.actorId,
        source_data_as_of: now,
        financial_source_hash: sourceHashes.financial_source_hash,
        task_source_hash: sourceHashes.task_source_hash,
        compensation_source_hash: sourceHashes.compensation_source_hash,
        staff_source_hash: sourceHashes.staff_source_hash,
        updated_by: actor.actorId,
      }

      const draftSnapshotHash = buildPayrollSnapshotHash(snapshotPayload)

      const { data: snapshot, error: snapshotSaveError } = await admin
        .from('staff_payroll_monthly_snapshots')
        .upsert(snapshotPayload, { onConflict: 'month_start' })
        .select('id,month_start,status')
        .maybeSingle()

      if (snapshotSaveError || !snapshot?.id) {
        const message = snapshotSaveError?.message ?? 'Snapshot was not returned.'
        return json(500, {
          ok: false,
          error: looksLikeMigrationMissing(message)
            ? 'MIGRATION_REQUIRED'
            : 'SNAPSHOT_SAVE_FAILED',
          details: looksLikeMigrationMissing(message)
            ? 'Required database changes are not available yet. Deploy the latest database changes, then try again.'
            : message,
        })
      }

      const { error: deleteError } = await admin
        .from('staff_payroll_monthly_calculations')
        .delete()
        .eq('snapshot_id', snapshot.id)

      if (deleteError) {
        return json(500, {
          ok: false,
          error: 'OLD_DRAFT_CALCULATIONS_CLEAR_FAILED',
          details: deleteError.message,
        })
      }

      if (draftRows.length) {
        const { error: insertError } = await admin
          .from('staff_payroll_monthly_calculations')
          .insert(
            draftRows.map((row) => ({
              snapshot_id: snapshot.id,
              month_start: monthStart,
              ...row,
            }))
          )

        if (insertError) {
          return json(500, {
            ok: false,
            error: 'DRAFT_CALCULATIONS_SAVE_FAILED',
            details: insertError.message,
          })
        }
      }

      const draftCalculationHash = buildPayrollCalculationsHash(draftRows)
      const { error: integrityUpdateError } = await admin
        .from('staff_payroll_monthly_snapshots')
        .update({
          draft_snapshot_hash: draftSnapshotHash,
          draft_calculation_hash: draftCalculationHash,
          updated_by: actor.actorId,
        })
        .eq('id', snapshot.id)
        .eq('status', 'draft')

      if (integrityUpdateError) {
        const message = integrityUpdateError.message ?? String(integrityUpdateError)
        return json(500, {
          ok: false,
          error: looksLikeMigrationMissing(message)
            ? 'MIGRATION_REQUIRED'
            : 'DRAFT_INTEGRITY_SAVE_FAILED',
          details: looksLikeMigrationMissing(message)
            ? 'Required database changes are not available yet. Deploy the latest database changes, then recalculate the payroll draft.'
            : message,
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: null,
        action: 'staff_payroll_draft_recalculated',
        action_details: {
          snapshot_id: snapshot.id,
          month_start: monthStart,
          eligible_revenue_scope: 'membership_only',
          external_income_included: false,
          store_revenue_included: false,
          funding_included: false,
          membership_revenue: membershipRevenue,
          paid_membership_refunds: paidMembershipRefunds,
          eligible_operating_expenses: eligibleOperatingExpenses,
          excluded_payroll_expenses: excludedPayrollExpenses,
          excluded_payroll_expense_categories: [
            'coaches',
            'reception',
            'assistants',
            'bonuses',
          ],
          operating_result_before_payroll: operatingResultBeforePayroll,
          guaranteed_payroll: fixedBasePayroll,
          fixed_base_payroll: fixedBasePayroll,
          available_result_after_guaranteed_payroll:
            availableResultAfterGuaranteedPayroll,
          variable_payroll_percent: variablePayrollPercent,
          safety_reserve_percent: safetyReservePercent,
          safety_reserve_amount: safetyReserveAmount,
          variable_payroll_pool: variablePayrollPool,
          variable_pool_weighted_hours: variablePoolWeightedHours,
          variable_weighted_hour_value: variableWeightedHourValue,
          salary_before_adjustments_total: salaryBeforeAdjustmentsTotal,
          manual_bonus_total: manualBonusTotal,
          manual_deduction_total: manualDeductionTotal,
          net_manual_adjustment_total: netManualAdjustmentTotal,
          calculated_payroll_total: calculatedPayrollTotal,
          staff_count: draftRows.length,
          missing_hours_task_count: missingHoursTaskCount,
          unconfigured_staff_count: unconfiguredStaffCount,
          source_integrity: {
            ...sourceHashes,
            draft_snapshot_hash: draftSnapshotHash,
            draft_calculation_hash: draftCalculationHash,
          },
          note_scope:
            'Draft calculation only. No payroll approval, salary payment or payslip was created.',
        },
      })

      revalidatePath('/admin/staff-payroll/calculation')
      return json(200, {
        ok: true,
        snapshotId: snapshot.id,
        monthStart,
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
