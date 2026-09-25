'use client'

import * as React from 'react'
import Link from 'next/link'

type Snapshot = {
  id: string
  month_start: string
  status: string
  rate_model: string
  variable_payroll_percent: number
  safety_reserve_percent: number
  membership_revenue: number
  paid_membership_refunds: number
  net_membership_revenue: number
  eligible_operating_expenses: number
  operating_result_before_payroll: number
  fixed_base_payroll: number
  safety_reserve_amount: number
  variable_payroll_pool: number
  variable_pool_weighted_hours: number
  variable_weighted_hour_value: number
  manual_bonus_total: number
  manual_deduction_total: number
  calculated_payroll_total: number
  missing_hours_task_count: number
  unconfigured_staff_count: number
}

type Calculation = {
  id: string
  staff_user_id: string
  staff_name_snapshot: string
  staff_role_snapshot: string | null
  compensation_configured: boolean
  fixed_monthly_base: number
  bonus_eligible: boolean
  weighted_hours: number
  missing_hours_task_count: number
  manual_bonus: number
  manual_deduction: number
  calculated_salary: number
}

type Props = { monthStart: string; snapshot: Snapshot; calculations: Calculation[]; canTransfer: boolean }

type Preset = { name: string; reserve: number; variable: number }
const PRESETS: Preset[] = [
  { name: 'Protect Cash', reserve: 30, variable: 20 },
  { name: 'Balanced', reserve: 20, variable: 30 },
  { name: 'Performance Push', reserve: 15, variable: 40 },
]

function round2(value: number) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100 }
function clampPercent(value: number) { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0 }
function money(value: number) {
  try { return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(Number(value || 0)) }
  catch { return `${Number(value || 0).toFixed(2)} EGP` }
}
function pct(value: number) { return `${Number(value || 0).toFixed(2)}%` }
function roleLabel(role: string | null) { return (role || 'staff').split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') }

function allocateVariablePool(rows: Calculation[], targetPool: number) {
  const eligible = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.bonus_eligible && row.weighted_hours > 0)
  const totalWeight = eligible.reduce((sum, item) => sum + item.row.weighted_hours, 0)
  const targetCents = Math.max(0, Math.round(round2(targetPool) * 100))
  const centsByIndex = new Map<number, number>()
  if (!eligible.length || totalWeight <= 0 || targetCents <= 0) return { centsByIndex, allocated: 0, totalWeight }

  const allocations = eligible.map(({ row, index }) => {
    const exactCents = (targetCents * row.weighted_hours) / totalWeight
    const floorCents = Math.floor(exactCents)
    return { index, cents: floorCents, fraction: exactCents - floorCents }
  })
  let remaining = targetCents - allocations.reduce((sum, item) => sum + item.cents, 0)
  allocations.sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < allocations.length && remaining > 0; i += 1) {
    allocations[i].cents += 1
    remaining -= 1
    if (i === allocations.length - 1 && remaining > 0) i = -1
  }
  allocations.forEach((item) => centsByIndex.set(item.index, item.cents))
  return { centsByIndex, allocated: round2(Array.from(centsByIndex.values()).reduce((sum, cents) => sum + cents, 0) / 100), totalWeight }
}

