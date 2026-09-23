'use client'

import { useMemo, useState } from 'react'
import { Calculator, LockKeyhole, Save, TrendingUp } from 'lucide-react'

type Task = { id: string; name: string; area_name: string; importance_level: string; importance_multiplier: number }
type Period = { id: string; task_id: string; effective_from: string; effective_until: string | null; minimum_hourly_rate: number; updated_at: string }
type History = { months: number; average_operating_result: number; average_fixed_payroll: number; average_weighted_hours: number }
const money = (value: number) => `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export default function StaffPayrollDynamicRatesManager({ canWrite, tasks, periods, history }: { canWrite: boolean; tasks: Task[]; periods: Period[]; history: History }) {
  const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 7)
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonth)
  const [reservePercent, setReservePercent] = useState('20')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const latestByTask = useMemo(() => { const result = new Map<string, Period>(); for (const period of periods) if (!result.has(period.task_id)) result.set(period.task_id, period); return result }, [periods])
  const reserve = Math.min(100, Math.max(0, Number(reservePercent) || 0))
  const sustainablePointRate = history.average_weighted_hours > 0 ? Math.max(0, (history.average_operating_result * (1 - reserve / 100) - history.average_fixed_payroll) / history.average_weighted_hours) : 0
  const rows = tasks.map((task) => { const recommended = round2(sustainablePointRate * task.importance_multiplier); const value = overrides[task.id] ?? String(recommended); return { task, recommended, value: Math.max(0, Number(value) || 0), current: latestByTask.get(task.id) } })

  async function save() {
    setSaving(true); setMessage('')
    try {
      const response = await fetch('/api/staff-payroll/dynamic-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_task_minimum_rates', effectiveFrom, reservePercent: reserve, historyMonths: history.months, averageOperatingResult: history.average_operating_result, averageFixedPayroll: history.average_fixed_payroll, averageWeightedHours: history.average_weighted_hours, rates: rows.map((row) => ({ taskId: row.task.id, minimumHourlyRate: row.value })) }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.details || data.error || 'Save failed.')
      setMessage(`${data.count} guaranteed task rates saved. Reloading…`); window.location.reload()
    } catch (error: any) { setMessage(error?.message ?? String(error)) } finally { setSaving(false) }
  }

  return <div className="space-y-5">
    <header><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50"><TrendingUp className="h-4 w-4" /> Payroll 2H</div><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Dynamic Task Rates & Guaranteed Minimums</h1><p className="mt-2 max-w-3xl text-sm text-black/60">Set the guaranteed hourly floor for every task. Monthly performance can add a dynamic supplement, but can never reduce this floor.</p></header>
    <section className="grid gap-3 sm:grid-cols-4">
      <div className="rounded-2xl border bg-white p-4"><div className="text-xs text-black/50">History used</div><div className="mt-1 text-xl font-bold">{history.months} month{history.months === 1 ? '' : 's'}</div></div>
      <div className="rounded-2xl border bg-white p-4"><div className="text-xs text-black/50">Avg. operating result</div><div className="mt-1 text-lg font-bold">{money(history.average_operating_result)}</div></div>
      <div className="rounded-2xl border bg-white p-4"><div className="text-xs text-black/50">Avg. fixed bases</div><div className="mt-1 text-lg font-bold">{money(history.average_fixed_payroll)}</div></div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs text-emerald-900/60">Sustainable point rate</div><div className="mt-1 text-lg font-bold text-emerald-950">{money(sustainablePointRate)}</div></div>
    </section>
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><div className="flex gap-2"><Calculator className="mt-0.5 h-4 w-4 shrink-0" /><p>Recommendation = <strong>(average operating result after reserve − average fixed bases) ÷ average weighted hours × task impact</strong>. Only subscriptions are revenue; paid refunds and eligible operating expenses are already reflected in the approved result.</p></div></section>
    <section className="rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-end gap-3"><label className="text-sm font-semibold">Effective month<input type="month" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1 block rounded-xl border px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Safety reserve %<input type="number" min="0" max="100" step="0.5" value={reservePercent} onChange={(event) => setReservePercent(event.target.value)} className="mt-1 block w-36 rounded-xl border px-3 py-2 font-normal" /></label>{canWrite ? <button type="button" disabled={saving || !tasks.length} onClick={save} className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save all rates'}</button> : <div className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><LockKeyhole className="h-4 w-4" /> Admin read-only</div>}</div>{message ? <p className="mt-3 text-sm font-semibold text-amber-800">{message}</p> : null}</section>
    <section className="overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><thead className="bg-black/[0.03] text-xs text-black/55"><tr><th className="px-4 py-3">Task</th><th className="px-4 py-3">Impact</th><th className="px-4 py-3 text-right">Current floor</th><th className="px-4 py-3 text-right">Recommended</th><th className="px-4 py-3 text-right">New guaranteed floor / hour</th></tr></thead><tbody className="divide-y">{rows.map(({ task, current, recommended, value }) => <tr key={task.id}><td className="px-4 py-3"><div className="font-semibold">{task.name}</div><div className="text-xs text-black/45">{task.area_name}</div></td><td className="px-4 py-3">×{task.importance_multiplier.toFixed(2)} <span className="text-xs text-black/45">{task.importance_level.replaceAll('_', ' ')}</span></td><td className="px-4 py-3 text-right">{current ? money(current.minimum_hourly_rate) : 'Not set'}</td><td className="px-4 py-3 text-right font-semibold text-emerald-700">{money(recommended)}</td><td className="px-4 py-3 text-right"><input disabled={!canWrite} type="number" min="0" step="0.01" value={overrides[task.id] ?? String(recommended)} onChange={(event) => setOverrides((old) => ({ ...old, [task.id]: event.target.value }))} className="w-32 rounded-lg border px-2 py-1.5 text-right disabled:bg-black/[0.03]" aria-label={`Guaranteed rate for ${task.name}`} /><div className="mt-1 text-[11px] text-black/40">{money(value)}</div></td></tr>)}</tbody></table></div></section>
  </div>
}
