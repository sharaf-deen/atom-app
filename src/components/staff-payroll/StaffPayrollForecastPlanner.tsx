'use client'

import * as React from 'react'

type BaselineSnapshot = {
  id: string
  month_start: string
  status: string
  rate_model: string
  net_membership_revenue: number
  eligible_operating_expenses: number
  operating_result_before_payroll: number
  fixed_base_payroll: number
  safety_reserve_percent: number
  safety_reserve_amount: number
  variable_payroll_percent: number
  variable_payroll_pool: number
  variable_pool_weighted_hours: number
  variable_weighted_hour_value: number
  manual_bonus_total: number
  manual_deduction_total: number
  calculated_payroll_total: number
  staff_count: number
  missing_hours_task_count: number
  unconfigured_staff_count: number
}

type ForecastInputRow = {
  month: string
  netRevenue: number
  operatingExpenses: number
  fixedBases: number
  weightedHours: number
  reservePercent: number
  variablePayrollPercent: number
  manualBonuses: number
  manualDeductions: number
}

type ForecastRow = ForecastInputRow & {
  operatingResult: number
  resultAfterBases: number
  reserveAmount: number
  variablePool: number
  weightedHourValue: number | null
  payrollTotal: number
  atomResultAfterPayroll: number
  payrollRatio: number | null
  warnings: string[]
}

