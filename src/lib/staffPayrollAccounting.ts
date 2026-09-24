export type StaffPayrollAccountingPayment = {
  id: string
  approval_calculation_id: string
  staff_name_snapshot: string
  amount: number
  payment_method: string
  payment_date: string
  reference: string | null
  note: string | null
  status: 'active' | 'reversed'
  recorded_at: string
  recorded_by_name_snapshot: string
  reversed_at: string | null
  reversed_by_name_snapshot: string | null
  reversal_reason: string | null
}

export type StaffPayrollAccountingRow = {
  calculation_id: string
  staff_user_id: string
  staff_name: string
  staff_role: string | null
  fixed_monthly_base: number
  actual_hours: number
  weighted_hours: number
  task_compensation: number
  performance_bonus: number
  dynamic_task_supplement: number
  salary_before_adjustments: number
  manual_bonus: number
  manual_deduction: number
  final_salary: number
  paid_total: number
  remaining_due: number
  payment_status: 'unpaid' | 'partially_paid' | 'paid'
}

export type StaffPayrollAccountingReport = {
  month_start: string
  approved: boolean
  snapshot_status: string | null
  approval_version_no: number
  approved_at: string | null
  approved_by_name: string | null
  approval_note: string | null
  rate_model: string
  rows: StaffPayrollAccountingRow[]
  payments: StaffPayrollAccountingPayment[]
  totals: {
    staff_count: number
    task_compensation: number
    salary_before_adjustments: number
    performance_bonus: number
    dynamic_task_supplement: number
    manual_bonus: number
    manual_deduction: number
    final_salary: number
    paid: number
    remaining: number
    cash_paid: number
    instapay_paid: number
    bank_transfer_paid: number
  }
}

