'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type StaffProfile = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type TaskOption = {
  id: string
  name: string
  area_name: string
}

type TaskRate = {
  task_id: string
  weighted_hour_rate: number
}

type RatePeriod = {
  id: string
  staff_user_id: string
  effective_from: string
  effective_until: string | null
  fixed_monthly_base: number
  weighted_hour_rate: number
  bonus_eligible: boolean
  updated_at: string
  used_in_approved_payroll: boolean
  task_rates: TaskRate[]
}

type OverrideDraft = {
  key: string
  taskId: string
  rate: string
}

type FormState = {
  periodId: string
  staffUserId: string
  effectiveMonth: string
  fixedMonthlyBase: string
  weightedHourRate: string
  bonusEligible: boolean
  taskRates: OverrideDraft[]
}

type Props = {
  staffProfiles: StaffProfile[]
  tasks: TaskOption[]
  periods: RatePeriod[]
  canWrite: boolean
}

function staffName(profile: StaffProfile | undefined) {
  if (!profile) return 'Unknown staff'
  const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  return name || profile.email || profile.user_id.slice(0, 8)
}

function roleLabel(role: string | null | undefined) {
  return String(role ?? 'staff').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function money(value: number) {
  return `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
}

function monthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function previousMonthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return monthLabel(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10))
}

function currentCairoMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7)
}

function blankForm(staffUserId = ''): FormState {
  return {
    periodId: '',
    staffUserId,
    effectiveMonth: currentCairoMonth(),
    fixedMonthlyBase: '0',
    weightedHourRate: '0',
    bonusEligible: true,
    taskRates: [],
  }
}

export default function StaffCompensationRatesManager({
  staffProfiles,
  tasks,
  periods,
  canWrite,
}: Props) {
  const router = useRouter()
  const staffMap = React.useMemo(
    () => new Map(staffProfiles.map((profile) => [profile.user_id, profile])),
    [staffProfiles]
  )
  const taskMap = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const [form, setForm] = React.useState<FormState>(() => blankForm(staffProfiles[0]?.user_id ?? ''))
  const [showForm, setShowForm] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  function startNew(staffUserId = staffProfiles[0]?.user_id ?? '') {
    setForm(blankForm(staffUserId))
    setShowForm(true)
    setMessage(null)
    setError(null)
  }

  function startEdit(period: RatePeriod) {
    setForm({
      periodId: period.id,
      staffUserId: period.staff_user_id,
      effectiveMonth: period.effective_from.slice(0, 7),
      fixedMonthlyBase: String(period.fixed_monthly_base),
      weightedHourRate: String(period.weighted_hour_rate),
      bonusEligible: period.bonus_eligible,
      taskRates: period.task_rates.map((rate) => ({
        key: `${rate.task_id}:${Math.random()}`,
        taskId: rate.task_id,
        rate: String(rate.weighted_hour_rate),
      })),
    })
    setShowForm(true)
    setMessage(null)
    setError(null)
  }

  function addOverride() {
    const used = new Set(form.taskRates.map((row) => row.taskId))
    const nextTask = tasks.find((task) => !used.has(task.id))
    if (!nextTask) return
    setForm((current) => ({
      ...current,
      taskRates: [
        ...current.taskRates,
        { key: `${Date.now()}:${nextTask.id}`, taskId: nextTask.id, rate: current.weightedHourRate },
      ],
    }))
  }

  function updateOverride(key: string, patch: Partial<OverrideDraft>) {
    setForm((current) => ({
      ...current,
      taskRates: current.taskRates.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }))
  }

  async function save() {
    if (!form.staffUserId || !form.effectiveMonth) {
      setError('Select a staff member and an effective month.')
      return
    }

    setPending(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch('/api/staff-payroll/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_rate_period',
          periodId: form.periodId || null,
          staffUserId: form.staffUserId,
          effectiveFrom: form.effectiveMonth,
          fixedMonthlyBase: form.fixedMonthlyBase,
          weightedHourRate: form.weightedHourRate,
          bonusEligible: form.bonusEligible,
          taskRates: form.taskRates.map((row) => ({
            taskId: row.taskId,
            weightedHourRate: row.rate,
          })),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP_${response.status}`)
      }
      setMessage(form.periodId ? 'Rate period updated.' : 'New effective rate period created.')
      setShowForm(false)
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to save the rate period.')
    } finally {
      setPending(false)
    }
  }

  const configuredStaff = new Set(periods.map((period) => period.staff_user_id))

  return (
    <div className="space-y-5">
      {!canWrite ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <div className="font-semibold">Read-only access</div>
          <div className="mt-1 text-xs">Only Super Admin can create or edit compensation periods.</div>
        </div>
      ) : null}

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{error}</div> : null}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">Staff Payroll 2D</div>
            <h1 className="mt-1 text-2xl font-bold">Effective compensation rates</h1>
            <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))]">
              Each period starts on the first day of a payroll month. A newer period automatically closes the previous one. Quantity remains operational only: salary uses actual hours × task importance × the applicable weighted-hour rate.
            </p>
          </div>
          {canWrite ? (
            <button type="button" onClick={() => startNew()} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">
              New rate period
            </button>
          ) : null}
        </div>
      </section>

      {showForm ? (
        <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">{form.periodId ? 'Edit unlocked period' : 'New period'}</div>
              <h2 className="mt-1 text-xl font-bold">Rate settings</h2>
            </div>
            <button type="button" onClick={() => setShowForm(false)} disabled={pending} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold">Cancel</button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium">
              Staff member
              <select value={form.staffUserId} disabled={pending || Boolean(form.periodId)} onChange={(event) => setForm((current) => ({ ...current, staffUserId: event.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]">
                {staffProfiles.map((profile) => <option key={profile.user_id} value={profile.user_id}>{staffName(profile)}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium">
              Effective from
              <input type="month" min="2026-08" value={form.effectiveMonth} disabled={pending || Boolean(form.periodId)} onChange={(event) => setForm((current) => ({ ...current, effectiveMonth: event.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-black/[0.03]" />
            </label>
            <label className="text-xs font-medium">
              Fixed monthly base (EGP)
              <input type="number" min="0" step="0.01" value={form.fixedMonthlyBase} disabled={pending} onChange={(event) => setForm((current) => ({ ...current, fixedMonthlyBase: event.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium">
              Default weighted-hour rate (EGP)
              <input type="number" min="0" step="0.01" value={form.weightedHourRate} disabled={pending} onChange={(event) => setForm((current) => ({ ...current, weightedHourRate: event.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.bonusEligible} disabled={pending} onChange={(event) => setForm((current) => ({ ...current, bonusEligible: event.target.checked }))} />
            Eligible for dynamic task supplement distribution
          </label>

          <div className="mt-5 rounded-2xl border border-black/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">Task-specific overrides</div>
                <div className="text-xs text-[hsl(var(--muted))]">Optional. The default rate applies to all tasks not listed here.</div>
              </div>
              <button type="button" onClick={addOverride} disabled={pending || form.taskRates.length >= tasks.length} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold disabled:opacity-40">Add override</button>
            </div>

            {form.taskRates.length ? (
              <div className="mt-3 space-y-2">
                {form.taskRates.map((row) => {
                  const selectedElsewhere = new Set(form.taskRates.filter((item) => item.key !== row.key).map((item) => item.taskId))
                  return (
                    <div key={row.key} className="grid gap-2 rounded-xl bg-black/[0.025] p-2 sm:grid-cols-[1fr_150px_auto] sm:items-end">
                      <label className="text-xs font-medium">Task
                        <select value={row.taskId} disabled={pending} onChange={(event) => updateOverride(row.key, { taskId: event.target.value })} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-sm">
                          {tasks.map((task) => <option key={task.id} value={task.id} disabled={selectedElsewhere.has(task.id)}>{task.area_name} · {task.name}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium">Rate (EGP / weighted h)
                        <input type="number" min="0" step="0.01" value={row.rate} disabled={pending} onChange={(event) => updateOverride(row.key, { rate: event.target.value })} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-2 text-sm" />
                      </label>
                      <button type="button" onClick={() => setForm((current) => ({ ...current, taskRates: current.taskRates.filter((item) => item.key !== row.key) }))} disabled={pending} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Remove</button>
                    </div>
                  )
                })}
              </div>
            ) : <div className="mt-3 text-xs text-[hsl(var(--muted))]">No overrides. Every task uses the default weighted-hour rate.</div>}
          </div>

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={save} disabled={pending} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? 'Saving…' : 'Save rate period'}</button>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">History</div>
            <h2 className="mt-1 text-xl font-bold">Rate periods</h2>
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">{configuredStaff.size}/{staffProfiles.length} staff configured</div>
        </div>

        <div className="mt-4 space-y-3">
          {periods.map((period) => {
            const profile = staffMap.get(period.staff_user_id)
            return (
              <article key={period.id} className="rounded-2xl border border-black/10 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{staffName(profile)}</span>
                      <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[11px] font-medium">{roleLabel(profile?.role)}</span>
                      {period.used_in_approved_payroll ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">Locked by approved payroll</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">Editable</span>}
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">{monthLabel(period.effective_from)} → {period.effective_until ? previousMonthLabel(period.effective_until) : 'Open-ended'}</div>
                  </div>
                  {canWrite && !period.used_in_approved_payroll ? <button type="button" onClick={() => startEdit(period)} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold">Edit period</button> : null}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl bg-black/[0.025] p-3"><div className="text-[11px] text-[hsl(var(--muted))]">Fixed monthly base</div><div className="mt-1 font-semibold">{money(period.fixed_monthly_base)}</div></div>
                  <div className="rounded-xl bg-black/[0.025] p-3"><div className="text-[11px] text-[hsl(var(--muted))]">Default weighted-hour rate</div><div className="mt-1 font-semibold">{money(period.weighted_hour_rate)} / h</div></div>
                  <div className="rounded-xl bg-black/[0.025] p-3"><div className="text-[11px] text-[hsl(var(--muted))]">Dynamic supplement</div><div className="mt-1 font-semibold">{period.bonus_eligible ? 'Eligible' : 'Not eligible'}</div></div>
                </div>

                {period.task_rates.length ? <div className="mt-3 rounded-xl border border-black/10 p-3"><div className="text-xs font-semibold">{period.task_rates.length} task override{period.task_rates.length === 1 ? '' : 's'}</div><div className="mt-2 flex flex-wrap gap-2">{period.task_rates.map((rate) => <span key={rate.task_id} className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] text-violet-950">{taskMap.get(rate.task_id)?.name ?? 'Task'} · {money(rate.weighted_hour_rate)}/h</span>)}</div></div> : null}
              </article>
            )
          })}
          {!periods.length ? <div className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-[hsl(var(--muted))]">No effective compensation periods yet.</div> : null}
        </div>
      </section>
    </div>
  )
}