export default function StaffPayrollScenarioSimulator({ monthStart, snapshot, calculations, canTransfer }: Props) {
  const [membershipRevenue, setMembershipRevenue] = React.useState(String(snapshot.membership_revenue))
  const [paidRefunds, setPaidRefunds] = React.useState(String(snapshot.paid_membership_refunds))
  const [operatingExpenses, setOperatingExpenses] = React.useState(String(snapshot.eligible_operating_expenses))
  const [reservePercent, setReservePercent] = React.useState(String(snapshot.safety_reserve_percent))
  const [variablePercent, setVariablePercent] = React.useState(String(snapshot.variable_payroll_percent))

  const scenario = React.useMemo(() => {
    const revenue = Math.max(0, Number(membershipRevenue) || 0)
    const refunds = Math.max(0, Number(paidRefunds) || 0)
    const expenses = Math.max(0, Number(operatingExpenses) || 0)
    const reserve = clampPercent(Number(reservePercent))
    const variable = clampPercent(Number(variablePercent))
    const netRevenue = round2(revenue - refunds)
    const operatingResult = round2(netRevenue - expenses)
    const fixedBases = round2(calculations.reduce((sum, row) => sum + row.fixed_monthly_base, 0))
    const resultAfterBases = round2(operatingResult - fixedBases)
    const reserveAmount = round2(Math.max(0, resultAfterBases) * (reserve / 100))
    const committedBonuses = round2(calculations.reduce((sum, row) => sum + row.manual_bonus, 0))
    const potentialPool = round2(Math.max(0, resultAfterBases - committedBonuses - reserveAmount) * (variable / 100))
    const allocation = allocateVariablePool(calculations, potentialPool)
    const rows = calculations.map((row, index) => {
      const variablePay = round2((allocation.centsByIndex.get(index) ?? 0) / 100)
      const salaryBeforeAdjustments = round2(row.fixed_monthly_base + variablePay)
      const simulatedSalary = round2(salaryBeforeAdjustments + row.manual_bonus - row.manual_deduction)
      return { ...row, variablePay, simulatedSalary, difference: round2(simulatedSalary - row.calculated_salary) }
    })
    const payrollTotal = round2(rows.reduce((sum, row) => sum + row.simulatedSalary, 0))
    const resultAfterPayroll = round2(operatingResult - payrollTotal)
    const payrollRatio = netRevenue > 0 ? (payrollTotal / netRevenue) * 100 : payrollTotal > 0 ? Infinity : 0
    const weightedHourValue = allocation.totalWeight > 0 ? Math.round((allocation.allocated / allocation.totalWeight) * 10000) / 10000 : 0
    return { revenue, refunds, expenses, reserve, variable, netRevenue, operatingResult, fixedBases, resultAfterBases, reserveAmount, committedBonuses, variablePool: allocation.allocated, totalWeight: allocation.totalWeight, weightedHourValue, rows, payrollTotal, resultAfterPayroll, payrollRatio }
  }, [membershipRevenue, paidRefunds, operatingExpenses, reservePercent, variablePercent, calculations])

  const alerts = React.useMemo(() => {
    const result: Array<{ tone: 'warning' | 'danger'; text: string }> = []
    if (scenario.operatingResult < 0) result.push({ tone: 'danger', text: 'Negative operating result before payroll.' })
    if (scenario.fixedBases > Math.max(0, scenario.operatingResult)) result.push({ tone: 'danger', text: 'Fixed monthly bases exceed the available operating result.' })
    if (scenario.totalWeight <= 0) result.push({ tone: 'danger', text: 'No eligible weighted hours are available for variable payroll allocation.' })
    if (scenario.resultAfterBases > 0 && scenario.reserveAmount < scenario.resultAfterBases * 0.15) result.push({ tone: 'warning', text: 'Safety reserve is below 15% of the positive result after fixed bases.' })
    if (scenario.rows.some((row) => row.simulatedSalary < 0)) result.push({ tone: 'danger', text: 'At least one simulated salary becomes negative because deductions exceed salary.' })
    if (scenario.payrollRatio > 65) result.push({ tone: 'danger', text: `Payroll is above 65% of net membership revenue (${pct(scenario.payrollRatio)}).` })
    else if (scenario.payrollRatio > 50) result.push({ tone: 'warning', text: `Payroll is above 50% of net membership revenue (${pct(scenario.payrollRatio)}).` })
    if (calculations.some((row) => row.missing_hours_task_count > 0)) result.push({ tone: 'warning', text: 'Missing hours exist in the reference calculation.' })
    if (calculations.some((row) => !row.compensation_configured)) result.push({ tone: 'danger', text: 'At least one staff member has no applicable compensation configuration.' })
    return result
  }, [scenario, calculations])

  const officialUrl = `/admin/staff-payroll/calculation?month=${monthStart.slice(0, 7)}&variable=${encodeURIComponent(String(scenario.variable))}&reserve=${encodeURIComponent(String(scenario.reserve))}&from=simulator`
  const approved = snapshot.status === 'approved'

  return <div className="space-y-5">
    {approved ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><div className="font-semibold">Approved month · official payroll locked</div><div className="mt-1 text-xs">You can still explore read-only scenarios, but percentages cannot be transferred to the official draft unless the month is reopened.</div></div> : null}

    <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h2 className="text-xl font-bold">Scenario assumptions</h2><p className="mt-1 text-sm text-[hsl(var(--muted))]">Financial assumptions are local to this page. No API write is performed.</p></div>
        <div className="flex flex-wrap gap-2">{PRESETS.map((preset) => <button key={preset.name} type="button" onClick={() => { setReservePercent(String(preset.reserve)); setVariablePercent(String(preset.variable)) }} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]">{preset.name}<span className="ml-1 text-[hsl(var(--muted))]">{preset.reserve}% / {preset.variable}%</span></button>)}</div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium">Membership revenue<input type="number" min="0" step="0.01" value={membershipRevenue} onChange={(e) => setMembershipRevenue(e.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium">Paid refunds<input type="number" min="0" step="0.01" value={paidRefunds} onChange={(e) => setPaidRefunds(e.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium">Operating expenses<input type="number" min="0" step="0.01" value={operatingExpenses} onChange={(e) => setOperatingExpenses(e.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium">Safety reserve %<input type="number" min="0" max="100" step="0.01" value={reservePercent} onChange={(e) => setReservePercent(e.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium">Variable payroll %<input type="number" min="0" max="100" step="0.01" value={variablePercent} onChange={(e) => setVariablePercent(e.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" /></label>
      </div>
    </section>

    {alerts.length ? <section className="space-y-2">{alerts.map((alert, index) => <div key={`${alert.text}-${index}`} className={`rounded-2xl border p-3 text-sm ${alert.tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>{alert.text}</div>)}</section> : <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">No budget guardrail is currently triggered by this scenario.</div>}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Operating result before payroll" value={money(scenario.operatingResult)} sub={`Net revenue ${money(scenario.netRevenue)}`} />
      <Metric label="Fixed monthly bases" value={money(scenario.fixedBases)} sub={`Result after bases ${money(scenario.resultAfterBases)}`} />
      <Metric label="Protected reserve" value={money(scenario.reserveAmount)} sub={`${pct(scenario.reserve)} of positive result after bases`} />
      <Metric label="Variable payroll pool" value={money(scenario.variablePool)} sub={`${pct(scenario.variable)} · ${scenario.totalWeight.toFixed(2)} weighted h`} />
      <Metric label="Weighted-hour value" value={`${money(scenario.weightedHourValue)} / h`} sub="Calculated from the allocated pool" />
      <Metric label="Total payroll" value={money(scenario.payrollTotal)} sub={`Current draft ${money(snapshot.calculated_payroll_total)}`} />
      <Metric label="ATOM result after payroll" value={money(scenario.resultAfterPayroll)} sub="Operating result − simulated payroll" />
      <Metric label="Payroll / net revenue" value={Number.isFinite(scenario.payrollRatio) ? pct(scenario.payrollRatio) : 'N/A'} sub="Guardrail warning > 50% · critical > 65%" />
    </section>

    <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-bold">Simulated staff payroll</h2><p className="mt-1 text-sm text-[hsl(var(--muted))]">Same cent-level allocation order as Staff Payroll 2I.</p></div>{canTransfer && !approved ? <Link href={officialUrl} className="rounded-xl bg-black px-4 py-2 text-center text-sm font-semibold text-white">Use percentages in official draft</Link> : <span className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold text-[hsl(var(--muted))]">{approved ? 'Official month locked' : 'Admin read-only'}</span>}</div>
      <div className="mt-4 overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><thead><tr className="border-b border-black/10 text-xs text-[hsl(var(--muted))]"><th className="px-2 py-3">Staff</th><th className="px-2 py-3 text-right">Fixed base</th><th className="px-2 py-3 text-right">Weighted h</th><th className="px-2 py-3 text-right">Variable pay</th><th className="px-2 py-3 text-right">Bonus</th><th className="px-2 py-3 text-right">Deduction</th><th className="px-2 py-3 text-right">Simulated salary</th><th className="px-2 py-3 text-right">vs current</th></tr></thead><tbody>{scenario.rows.map((row) => <tr key={row.id} className="border-b border-black/5"><td className="px-2 py-3"><div className="font-semibold">{row.staff_name_snapshot}</div><div className="text-xs text-[hsl(var(--muted))]">{roleLabel(row.staff_role_snapshot)}{!row.compensation_configured ? ' · Unconfigured' : ''}</div></td><td className="px-2 py-3 text-right tabular-nums">{money(row.fixed_monthly_base)}</td><td className="px-2 py-3 text-right tabular-nums">{row.weighted_hours.toFixed(2)}</td><td className="px-2 py-3 text-right tabular-nums">{money(row.variablePay)}</td><td className="px-2 py-3 text-right tabular-nums">{money(row.manual_bonus)}</td><td className="px-2 py-3 text-right tabular-nums">{money(row.manual_deduction)}</td><td className={`px-2 py-3 text-right font-semibold tabular-nums ${row.simulatedSalary < 0 ? 'text-rose-700' : ''}`}>{money(row.simulatedSalary)}</td><td className={`px-2 py-3 text-right font-semibold tabular-nums ${row.difference > 0 ? 'text-emerald-700' : row.difference < 0 ? 'text-rose-700' : ''}`}>{row.difference > 0 ? '+' : ''}{money(row.difference)}</td></tr>)}</tbody></table></div>
    </section>
  </div>
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-2xl border border-black/10 bg-white p-4"><div className="text-xs text-[hsl(var(--muted))]">{label}</div><div className="mt-1 text-xl font-bold">{value}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">{sub}</div></div>
}