type Props = {
  baseline: BaselineSnapshot
  historical: BaselineSnapshot[]
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function safeNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, safeNumber(value)))
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function money(value: number) {
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(Number(value ?? 0))
  } catch {
    return `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
  }
}

function number(value: number) {
  return Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function percentage(value: number | null) {
  return value == null ? '—' : `${number(value)}%`
}

function calculateRow(input: ForecastInputRow): ForecastRow {
  const netRevenue = Math.max(0, safeNumber(input.netRevenue))
  const operatingExpenses = Math.max(0, safeNumber(input.operatingExpenses))
  const fixedBases = Math.max(0, safeNumber(input.fixedBases))
  const weightedHours = Math.max(0, safeNumber(input.weightedHours))
  const reservePercent = clampPercent(input.reservePercent)
  const variablePayrollPercent = clampPercent(input.variablePayrollPercent)
  const manualBonuses = Math.max(0, safeNumber(input.manualBonuses))
  const manualDeductions = Math.max(0, safeNumber(input.manualDeductions))

  const operatingResult = roundMoney(netRevenue - operatingExpenses)
  const resultAfterBases = roundMoney(operatingResult - fixedBases)
  const positiveAfterBases = Math.max(0, resultAfterBases)
  const reserveAmount = roundMoney(positiveAfterBases * reservePercent / 100)
  const poolBase = Math.max(0, positiveAfterBases - reserveAmount - manualBonuses)
  const variablePool = roundMoney(poolBase * variablePayrollPercent / 100)
  const weightedHourValue = weightedHours > 0 ? roundMoney(variablePool / weightedHours) : null
  const payrollTotal = roundMoney(fixedBases + variablePool + manualBonuses - manualDeductions)
  const atomResultAfterPayroll = roundMoney(operatingResult - payrollTotal)
  const payrollRatio = netRevenue > 0 ? (payrollTotal / netRevenue) * 100 : null

  const warnings: string[] = []
  if (operatingResult < 0) warnings.push('Negative operating result')
  if (resultAfterBases < 0) warnings.push('Fixed bases exceed available operating result')
  if (variablePool > 0 && weightedHours <= 0) warnings.push('No weighted hours for variable pool')
  if (reservePercent < 15) warnings.push('Safety reserve below 15%')
  if (payrollTotal < 0) warnings.push('Negative payroll after deductions')
  if (payrollRatio != null && payrollRatio > 65) warnings.push('Payroll above 65% of net revenue')
  else if (payrollRatio != null && payrollRatio > 50) warnings.push('Payroll above 50% of net revenue')
  if (atomResultAfterPayroll < 0) warnings.push('Negative ATOM result after payroll')

  return {
    ...input,
    netRevenue,
    operatingExpenses,
    fixedBases,
    weightedHours,
    reservePercent,
    variablePayrollPercent,
    manualBonuses,
    manualDeductions,
    operatingResult,
    resultAfterBases,
    reserveAmount,
    variablePool,
    weightedHourValue,
    payrollTotal,
    atomResultAfterPayroll,
    payrollRatio,
    warnings,
  }
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function ratioTone(value: number | null) {
  if (value == null) return 'border-slate-200 bg-slate-50 text-slate-700'
  if (value > 65) return 'border-rose-200 bg-rose-50 text-rose-900'
  if (value > 50) return 'border-amber-200 bg-amber-50 text-amber-950'
  return 'border-emerald-200 bg-emerald-50 text-emerald-900'
}

export default function StaffPayrollForecastPlanner({ baseline, historical }: Props) {
  const [horizon, setHorizon] = React.useState<3 | 6 | 12>(6)
  const [revenueGrowth, setRevenueGrowth] = React.useState(0)
  const [expenseGrowth, setExpenseGrowth] = React.useState(0)
  const [fixedBaseGrowth, setFixedBaseGrowth] = React.useState(0)
  const [weightedHoursGrowth, setWeightedHoursGrowth] = React.useState(0)
  const [reservePercent, setReservePercent] = React.useState(
    clampPercent(baseline.safety_reserve_percent || 20)
  )
  const [variablePayrollPercent, setVariablePayrollPercent] = React.useState(
    clampPercent(baseline.variable_payroll_percent || 30)
  )
  const [manualBonuses, setManualBonuses] = React.useState(
    Math.max(0, baseline.manual_bonus_total)
  )
  const [manualDeductions, setManualDeductions] = React.useState(
    Math.max(0, baseline.manual_deduction_total)
  )
  const [rows, setRows] = React.useState<ForecastInputRow[]>(() =>
    Array.from({ length: 6 }, (_, index): ForecastInputRow => ({
      month: shiftMonth(baseline.month_start, index + 1),
      netRevenue: roundMoney(baseline.net_membership_revenue),
      operatingExpenses: roundMoney(baseline.eligible_operating_expenses),
      fixedBases: roundMoney(baseline.fixed_base_payroll),
      weightedHours: roundMoney(baseline.variable_pool_weighted_hours),
      reservePercent: clampPercent(baseline.safety_reserve_percent || 20),
      variablePayrollPercent: clampPercent(baseline.variable_payroll_percent || 30),
      manualBonuses: roundMoney(Math.max(0, baseline.manual_bonus_total)),
      manualDeductions: roundMoney(Math.max(0, baseline.manual_deduction_total)),
    }))
  )

  const recentActuals = React.useMemo(
    () => historical.filter((row) => row.net_membership_revenue > 0).slice(0, 3),
    [historical]
  )

  const threeMonthAverage = React.useMemo(() => ({
    revenue: average(recentActuals.map((row) => row.net_membership_revenue)),
    expenses: average(recentActuals.map((row) => row.eligible_operating_expenses)),
    fixedBases: average(recentActuals.map((row) => row.fixed_base_payroll)),
    weightedHours: average(recentActuals.map((row) => row.variable_pool_weighted_hours)),
  }), [recentActuals])

  const buildRows = React.useCallback((source: 'baseline' | 'average' = 'baseline') => {
    const sourceRevenue = source === 'average' && threeMonthAverage.revenue > 0
      ? threeMonthAverage.revenue
      : baseline.net_membership_revenue
    const sourceExpenses = source === 'average' && recentActuals.length
      ? threeMonthAverage.expenses
      : baseline.eligible_operating_expenses
    const sourceFixedBases = source === 'average' && recentActuals.length
      ? threeMonthAverage.fixedBases
      : baseline.fixed_base_payroll
    const sourceWeightedHours = source === 'average' && recentActuals.length
      ? threeMonthAverage.weightedHours
      : baseline.variable_pool_weighted_hours

    const nextRows = Array.from({ length: horizon }, (_, index): ForecastInputRow => {
      const step = index + 1
      return {
        month: shiftMonth(baseline.month_start, step),
        netRevenue: roundMoney(sourceRevenue * Math.pow(1 + revenueGrowth / 100, step)),
        operatingExpenses: roundMoney(sourceExpenses * Math.pow(1 + expenseGrowth / 100, step)),
        fixedBases: roundMoney(sourceFixedBases * Math.pow(1 + fixedBaseGrowth / 100, step)),
        weightedHours: roundMoney(sourceWeightedHours * Math.pow(1 + weightedHoursGrowth / 100, step)),
        reservePercent: clampPercent(reservePercent),
        variablePayrollPercent: clampPercent(variablePayrollPercent),
        manualBonuses: roundMoney(manualBonuses),
        manualDeductions: roundMoney(manualDeductions),
      }
    })
    setRows(nextRows)
  }, [
    baseline,
    expenseGrowth,
    fixedBaseGrowth,
    horizon,
    manualBonuses,
    manualDeductions,
    recentActuals.length,
    reservePercent,
    revenueGrowth,
    threeMonthAverage,
    variablePayrollPercent,
    weightedHoursGrowth,
  ])

  const calculatedRows = React.useMemo(() => rows.map(calculateRow), [rows])

  const totals = React.useMemo(() => {
    const revenue = calculatedRows.reduce((sum, row) => sum + row.netRevenue, 0)
    const expenses = calculatedRows.reduce((sum, row) => sum + row.operatingExpenses, 0)
    const payroll = calculatedRows.reduce((sum, row) => sum + row.payrollTotal, 0)
    const reserve = calculatedRows.reduce((sum, row) => sum + row.reserveAmount, 0)
    const atomResult = calculatedRows.reduce((sum, row) => sum + row.atomResultAfterPayroll, 0)
    const averageRatio = revenue > 0 ? (payroll / revenue) * 100 : null
    return { revenue, expenses, payroll, reserve, atomResult, averageRatio }
  }, [calculatedRows])

  const warningCount = calculatedRows.reduce((sum, row) => sum + row.warnings.length, 0)

  function updateRow(index: number, key: keyof ForecastInputRow, value: number) {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [key]: value } : row
    )))
  }

  function applyPreset(name: 'protect' | 'balanced' | 'performance') {
    if (name === 'protect') {
      setReservePercent(30)
      setVariablePayrollPercent(20)
    } else if (name === 'balanced') {
      setReservePercent(20)
      setVariablePayrollPercent(30)
    } else {
      setReservePercent(15)
      setVariablePayrollPercent(40)
    }
  }

  const baselinePayrollRatio = baseline.net_membership_revenue > 0
    ? (baseline.calculated_payroll_total / baseline.net_membership_revenue) * 100
    : null

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Reference net revenue</div>
          <div className="mt-1 text-xl font-bold">{money(baseline.net_membership_revenue)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{monthLabel(baseline.month_start)} · {baseline.status}</div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Reference payroll</div>
          <div className="mt-1 text-xl font-bold">{money(baseline.calculated_payroll_total)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{percentage(baselinePayrollRatio)} of net revenue</div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Fixed bases</div>
          <div className="mt-1 text-xl font-bold">{money(baseline.fixed_base_payroll)}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{baseline.staff_count} staff in reference month</div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Weighted hours</div>
          <div className="mt-1 text-xl font-bold">{number(baseline.variable_pool_weighted_hours)} h</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{money(baseline.variable_weighted_hour_value)} / weighted h</div>
        </div>
      </section>

      {(baseline.rate_model !== 'variable_payroll_pool' || baseline.missing_hours_task_count > 0 || baseline.unconfigured_staff_count > 0) ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Reference month requires attention</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {baseline.rate_model !== 'variable_payroll_pool' ? <li>The reference month does not use the 2I variable payroll pool model.</li> : null}
            {baseline.missing_hours_task_count > 0 ? <li>{baseline.missing_hours_task_count} task(s) had missing actual hours.</li> : null}
            {baseline.unconfigured_staff_count > 0 ? <li>{baseline.unconfigured_staff_count} staff member(s) had no applicable compensation configuration.</li> : null}
          </ul>
        </section>
      ) : null}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Planning assumptions</div>
            <h2 className="mt-1 text-xl font-bold">Build the forecast</h2>
            <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
              Growth rates compound month by month from the reference month. Apply assumptions, then fine-tune any future month directly in the planning table.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => applyPreset('protect')} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]">Protect Cash · 30/20</button>
            <button type="button" onClick={() => applyPreset('balanced')} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]">Balanced · 20/30</button>
            <button type="button" onClick={() => applyPreset('performance')} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]">Performance Push · 15/40</button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium">Forecast horizon
            <select value={horizon} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setHorizon(Number(event.target.value) as 3 | 6 | 12)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
          </label>
          <label className="text-xs font-medium">Net revenue growth / month (%)
            <input type="number" step="0.1" value={revenueGrowth} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setRevenueGrowth(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Operating expense growth / month (%)
            <input type="number" step="0.1" value={expenseGrowth} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setExpenseGrowth(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Fixed-base growth / month (%)
            <input type="number" step="0.1" value={fixedBaseGrowth} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFixedBaseGrowth(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Weighted-hours growth / month (%)
            <input type="number" step="0.1" value={weightedHoursGrowth} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWeightedHoursGrowth(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Safety reserve (%)
            <input type="number" min="0" max="100" step="0.1" value={reservePercent} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReservePercent(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Variable payroll (%)
            <input type="number" min="0" max="100" step="0.1" value={variablePayrollPercent} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setVariablePayrollPercent(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Manual bonus budget / month
            <input type="number" min="0" step="100" value={manualBonuses} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setManualBonuses(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">Manual deductions / month
            <input type="number" min="0" step="100" value={manualDeductions} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setManualDeductions(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => buildRows('baseline')} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">Apply from reference month</button>
          <button type="button" disabled={!recentActuals.length} onClick={() => buildRows('average')} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Apply from recent average</button>
        </div>
        <div className="mt-2 text-xs text-[hsl(var(--muted))]">
          Recent-average mode uses up to the last 3 available payroll snapshots for revenue, expenses, fixed bases and weighted hours.
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Forecast revenue</div>
          <div className="mt-1 text-xl font-bold">{money(totals.revenue)}</div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-xs text-[hsl(var(--muted))]">Forecast payroll</div>
          <div className="mt-1 text-xl font-bold">{money(totals.payroll)}</div>
        </div>
        <div className={`rounded-2xl border p-4 ${ratioTone(totals.averageRatio)}`}>
          <div className="text-xs opacity-75">Payroll / net revenue</div>
          <div className="mt-1 text-xl font-bold">{percentage(totals.averageRatio)}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <div className="text-xs text-emerald-900/70">Protected reserve</div>
          <div className="mt-1 text-xl font-bold">{money(totals.reserve)}</div>
        </div>
        <div className={totals.atomResult < 0 ? 'rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950' : 'rounded-2xl border border-black/10 bg-white p-4'}>
          <div className="text-xs opacity-75">ATOM result after payroll</div>
          <div className="mt-1 text-xl font-bold">{money(totals.atomResult)}</div>
        </div>
      </section>

      {warningCount > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Forecast guardrails · {warningCount} alert{warningCount === 1 ? '' : 's'}</div>
          <div className="mt-1 text-xs">Review the highlighted months below before using this plan for staffing or compensation decisions.</div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4 sm:p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Multi-month plan</div>
          <h2 className="mt-1 text-xl font-bold">Monthly forecast</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Every input below is local to this forecast. Editing a month never changes official payroll data.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1450px] w-full text-left text-xs">
            <thead className="border-b border-black/10 bg-black/[0.015] text-[hsl(var(--muted))]">
              <tr>
                <th className="px-3 py-3">Month</th>
                <th className="px-3 py-3">Net revenue</th>
                <th className="px-3 py-3">Op. expenses</th>
                <th className="px-3 py-3">Fixed bases</th>
                <th className="px-3 py-3">Weighted h</th>
                <th className="px-3 py-3">Reserve %</th>
                <th className="px-3 py-3">Variable %</th>
                <th className="px-3 py-3">Bonus</th>
                <th className="px-3 py-3">Deduction</th>
                <th className="px-3 py-3 text-right">Reserve</th>
                <th className="px-3 py-3 text-right">Variable pool</th>
                <th className="px-3 py-3 text-right">Weighted h value</th>
                <th className="px-3 py-3 text-right">Payroll</th>
                <th className="px-3 py-3 text-right">Payroll ratio</th>
                <th className="px-3 py-3 text-right">ATOM result</th>
              </tr>
            </thead>
            <tbody>
              {calculatedRows.map((row, index) => (
                <React.Fragment key={row.month}>
                  <tr className={row.warnings.length ? 'border-b border-amber-100 bg-amber-50/40' : 'border-b border-black/5'}>
                    <td className="px-3 py-3 font-semibold">{monthLabel(row.month)}</td>
                    <td className="px-3 py-2"><input type="number" min="0" step="100" value={rows[index]?.netRevenue ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'netRevenue', Number(event.target.value))} className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" step="100" value={rows[index]?.operatingExpenses ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'operatingExpenses', Number(event.target.value))} className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" step="100" value={rows[index]?.fixedBases ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'fixedBases', Number(event.target.value))} className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" step="0.5" value={rows[index]?.weightedHours ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'weightedHours', Number(event.target.value))} className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" max="100" step="0.1" value={rows[index]?.reservePercent ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'reservePercent', Number(event.target.value))} className="w-20 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" max="100" step="0.1" value={rows[index]?.variablePayrollPercent ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'variablePayrollPercent', Number(event.target.value))} className="w-20 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" step="100" value={rows[index]?.manualBonuses ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'manualBonuses', Number(event.target.value))} className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-2"><input type="number" min="0" step="100" value={rows[index]?.manualDeductions ?? 0} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateRow(index, 'manualDeductions', Number(event.target.value))} className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1.5" /></td>
                    <td className="px-3 py-3 text-right font-medium">{money(row.reserveAmount)}</td>
                    <td className="px-3 py-3 text-right font-medium">{money(row.variablePool)}</td>
                    <td className="px-3 py-3 text-right">{row.weightedHourValue == null ? '—' : money(row.weightedHourValue)}</td>
                    <td className="px-3 py-3 text-right font-bold">{money(row.payrollTotal)}</td>
                    <td className="px-3 py-3 text-right"><span className={`inline-flex rounded-lg border px-2 py-1 font-semibold ${ratioTone(row.payrollRatio)}`}>{percentage(row.payrollRatio)}</span></td>
                    <td className={row.atomResultAfterPayroll < 0 ? 'px-3 py-3 text-right font-bold text-rose-700' : 'px-3 py-3 text-right font-bold'}>{money(row.atomResultAfterPayroll)}</td>
                  </tr>
                  {row.warnings.length ? (
                    <tr className="border-b border-amber-100 bg-amber-50/40">
                      <td colSpan={15} className="px-3 pb-3 text-[11px] text-amber-950">
                        <span className="font-semibold">Guardrails:</span> {row.warnings.join(' · ')}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <div className="font-semibold">Planning only — no official payroll data is changed.</div>
        <div className="mt-1 text-xs">
          Forecast values are directional estimates based on the selected reference month and your assumptions. Actual payroll still requires monthly source data, staff hours, compensation configuration and explicit recalculation in Salary Calculation.
        </div>
      </section>
    </div>
  )
}