function amount(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

function emptyReport(monthStart: string, snapshotStatus: string | null): StaffPayrollAccountingReport {
  return {
    month_start: monthStart,
    approved: false,
    snapshot_status: snapshotStatus,
    approval_version_no: 0,
    approved_at: null,
    approved_by_name: null,
    approval_note: null,
    rate_model: 'legacy_performance_bonus',
    rows: [],
    payments: [],
    totals: {
      staff_count: 0,
      task_compensation: 0,
      salary_before_adjustments: 0,
      performance_bonus: 0,
      dynamic_task_supplement: 0,
      manual_bonus: 0,
      manual_deduction: 0,
      final_salary: 0,
      paid: 0,
      remaining: 0,
      cash_paid: 0,
      instapay_paid: 0,
      bank_transfer_paid: 0,
    },
  }
}

export async function loadStaffPayrollAccountingReport(
  admin: any,
  monthStart: string
): Promise<StaffPayrollAccountingReport> {
  const snapshotResult = await admin
    .from('staff_payroll_monthly_snapshots')
    .select('id,status,approval_version_no,rate_model')
    .eq('month_start', monthStart)
    .maybeSingle()

  if (snapshotResult.error) throw new Error(snapshotResult.error.message)

  const snapshot = snapshotResult.data
  if (!snapshot || snapshot.status !== 'approved' || Number(snapshot.approval_version_no ?? 0) < 1) {
    return emptyReport(monthStart, snapshot?.status ? String(snapshot.status) : null)
  }

  const versionResult = await admin
    .from('staff_payroll_approval_versions')
    .select('id,version_no,approved_at,approved_by_name_snapshot,approval_note')
    .eq('snapshot_id', snapshot.id)
    .eq('version_no', snapshot.approval_version_no)
    .maybeSingle()

  if (versionResult.error) throw new Error(versionResult.error.message)
  if (!versionResult.data) throw new Error('Approved payroll version was not found.')

  const version = versionResult.data
  const [calculationsResult, paymentsResult] = await Promise.all([
    admin
      .from('staff_payroll_approval_calculations')
      .select(
        'id,staff_user_id,staff_name_snapshot,staff_role_snapshot,fixed_monthly_base,actual_hours,weighted_hours,task_compensation,performance_bonus,dynamic_task_supplement,salary_before_adjustments,manual_bonus,manual_deduction,calculated_salary,adjustment_breakdown'
      )
      .eq('approval_version_id', version.id)
      .order('staff_name_snapshot', { ascending: true }),
    admin
      .from('staff_payroll_salary_payments')
      .select(
        'id,approval_calculation_id,staff_name_snapshot,amount,payment_method,payment_date,reference,note,status,recorded_at,recorded_by_name_snapshot,reversed_at,reversed_by_name_snapshot,reversal_reason'
      )
      .eq('approval_version_id', version.id)
      .order('payment_date', { ascending: true })
      .order('recorded_at', { ascending: true }),
  ])

  if (calculationsResult.error) throw new Error(calculationsResult.error.message)
  if (paymentsResult.error) throw new Error(paymentsResult.error.message)

  const payments: StaffPayrollAccountingPayment[] = ((paymentsResult.data ?? []) as any[]).map(
    (row) => ({
      id: String(row.id),
      approval_calculation_id: String(row.approval_calculation_id),
      staff_name_snapshot: String(row.staff_name_snapshot ?? ''),
      amount: amount(row.amount),
      payment_method: String(row.payment_method ?? ''),
      payment_date: String(row.payment_date ?? ''),
      reference: row.reference ? String(row.reference) : null,
      note: row.note ? String(row.note) : null,
      status: row.status === 'reversed' ? 'reversed' : 'active',
      recorded_at: String(row.recorded_at ?? ''),
      recorded_by_name_snapshot: String(row.recorded_by_name_snapshot ?? ''),
      reversed_at: row.reversed_at ? String(row.reversed_at) : null,
      reversed_by_name_snapshot: row.reversed_by_name_snapshot
        ? String(row.reversed_by_name_snapshot)
        : null,
      reversal_reason: row.reversal_reason ? String(row.reversal_reason) : null,
    })
  )

  const paidByCalculation = new Map<string, number>()
  for (const payment of payments) {
    if (payment.status !== 'active') continue
    paidByCalculation.set(
      payment.approval_calculation_id,
      amount((paidByCalculation.get(payment.approval_calculation_id) ?? 0) + payment.amount)
    )
  }

  const rows: StaffPayrollAccountingRow[] = ((calculationsResult.data ?? []) as any[]).map(
    (row) => {
      const finalSalary = amount(row.calculated_salary)
      const manualBonus = amount(row.manual_bonus)
      const manualDeduction = amount(row.manual_deduction)
      const storedBeforeAdjustments = amount(row.salary_before_adjustments)
      const hasAdjustmentSnapshot =
        manualBonus > 0 ||
        manualDeduction > 0 ||
        (Array.isArray(row.adjustment_breakdown) && row.adjustment_breakdown.length > 0)
      const salaryBeforeAdjustments = hasAdjustmentSnapshot
        ? storedBeforeAdjustments
        : finalSalary
      const paidTotal = Math.min(
        finalSalary,
        amount(paidByCalculation.get(String(row.id)) ?? 0)
      )
      const remainingDue = amount(Math.max(finalSalary - paidTotal, 0))
      const paymentStatus =
        remainingDue <= 0
          ? 'paid'
          : paidTotal > 0
            ? 'partially_paid'
            : 'unpaid'

      return {
        calculation_id: String(row.id),
        staff_user_id: String(row.staff_user_id),
        staff_name: String(row.staff_name_snapshot ?? ''),
        staff_role: row.staff_role_snapshot ? String(row.staff_role_snapshot) : null,
        fixed_monthly_base: amount(row.fixed_monthly_base),
        actual_hours: amount(row.actual_hours),
        weighted_hours: amount(row.weighted_hours),
        task_compensation: amount(row.task_compensation),
        performance_bonus: amount(row.performance_bonus),
        dynamic_task_supplement: amount(row.dynamic_task_supplement),
        salary_before_adjustments: salaryBeforeAdjustments,
        manual_bonus: manualBonus,
        manual_deduction: manualDeduction,
        final_salary: finalSalary,
        paid_total: paidTotal,
        remaining_due: remainingDue,
        payment_status: paymentStatus as StaffPayrollAccountingRow['payment_status'],
      }
    }
  )

  const activePayments = payments.filter((payment) => payment.status === 'active')
  const sumRows = (pick: (row: StaffPayrollAccountingRow) => number) =>
    amount(rows.reduce((total, row) => total + pick(row), 0))
  const sumPayments = (method: string) =>
    amount(
      activePayments
        .filter((payment) => payment.payment_method === method)
        .reduce((total, payment) => total + payment.amount, 0)
    )

  return {
    month_start: monthStart,
    approved: true,
    snapshot_status: 'approved',
    approval_version_no: Number(version.version_no ?? 0),
    approved_at: version.approved_at ? String(version.approved_at) : null,
    approved_by_name: String(version.approved_by_name_snapshot ?? 'Super Admin'),
    approval_note: version.approval_note ? String(version.approval_note) : null,
    rate_model: String(snapshot.rate_model ?? 'legacy_performance_bonus'),
    rows,
    payments,
    totals: {
      staff_count: rows.length,
      task_compensation: sumRows((row) => row.task_compensation),
      salary_before_adjustments: sumRows((row) => row.salary_before_adjustments),
      performance_bonus: sumRows((row) => row.performance_bonus),
      dynamic_task_supplement: sumRows((row) => row.dynamic_task_supplement),
      manual_bonus: sumRows((row) => row.manual_bonus),
      manual_deduction: sumRows((row) => row.manual_deduction),
      final_salary: sumRows((row) => row.final_salary),
      paid: sumRows((row) => row.paid_total),
      remaining: sumRows((row) => row.remaining_due),
      cash_paid: sumPayments('cash'),
      instapay_paid: sumPayments('instapay'),
      bank_transfer_paid: sumPayments('bank_transfer'),
    },
  }
}
