// Staff Payroll — Hybrid Official Engine 1A
// Draft-only endpoint. It writes the official payroll draft tables but approval
// is blocked by the 1A migration until the later approval-integration lot.
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
const DEFAULT_COACH_RATE = 400
const DEFAULT_HEAD_COACH_RATE = 300
const DEFAULT_SAFETY_RESERVE_PERCENT = 0
const DEFAULT_RESIDUAL_POOL_PERCENT = 80

function json(status: number, body: any) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function round2(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseMoney(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return null
  return round2(numberValue)
}

function parsePercent(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) return null
  return round2(numberValue)
}

function cleanString(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
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
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
}

function isCoachingLog(log: any) {
  return String(log?.area_name_snapshot ?? '').trim().toLowerCase() === 'coaching'
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // Audit must never break a draft calculation.
  }
}

function staffName(profile: any) {
  const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
  return name || profile?.email || String(profile?.user_id ?? '').slice(0, 8) || 'Staff'
}

function looksLikeMigrationMissing(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('coach_session_rate') ||
    lower.includes('head_coach_session_rate') ||
    lower.includes('guaranteed_coaching_payroll') ||
    lower.includes('coaching_guarantee') ||
    lower.includes('non_coaching_weighted_hours') ||
    lower.includes('non_coaching_variable_pay') ||
    lower.includes('does not exist')
  )
}

type TaskBreakdown = {
  task_log_id: string
  task_id: string
  task_name: string
  work_quantity: number
  is_coaching: boolean
  coaching_sessions: number
  actual_hours: number
  importance_multiplier: number
  weighted_hours: number
  applied_rate: number
  rate_source: 'variable_pool'
  task_minimum_rate_period_id: string
  catalog_minimum_hourly_rate: number
  employee_floor_hourly_rate: number
  guaranteed_hourly_rate: number
  minimum_amount: number
  dynamic_supplement: number
  effective_hourly_rate: number
  amount: number
}

type DraftRow = {
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
  coaching_sessions: number
  coaching_session_rate: number
  coaching_guarantee: number
  non_coaching_weighted_hours: number
  non_coaching_variable_pay: number
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
  task_rate_breakdown: TaskBreakdown[]
}

