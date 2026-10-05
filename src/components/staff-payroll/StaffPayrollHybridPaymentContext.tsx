'use client'

type ApprovalVersion = {
  id: string
  version_no: number
  calculated_payroll_total: number
  rate_model: string
  coach_session_rate: number
  head_coach_session_rate: number
  coach_session_count: number
  head_coach_session_count: number
  guaranteed_coaching_payroll: number
  variable_payroll_percent: number
  safety_reserve_percent: number
  variable_payroll_pool: number
  variable_pool_weighted_hours: number
  variable_weighted_hour_value: number
}

type Calculation = {
  id: string
  staff_name_snapshot: string
  staff_role_snapshot: string | null
  calculated_salary: number
  coaching_sessions: number
  coaching_session_rate: number
  coaching_guarantee: number
  non_coaching_weighted_hours: number
  non_coaching_variable_pay: number
}

type Payment = {
  approval_version_id: string
  approval_calculation_id: string
  amount: number
  status: string
}

type Closeout = {
  id: string
  status: string
  active_payment_total: number
  active_payment_count: number
  rate_model: string
  guaranteed_coaching_payroll: number
  variable_payroll_pool: number
  variable_pool_weighted_hours: number
  variable_weighted_hour_value: number
} | null

type Props = {
  currentVersion: ApprovalVersion
  calculations: Calculation[]
  payments: Payment[]
  currentCloseout: Closeout
}

function money(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(Number(value || 0))
  } catch {
    return `${Number(value || 0).toFixed(2)} EGP`
  }
}

function number(value: number) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function roleLabel(role: string | null) {
  return (role || 'staff')
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

export default function StaffPayrollHybridPaymentContext({
  currentVersion,
  calculations,
  payments,
  currentCloseout,
}: Props) {
  const currentPayments = payments.filter(
    (payment) =>
      payment.approval_version_id === currentVersion.id &&
      payment.status === 'active'
  )

  const paidByCalculation = new Map<string, number>()
  for (const payment of currentPayments) {
    paidByCalculation.set(
      payment.approval_calculation_id,
      (paidByCalculation.get(payment.approval_calculation_id) ?? 0) +
        Number(payment.amount || 0)
    )
  }

  const paidTotal = calculations.reduce(
    (sum, row) => sum + (paidByCalculation.get(row.id) ?? 0),
    0
  )
  const remainingTotal = Math.max(
    0,
    Number(currentVersion.calculated_payroll_total || 0) - paidTotal
  )

  return (
    <section className="rounded-3xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white">
              Hybrid approved payroll
            </span>
            <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold text-violet-900">
              Version {currentVersion.version_no}
            </span>
            {currentCloseout ? (
              <span className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">
                Payment cycle closed
              </span>
            ) : null}
          </div>

          <h2 className="mt-3 text-xl font-bold">Hybrid payment context</h2>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            The payment ledger settles the final immutable hybrid salary. Coaching guarantees and non-coaching variable pay remain visible for audit, while payment status is based on the approved final salary and active salary payments.
          </p>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-white p-3 text-xs">
          <div className="font-semibold text-violet-950">Approved model</div>
          <div className="mt-1 text-[hsl(var(--muted))]">
            Coach {money(currentVersion.coach_session_rate)} · Head Coach {money(currentVersion.head_coach_session_rate)}
          </div>
          <div className="text-[hsl(var(--muted))]">
            Reserve {number(currentVersion.safety_reserve_percent)}% · Residual pool {number(currentVersion.variable_payroll_percent)}%
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-violet-200 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Guaranteed coaching</div>
          <div className="mt-1 text-xl font-bold">{money(currentVersion.guaranteed_coaching_payroll)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {number(currentVersion.coach_session_count)} Coach + {number(currentVersion.head_coach_session_count)} Head Coach sessions
          </div>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Non-coaching pool</div>
          <div className="mt-1 text-xl font-bold">{money(currentVersion.variable_payroll_pool)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {number(currentVersion.variable_pool_weighted_hours)} weighted h · {money(currentVersion.variable_weighted_hour_value)} / h
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs text-emerald-900/70">Paid</div>
          <div className="mt-1 text-xl font-bold text-emerald-950">{money(paidTotal)}</div>
          <div className="mt-1 text-xs text-emerald-900/70">{currentPayments.length} active payment entries</div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs text-amber-900/70">Remaining due</div>
          <div className="mt-1 text-xl font-bold text-amber-950">{money(remainingTotal)}</div>
          <div className="mt-1 text-xs text-amber-900/70">
            Approved payroll {money(currentVersion.calculated_payroll_total)}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
        <div className="font-semibold">Salary advances</div>
        <div className="mt-1 text-xs">
          If a salary advance was already paid before payroll approval, record it below as a normal salary payment using the actual historical payment date and payment method. It counts toward Paid and automatically reduces Remaining due. Do not enter the advance as a deduction.
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-black/10 bg-black/[0.02] text-xs text-[hsl(var(--muted))]">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2 text-right">Coaching</th>
              <th className="px-3 py-2 text-right">Non-coaching</th>
              <th className="px-3 py-2 text-right">Final salary</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {calculations.map((row) => {
              const paid = paidByCalculation.get(row.id) ?? 0
              const remaining = Math.max(0, Number(row.calculated_salary || 0) - paid)
              return (
                <tr key={row.id} className="border-b border-black/5 last:border-b-0">
                  <td className="px-3 py-3">
                    <div className="font-semibold">{row.staff_name_snapshot}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{roleLabel(row.staff_role_snapshot)}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="font-medium">{money(row.coaching_guarantee)}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">
                      {number(row.coaching_sessions)} × {money(row.coaching_session_rate)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="font-medium">{money(row.non_coaching_variable_pay)}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{number(row.non_coaching_weighted_hours)} weighted h</div>
                  </td>
                  <td className="px-3 py-3 text-right font-bold">{money(row.calculated_salary)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-emerald-700">{money(paid)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-amber-800">{money(remaining)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-[hsl(var(--muted))]">
        Closeout remains available only when every approved final salary is fully settled. Prior advances count as salary payments once recorded in the ledger. The closeout record preserves the approved hybrid coaching and residual-pool context.
      </div>
    </section>
  )
}
