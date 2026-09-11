import { createHash } from 'crypto'

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return String(value)
  return Math.round((numberValue + Number.EPSILON) * 10000) / 10000
}

function sortByKey<T extends Record<string, any>>(rows: T[], keyBuilder: (row: T) => string) {
  return [...rows].sort((a, b) => keyBuilder(a).localeCompare(keyBuilder(b)))
}

export function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildPayrollSourceHashes(input: {
  payments: any[]
  refunds: any[]
  expenses: any[]
  logs: any[]
  compensationProfiles: any[]
  staffProfiles: any[]
}) {
  const payments = sortByKey(input.payments, (row) => String(row.id ?? '')).map((row) => ({
    id: String(row.id ?? ''),
    amount: normalizeNumber(row.amount),
  }))

  const refunds = sortByKey(input.refunds, (row) => String(row.id ?? '')).map((row) => ({
    id: String(row.id ?? ''),
    amount: normalizeNumber(row.amount),
  }))

  const expenses = sortByKey(input.expenses, (row) => String(row.id ?? '')).map((row) => ({
    id: String(row.id ?? ''),
    date: String(row.date ?? ''),
    category_key: String(row.category_key ?? ''),
    amount: normalizeNumber(row.amount),
  }))

  const logs = sortByKey(input.logs, (row) => String(row.id ?? '')).map((row) => ({
    id: String(row.id ?? ''),
    staff_user_id: String(row.staff_user_id ?? ''),
    task_id: String(row.task_id ?? ''),
    work_quantity: normalizeNumber(row.work_quantity),
    actual_hours: normalizeNumber(row.actual_hours),
    weighted_hours: normalizeNumber(row.weighted_hours),
    note: row.note == null ? null : String(row.note),
    task_name_snapshot: String(row.task_name_snapshot ?? ''),
    area_name_snapshot: String(row.area_name_snapshot ?? ''),
    unit_snapshot: String(row.unit_snapshot ?? ''),
    importance_level_snapshot: String(row.importance_level_snapshot ?? ''),
    importance_multiplier_snapshot: normalizeNumber(row.importance_multiplier_snapshot),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
  }))

  const compensation = sortByKey(
    input.compensationProfiles,
    (row) => String(row.staff_user_id ?? '')
  ).map((row) => ({
    staff_user_id: String(row.staff_user_id ?? ''),
    fixed_monthly_base: normalizeNumber(row.fixed_monthly_base),
    weighted_hour_rate: normalizeNumber(row.weighted_hour_rate),
    bonus_eligible: Boolean(row.bonus_eligible),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
  }))

  const staff = sortByKey(input.staffProfiles, (row) => String(row.user_id ?? '')).map((row) => ({
    user_id: String(row.user_id ?? ''),
    email: row.email == null ? null : String(row.email),
    first_name: row.first_name == null ? null : String(row.first_name),
    last_name: row.last_name == null ? null : String(row.last_name),
    role: row.role == null ? null : String(row.role),
  }))

  return {
    financial_source_hash: stableHash({ payments, refunds, expenses }),
    task_source_hash: stableHash(logs),
    compensation_source_hash: stableHash(compensation),
    staff_source_hash: stableHash(staff),
  }
}

const SNAPSHOT_CORE_KEYS = [
  'month_start',
  'eligible_revenue_scope',
  'bonus_pool_percent',
  'membership_revenue',
  'membership_payment_count',
  'paid_membership_refunds',
  'paid_membership_refund_count',
  'net_membership_revenue',
  'eligible_operating_expenses',
  'eligible_expense_count',
  'excluded_payroll_expenses',
  'excluded_payroll_expense_count',
  'operating_result_before_payroll',
  'guaranteed_payroll',
  'available_result_after_guaranteed_payroll',
  'performance_bonus_pool',
  'calculated_payroll_total',
  'staff_count',
  'missing_hours_task_count',
  'unconfigured_staff_count',
] as const

export function buildPayrollSnapshotHash(snapshot: Record<string, any>) {
  const core: Record<string, any> = {}
  for (const key of SNAPSHOT_CORE_KEYS) {
    const value = snapshot[key]
    core[key] = typeof value === 'number' ? normalizeNumber(value) : value ?? null
  }
  return stableHash(core)
}

export function buildPayrollCalculationsHash(rows: any[]) {
  const normalized = sortByKey(rows, (row) => String(row.staff_user_id ?? '')).map((row) => ({
    staff_user_id: String(row.staff_user_id ?? ''),
    staff_name_snapshot: String(row.staff_name_snapshot ?? ''),
    staff_role_snapshot: row.staff_role_snapshot == null ? null : String(row.staff_role_snapshot),
    compensation_configured: Boolean(row.compensation_configured),
    fixed_monthly_base: normalizeNumber(row.fixed_monthly_base),
    weighted_hour_rate: normalizeNumber(row.weighted_hour_rate),
    bonus_eligible: Boolean(row.bonus_eligible),
    active_task_count: Number(row.active_task_count ?? 0),
    missing_hours_task_count: Number(row.missing_hours_task_count ?? 0),
    actual_hours: normalizeNumber(row.actual_hours),
    weighted_hours: normalizeNumber(row.weighted_hours),
    task_compensation: normalizeNumber(row.task_compensation),
    guaranteed_compensation: normalizeNumber(row.guaranteed_compensation),
    bonus_weight_share_percent: normalizeNumber(row.bonus_weight_share_percent),
    performance_bonus: normalizeNumber(row.performance_bonus),
    calculated_salary: normalizeNumber(row.calculated_salary),
  }))

  return stableHash(normalized)
}