function allocateByWeights(rows: DraftRow[], targetPool: number) {
  const eligible = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.bonus_eligible && row.non_coaching_weighted_hours > 0)

  const totalWeight = eligible.reduce((sum, item) => sum + item.row.non_coaching_weighted_hours, 0)
  const targetCents = Math.max(0, Math.round(round2(targetPool) * 100))
  const centsByIndex = new Map<number, number>()

  if (!eligible.length || totalWeight <= 0 || targetCents <= 0) {
    return { centsByIndex, allocated: 0, totalWeight }
  }

  const allocations = eligible.map(({ row, index }) => {
    const exact = (targetCents * row.non_coaching_weighted_hours) / totalWeight
    const cents = Math.floor(exact)
    return { index, cents, fraction: exact - cents }
  })

  let remaining = targetCents - allocations.reduce((sum, item) => sum + item.cents, 0)
  allocations.sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < allocations.length && remaining > 0; i += 1) {
    allocations[i].cents += 1
    remaining -= 1
    if (i === allocations.length - 1 && remaining > 0) i = -1
  }
  allocations.forEach((item) => centsByIndex.set(item.index, item.cents))
  return {
    centsByIndex,
    allocated: round2(Array.from(centsByIndex.values()).reduce((sum, cents) => sum + cents, 0) / 100),
    totalWeight,
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED', details: actor.error })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })
    if (actor.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const body = await req.json().catch(() => ({} as any))
    if (cleanString(body?.action, 60) !== 'refresh_hybrid_draft') {
      return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
    }

    const monthStart = normalizeMonthStart(body?.monthStart ?? body?.month_start)
    const coachRate = parseMoney(body?.coachRate ?? body?.coach_session_rate, DEFAULT_COACH_RATE)
    const headCoachRate = parseMoney(body?.headCoachRate ?? body?.head_coach_session_rate, DEFAULT_HEAD_COACH_RATE)
    const safetyReservePercent = parsePercent(
      body?.safetyReservePercent ?? body?.safety_reserve_percent,
      DEFAULT_SAFETY_RESERVE_PERCENT
    )
    const residualPoolPercent = parsePercent(
      body?.residualPoolPercent ?? body?.variable_payroll_percent,
      DEFAULT_RESIDUAL_POOL_PERCENT
    )

    if (!monthStart) return json(400, { ok: false, error: 'INVALID_MONTH' })
    if (monthStart < PAYROLL_BASELINE_MONTH) return json(400, { ok: false, error: 'BEFORE_RELIABLE_BASELINE' })
    if (monthStart >= currentCairoMonthStart()) return json(400, { ok: false, error: 'MONTH_NOT_CLOSED' })
    if (coachRate === null) return json(400, { ok: false, error: 'INVALID_COACH_RATE' })
    if (headCoachRate === null) return json(400, { ok: false, error: 'INVALID_HEAD_COACH_RATE' })
    if (safetyReservePercent === null) return json(400, { ok: false, error: 'INVALID_SAFETY_RESERVE_PERCENT' })
    if (residualPoolPercent === null) return json(400, { ok: false, error: 'INVALID_RESIDUAL_POOL_PERCENT' })

    const { data: existingSnapshot, error: snapshotLookupError } = await admin
      .from('staff_payroll_monthly_snapshots')
      .select('id,status')
      .eq('month_start', monthStart)
      .maybeSingle()

    if (snapshotLookupError) return json(500, { ok: false, error: 'SNAPSHOT_LOOKUP_FAILED', details: snapshotLookupError.message })
    if (existingSnapshot?.status && existingSnapshot.status !== 'draft') {
      return json(409, { ok: false, error: 'PAYROLL_MONTH_LOCKED' })
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
    ] = await Promise.all([
      admin.from('subscription_payments').select('id,amount').gte('paid_at', startISO).lt('paid_at', endISO).limit(100000),
      admin.from('membership_refunds').select('id,amount').eq('status', 'paid').gte('paid_at', startISO).lt('paid_at', endISO).limit(100000),
      admin.from('expenses').select('id,date,category_key,amount').gte('date', monthStart).lt('date', nextMonth).limit(100000),
      admin.from('staff_monthly_task_logs')
        .select('id,staff_user_id,task_id,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot,work_quantity,actual_hours,weighted_hours,note,updated_at,voided_at')
        .eq('month_start', monthStart).is('voided_at', null).limit(100000),
      admin.from('staff_compensation_rate_periods')
        .select('id,staff_user_id,effective_from,effective_until,fixed_monthly_base,weighted_hour_rate,bonus_eligible,updated_at,staff_compensation_task_rates(id,task_id,weighted_hour_rate,updated_at)')
        .lte('effective_from', monthStart)
        .or(`effective_until.is.null,effective_until.gt.${monthStart}`)
        .limit(10000),
      admin.from('profiles').select('user_id,email,first_name,last_name,role').in('role', [...STAFF_ROLES]).limit(10000),
      admin.from('staff_payroll_monthly_adjustments')
        .select('id,month_start,staff_user_id,adjustment_type,amount,reason,status,created_at,created_by_name_snapshot')
        .eq('month_start', monthStart).eq('status', 'active').limit(10000),
    ])

    const sourceError =
      paymentsResult.error?.message ||
      refundsResult.error?.message ||
      expensesResult.error?.message ||
      logsResult.error?.message ||
      compensationResult.error?.message ||
      staffResult.error?.message ||
      adjustmentsResult.error?.message ||
      ''

    if (sourceError) {
      return json(500, {
        ok: false,
        error: looksLikeMigrationMissing(sourceError) ? 'MIGRATION_REQUIRED' : 'PAYROLL_SOURCE_LOAD_FAILED',
        details: sourceError,
      })
    }

    const payments = paymentsResult.data ?? []
    const refunds = refundsResult.data ?? []
    const expenses = expensesResult.data ?? []
    const logs = logsResult.data ?? []
    const compensationProfiles = compensationResult.data ?? []
    const staffProfiles = staffResult.data ?? []
    const adjustments = adjustmentsResult.data ?? []

    const sourceHashes = buildPayrollSourceHashes({
      payments,
      refunds,
      expenses,
      logs,
      compensationProfiles,
      staffProfiles,
      adjustments,
      taskMinimumRates: [],
    })

    const membershipRevenue = round2(payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0))
    const paidMembershipRefunds = round2(refunds.reduce((sum, row) => sum + Number(row.amount ?? 0), 0))
    const netMembershipRevenue = round2(membershipRevenue - paidMembershipRefunds)

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
    const operatingResultBeforePayroll = round2(netMembershipRevenue - eligibleOperatingExpenses)

    const staffMap = new Map(staffProfiles.map((row) => [String(row.user_id), row]))
    const compensationMap = new Map(compensationProfiles.map((row) => [String(row.staff_user_id), row]))

    type Stats = {
      activeTaskCount: number
      missingHoursTaskCount: number
      actualHours: number
      weightedHours: number
      coachingSessions: number
      nonCoachingWeightedHours: number
      missingCoachingQuantity: number
      taskRateBreakdown: TaskBreakdown[]
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
        coachingSessions: 0,
        nonCoachingWeightedHours: 0,
        missingCoachingQuantity: 0,
        taskRateBreakdown: [],
      }

      stats.activeTaskCount += 1
      const actualHours = Number(log.actual_hours ?? 0)
      if (log.actual_hours === null || log.actual_hours === undefined) stats.missingHoursTaskCount += 1
      else if (Number.isFinite(actualHours)) stats.actualHours += actualHours

      const weightedHours = Number(log.weighted_hours ?? 0)
      if (Number.isFinite(weightedHours)) stats.weightedHours += weightedHours

      const coaching = isCoachingLog(log)
      const quantity = Number(log.work_quantity)
      if (coaching) {
        if (Number.isFinite(quantity) && quantity > 0) stats.coachingSessions += quantity
        else stats.missingCoachingQuantity += 1
      } else if (Number.isFinite(weightedHours) && weightedHours > 0) {
        stats.nonCoachingWeightedHours += weightedHours
      }

      stats.taskRateBreakdown.push({
        task_log_id: String(log.id ?? ''),
        task_id: String(log.task_id ?? ''),
        task_name: String(log.task_name_snapshot ?? 'Task'),
        work_quantity: Number.isFinite(quantity) ? round2(quantity) : 0,
        is_coaching: coaching,
        coaching_sessions: coaching && Number.isFinite(quantity) && quantity > 0 ? round2(quantity) : 0,
        actual_hours: round2(actualHours),
        importance_multiplier: round2(Number(log.importance_multiplier_snapshot ?? 0)),
        weighted_hours: round2(weightedHours),
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

    const missingCoachingQuantity = Array.from(statsMap.values()).reduce(
      (sum, stats) => sum + stats.missingCoachingQuantity,
      0
    )
    if (missingCoachingQuantity > 0) {
      return json(409, {
        ok: false,
        error: 'COACHING_SESSION_QUANTITY_REQUIRED',
        details: `${missingCoachingQuantity} coaching task line(s) do not have a positive session quantity.`,
      })
    }

    const staffIds = new Set<string>()
    for (const id of statsMap.keys()) staffIds.add(id)
    for (const row of compensationProfiles) {
      const id = String(row.staff_user_id ?? '')
      if (id && staffMap.has(id)) staffIds.add(id)
    }
    for (const row of adjustments) {
      const id = String(row.staff_user_id ?? '')
      if (id && staffMap.has(id)) staffIds.add(id)
    }

    const rows: DraftRow[] = []
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
        coachingSessions: 0,
        nonCoachingWeightedHours: 0,
        missingCoachingQuantity: 0,
        taskRateBreakdown: [],
      }

      const fixedMonthlyBase = round2(Number(compensation?.fixed_monthly_base ?? 0))
      const bonusEligible = Boolean(compensation?.bonus_eligible)
      const role = profile.role ? String(profile.role) : null
      const sessionRate =
        role === 'assistant_coach'
          ? 0
          : role === 'head_coach'
            ? headCoachRate
            : coachRate
      const coachingSessions = round2(stats.coachingSessions)
      const coachingGuarantee = round2(coachingSessions * sessionRate)

      rows.push({
        staff_user_id: staffUserId,
        staff_name_snapshot: staffName(profile),
        staff_role_snapshot: role,
        compensation_configured: configured,
        compensation_rate_period_id: compensation ? String(compensation.id) : null,
        compensation_effective_from: compensation ? String(compensation.effective_from) : null,
        compensation_effective_until: compensation?.effective_until ? String(compensation.effective_until) : null,
        fixed_monthly_base: fixedMonthlyBase,
        weighted_hour_rate: round2(Number(compensation?.weighted_hour_rate ?? 0)),
        bonus_eligible: bonusEligible,
        active_task_count: stats.activeTaskCount,
        missing_hours_task_count: stats.missingHoursTaskCount,
        actual_hours: round2(stats.actualHours),
        weighted_hours: round2(stats.weightedHours),
        coaching_sessions: coachingSessions,
        coaching_session_rate: sessionRate,
        coaching_guarantee: coachingGuarantee,
        non_coaching_weighted_hours: round2(stats.nonCoachingWeightedHours),
        non_coaching_variable_pay: 0,
        task_compensation: 0,
        minimum_task_compensation: 0,
        dynamic_task_supplement: 0,
        dynamic_weight_share_percent: 0,
        guaranteed_compensation: round2(fixedMonthlyBase + coachingGuarantee),
        bonus_weight_share_percent: 0,
        performance_bonus: 0,
        salary_before_adjustments: round2(fixedMonthlyBase + coachingGuarantee),
        manual_bonus: 0,
        manual_deduction: 0,
        net_manual_adjustment: 0,
        calculated_salary: round2(fixedMonthlyBase + coachingGuarantee),
        adjustment_breakdown: [],
        task_rate_breakdown: stats.taskRateBreakdown,
      })
    }

    rows.sort((a, b) => a.staff_name_snapshot.localeCompare(b.staff_name_snapshot))

    const fixedBasePayroll = round2(rows.reduce((sum, row) => sum + row.fixed_monthly_base, 0))
    const guaranteedCoachingPayroll = round2(rows.reduce((sum, row) => sum + row.coaching_guarantee, 0))
    const guaranteedPayroll = round2(fixedBasePayroll + guaranteedCoachingPayroll)
    const availableAfterGuarantees = round2(operatingResultBeforePayroll - guaranteedPayroll)

    if (availableAfterGuarantees < 0) {
      return json(409, {
        ok: false,
        error: 'HYBRID_GUARANTEES_EXCEED_RESULT',
        details: `Guaranteed payroll exceeds the operating result by ${round2(Math.abs(availableAfterGuarantees))} EGP.`,
      })
    }

    const manualBonusCommitment = round2(
      adjustments
        .filter((row) => row.adjustment_type === 'bonus')
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
    )
    const safetyReserveAmount = round2(Math.max(0, availableAfterGuarantees) * (safetyReservePercent / 100))
    const targetPool = round2(
      Math.max(0, availableAfterGuarantees - manualBonusCommitment - safetyReserveAmount) *
        (residualPoolPercent / 100)
    )

    const allocation = allocateByWeights(rows, targetPool)
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const cents = allocation.centsByIndex.get(index) ?? 0
      row.non_coaching_variable_pay = round2(cents / 100)
      row.task_compensation = row.non_coaching_variable_pay
      row.dynamic_task_supplement = row.non_coaching_variable_pay
      row.dynamic_weight_share_percent =
        allocation.totalWeight > 0 && row.bonus_eligible
          ? round2((row.non_coaching_weighted_hours / allocation.totalWeight) * 100)
          : 0
      row.bonus_weight_share_percent = row.dynamic_weight_share_percent
      row.salary_before_adjustments = round2(row.guaranteed_compensation + row.non_coaching_variable_pay)
      row.calculated_salary = row.salary_before_adjustments

      const eligibleLines = row.task_rate_breakdown.filter((line) => !line.is_coaching && line.weighted_hours > 0)
      const lineWeight = eligibleLines.reduce((sum, line) => sum + line.weighted_hours, 0)
      let remainingCents = cents
      for (let i = 0; i < eligibleLines.length; i += 1) {
        const line = eligibleLines[i]
        const lineCents =
          i === eligibleLines.length - 1
            ? remainingCents
            : Math.min(remainingCents, Math.floor((cents * line.weighted_hours) / lineWeight))
        remainingCents -= lineCents
        line.dynamic_supplement = round2(lineCents / 100)
        line.amount = line.dynamic_supplement
        line.effective_hourly_rate = line.actual_hours > 0 ? round2(line.amount / line.actual_hours) : 0
      }

      for (const line of row.task_rate_breakdown.filter((item) => item.is_coaching)) {
        line.applied_rate = row.coaching_session_rate
        line.minimum_amount = round2(line.coaching_sessions * row.coaching_session_rate)
        line.amount = line.minimum_amount
        line.effective_hourly_rate = line.actual_hours > 0 ? round2(line.amount / line.actual_hours) : 0
      }
    }

    const adjustmentsByStaff = new Map<string, any[]>()
    for (const adjustment of adjustments) {
      const id = String(adjustment.staff_user_id ?? '')
      const list = adjustmentsByStaff.get(id) ?? []
      list.push(adjustment)
      adjustmentsByStaff.set(id, list)
    }

    for (const row of rows) {
      const staffAdjustments = adjustmentsByStaff.get(row.staff_user_id) ?? []
      row.manual_bonus = round2(
        staffAdjustments
          .filter((item) => item.adjustment_type === 'bonus')
          .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
      )
      row.manual_deduction = round2(
        staffAdjustments
          .filter((item) => item.adjustment_type === 'deduction')
          .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
      )
      row.net_manual_adjustment = round2(row.manual_bonus - row.manual_deduction)
      row.calculated_salary = round2(row.salary_before_adjustments + row.net_manual_adjustment)
      row.adjustment_breakdown = staffAdjustments
        .map((item) => ({
          adjustment_id: String(item.id ?? ''),
          adjustment_type: String(item.adjustment_type) as 'bonus' | 'deduction',
          amount: round2(Number(item.amount ?? 0)),
          reason: String(item.reason ?? ''),
          created_at: String(item.created_at ?? ''),
          created_by_name_snapshot: String(item.created_by_name_snapshot ?? 'Super Admin'),
        }))
        .sort((a, b) => a.adjustment_id.localeCompare(b.adjustment_id))
    }

    const negativeSalaryRows = rows.filter((row) => row.calculated_salary < 0)
    if (negativeSalaryRows.length) {
      return json(409, {
        ok: false,
        error: 'DEDUCTIONS_EXCEED_SALARY',
        details: negativeSalaryRows.map((row) => row.staff_name_snapshot).join(', '),
      })
    }

    const salaryBeforeAdjustmentsTotal = round2(rows.reduce((sum, row) => sum + row.salary_before_adjustments, 0))
    const manualBonusTotal = round2(rows.reduce((sum, row) => sum + row.manual_bonus, 0))
    const manualDeductionTotal = round2(rows.reduce((sum, row) => sum + row.manual_deduction, 0))
    const netManualAdjustmentTotal = round2(manualBonusTotal - manualDeductionTotal)
    const calculatedPayrollTotal = round2(rows.reduce((sum, row) => sum + row.calculated_salary, 0))
    const missingHoursTaskCount = rows.reduce((sum, row) => sum + row.missing_hours_task_count, 0)
    const unconfiguredStaffCount = rows.filter((row) => !row.compensation_configured).length
    const coachSessionCount = round2(
      rows
        .filter((row) => row.staff_role_snapshot !== 'head_coach' && row.staff_role_snapshot !== 'assistant_coach')
        .reduce((sum, row) => sum + row.coaching_sessions, 0)
    )
    const headCoachSessionCount = round2(
      rows
        .filter((row) => row.staff_role_snapshot === 'head_coach')
        .reduce((sum, row) => sum + row.coaching_sessions, 0)
    )
    const variablePoolWeightedHours = round2(allocation.totalWeight)
    const variableWeightedHourValue =
      variablePoolWeightedHours > 0
        ? Math.round((allocation.allocated / variablePoolWeightedHours) * 10000) / 10000
        : 0

    const now = new Date().toISOString()
    const snapshotPayload = {
      month_start: monthStart,
      status: 'draft',
      eligible_revenue_scope: 'membership_only',
      rate_model: 'hybrid_payroll',
      bonus_pool_percent: residualPoolPercent,
      variable_payroll_percent: residualPoolPercent,
      safety_reserve_percent: safetyReservePercent,
      safety_reserve_amount: safetyReserveAmount,
      coach_session_rate: coachRate,
      head_coach_session_rate: headCoachRate,
      coach_session_count: coachSessionCount,
      head_coach_session_count: headCoachSessionCount,
      guaranteed_coaching_payroll: guaranteedCoachingPayroll,
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
      guaranteed_payroll: guaranteedPayroll,
      fixed_base_payroll: fixedBasePayroll,
      minimum_task_payroll: 0,
      available_result_after_guaranteed_payroll: availableAfterGuarantees,
      performance_bonus_pool: 0,
      dynamic_task_supplement_pool: allocation.allocated,
      variable_payroll_pool: allocation.allocated,
      variable_pool_weighted_hours: variablePoolWeightedHours,
      variable_weighted_hour_value: variableWeightedHourValue,
      salary_before_adjustments_total: salaryBeforeAdjustmentsTotal,
      manual_bonus_total: manualBonusTotal,
      manual_deduction_total: manualDeductionTotal,
      net_manual_adjustment_total: netManualAdjustmentTotal,
      calculated_payroll_total: calculatedPayrollTotal,
      staff_count: rows.length,
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
        error: looksLikeMigrationMissing(message) ? 'MIGRATION_REQUIRED' : 'SNAPSHOT_SAVE_FAILED',
        details: message,
      })
    }

    const { error: clearError } = await admin
      .from('staff_payroll_monthly_calculations')
      .delete()
      .eq('snapshot_id', snapshot.id)

    if (clearError) return json(500, { ok: false, error: 'OLD_DRAFT_CALCULATIONS_CLEAR_FAILED', details: clearError.message })

    if (rows.length) {
      const { error: insertError } = await admin
        .from('staff_payroll_monthly_calculations')
        .insert(rows.map((row) => ({ snapshot_id: snapshot.id, month_start: monthStart, ...row })))
      if (insertError) {
        return json(500, {
          ok: false,
          error: looksLikeMigrationMissing(insertError.message) ? 'MIGRATION_REQUIRED' : 'DRAFT_CALCULATIONS_SAVE_FAILED',
          details: insertError.message,
        })
      }
    }

    const draftCalculationHash = buildPayrollCalculationsHash(rows)
    const { error: integrityError } = await admin
      .from('staff_payroll_monthly_snapshots')
      .update({
        draft_snapshot_hash: draftSnapshotHash,
        draft_calculation_hash: draftCalculationHash,
        updated_by: actor.actorId,
      })
      .eq('id', snapshot.id)
      .eq('status', 'draft')

    if (integrityError) return json(500, { ok: false, error: 'DRAFT_INTEGRITY_SAVE_FAILED', details: integrityError.message })

    await safeAudit(admin, {
      actor_user_id: actor.actorId,
      target_user_id: null,
      action: 'staff_payroll_hybrid_draft_recalculated',
      action_details: {
        snapshot_id: snapshot.id,
        month_start: monthStart,
        rate_model: 'hybrid_payroll',
        coach_session_rate: coachRate,
        head_coach_session_rate: headCoachRate,
        safety_reserve_percent: safetyReservePercent,
        residual_non_coaching_pool_percent: residualPoolPercent,
        coach_session_count: coachSessionCount,
        head_coach_session_count: headCoachSessionCount,
        guaranteed_coaching_payroll: guaranteedCoachingPayroll,
        fixed_base_payroll: fixedBasePayroll,
        variable_payroll_pool: allocation.allocated,
        variable_pool_weighted_hours: variablePoolWeightedHours,
        variable_weighted_hour_value: variableWeightedHourValue,
        operating_result_before_payroll: operatingResultBeforePayroll,
        calculated_payroll_total: calculatedPayrollTotal,
        source_integrity: {
          ...sourceHashes,
          draft_snapshot_hash: draftSnapshotHash,
          draft_calculation_hash: draftCalculationHash,
        },
        note_scope: 'Hybrid Official Engine 1A draft only. Approval is intentionally blocked.',
      },
    })

    revalidatePath('/admin/staff-payroll/calculation')
    return json(200, {
      ok: true,
      snapshotId: snapshot.id,
      monthStart,
      rateModel: 'hybrid_payroll',
      approvalEnabled: false,
      summary: {
        coachRate,
        headCoachRate,
        safetyReservePercent,
        residualPoolPercent,
        coachSessionCount,
        headCoachSessionCount,
        guaranteedCoachingPayroll,
        variablePayrollPool: allocation.allocated,
        calculatedPayrollTotal,
      },
    })
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: error?.message ?? String(error),
    })
  }
}
