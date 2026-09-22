'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type StaffProfile = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type Adjustment = {
  id: string
  month_start: string
  staff_user_id: string
  staff_name_snapshot: string
  adjustment_type: 'bonus' | 'deduction'
  amount: number
  reason: string
  status: 'active' | 'voided'
  created_at: string
  created_by_name_snapshot: string
  voided_at: string | null
  voided_by_name_snapshot: string | null
  void_reason: string | null
}

type Props = {
  monthStart: string
  canWrite: boolean
  locked: boolean
  approvalVersionNo: number
  draftNeedsRecalculation: boolean
  staffProfiles: StaffProfile[]
  adjustments: Adjustment[]
}

function money(value: number) {
  return `${Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`
}

function staffName(profile: StaffProfile) {
  return `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email || profile.user_id.slice(0, 8)
}

function monthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function dateTimeLabel(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function StaffPayrollAdjustmentsManager({
  monthStart,
  canWrite,
  locked,
  approvalVersionNo,
  draftNeedsRecalculation,
  staffProfiles,
  adjustments,
}: Props) {
  const router = useRouter()
  const [staffUserId, setStaffUserId] = React.useState(staffProfiles[0]?.user_id ?? '')
  const [adjustmentType, setAdjustmentType] = React.useState<'bonus' | 'deduction'>('bonus')
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [voidingId, setVoidingId] = React.useState<string | null>(null)
  const [voidReason, setVoidReason] = React.useState('')
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const active = adjustments.filter((row) => row.status === 'active')
  const bonusTotal = active.filter((row) => row.adjustment_type === 'bonus').reduce((sum, row) => sum + row.amount, 0)
  const deductionTotal = active.filter((row) => row.adjustment_type === 'deduction').reduce((sum, row) => sum + row.amount, 0)

  async function post(payload: Record<string, unknown>) {
    const response = await fetch('/api/staff-payroll/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok) throw new Error(result?.details || result?.error || `HTTP_${response.status}`)
  }

  async function createAdjustment() {
    if (!staffUserId || Number(amount) <= 0 || reason.trim().length < 3) {
      setError('Select a staff member, enter an amount greater than zero, and provide a reason of at least 3 characters.')
      return
    }
    setPendingKey('create')
    setMessage(null)
    setError(null)
    try {
      await post({ action: 'create_adjustment', monthStart, staffUserId, adjustmentType, amount, reason })
      setAmount('')
      setReason('')
      setMessage(`${adjustmentType === 'bonus' ? 'Bonus' : 'Deduction'} recorded. Recalculate the payroll draft before approval.`)
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to record the adjustment.')
    } finally {
      setPendingKey(null)
    }
  }

  async function voidAdjustment() {
    if (!voidingId || voidReason.trim().length < 3) return
    setPendingKey(voidingId)
    setMessage(null)
    setError(null)
    try {
      await post({ action: 'void_adjustment', adjustmentId: voidingId, reason: voidReason })
      setMessage('Adjustment voided. Recalculate the payroll draft before approval.')
      setVoidingId(null)
      setVoidReason('')
      router.refresh()
    } catch (caught: any) {
      setError(caught?.message ?? 'Failed to void the adjustment.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">Staff Payroll 2F</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${canWrite ? 'bg-emerald-50 text-emerald-800' : 'bg-sky-50 text-sky-800'}`}>
                {canWrite ? 'Super Admin · adjustment control' : 'Admin · read-only'}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Monthly Bonuses & Deductions</h1>
            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              Record exceptional monthly salary adjustments without changing actual hours or effective compensation rates. Every entry keeps its reason and actor history.
            </p>
          </div>
          <label className="text-xs font-medium">
            Payroll month
            <input type="month" min="2026-08" value={monthStart.slice(0, 7)} onChange={(event) => router.push(`/admin/staff-payroll/adjustments?month=${event.target.value}`)} className="mt-1 block rounded-xl border border-black/10 bg-white px-3 py-2 text-sm" />
          </label>
        </div>
      </section>

      {!canWrite ? <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"><div className="font-semibold">Read-only access</div><div className="mt-1 text-xs">Only Super Admin can create or void bonuses and deductions.</div></div> : null}
      {locked ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><div className="font-semibold">Payroll month approved & locked · V{approvalVersionNo}</div><div className="mt-1 text-xs">Adjustments are frozen in the approved salary snapshot. Reopen the payroll from Salary Calculation before making an exceptional correction.</div></div> : null}
      {draftNeedsRecalculation ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><div className="font-semibold">Recalculation required</div><div className="mt-1 text-xs">An adjustment changed after the last draft calculation. Recalculate before approval.</div></div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs text-emerald-900/70">Active bonuses</div><div className="mt-1 text-xl font-bold text-emerald-950">+ {money(bonusTotal)}</div></div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><div className="text-xs text-rose-900/70">Active deductions</div><div className="mt-1 text-xl font-bold text-rose-950">− {money(deductionTotal)}</div></div>
        <div className="rounded-2xl border border-black/10 bg-white p-4"><div className="text-xs text-[hsl(var(--muted))]">Net adjustment</div><div className="mt-1 text-xl font-bold">{bonusTotal - deductionTotal >= 0 ? '+' : '−'} {money(Math.abs(bonusTotal - deductionTotal))}</div></div>
      </section>

      {canWrite && !locked ? (
        <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
          <h2 className="text-xl font-bold">Add an adjustment · {monthLabel(monthStart)}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium">Staff<select value={staffUserId} onChange={(event) => setStaffUserId(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm">{staffProfiles.map((profile) => <option key={profile.user_id} value={profile.user_id}>{staffName(profile)}</option>)}</select></label>
            <label className="text-xs font-medium">Type<select value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value as 'bonus' | 'deduction')} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"><option value="bonus">Bonus</option><option value="deduction">Deduction</option></select></label>
            <label className="text-xs font-medium">Amount (EGP)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm" /></label>
            <label className="text-xs font-medium">Reason<input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Required reason" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm" /></label>
          </div>
          <button type="button" onClick={createAdjustment} disabled={pendingKey === 'create' || !staffProfiles.length} className="mt-4 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{pendingKey === 'create' ? 'Saving…' : 'Record adjustment'}</button>
        </section>
      ) : null}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><h2 className="text-xl font-bold">Adjustment history</h2><p className="mt-1 text-sm text-[hsl(var(--muted))]">Voided entries remain visible and are excluded from salary calculation.</p></div>
          <Link href={`/admin/staff-payroll/calculation?month=${monthStart.slice(0, 7)}`} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold">Open salary calculation</Link>
        </div>
        <div className="mt-4 space-y-3">
          {!adjustments.length ? <div className="rounded-2xl border border-dashed border-black/15 p-6 text-center text-sm text-[hsl(var(--muted))]">No bonuses or deductions for {monthLabel(monthStart)}.</div> : adjustments.map((row) => (
            <article key={row.id} className={`rounded-2xl border p-4 ${row.status === 'voided' ? 'border-black/10 bg-black/[0.02] opacity-75' : row.adjustment_type === 'bonus' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.adjustment_type === 'bonus' ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>{row.adjustment_type === 'bonus' ? 'Bonus' : 'Deduction'}</span>{row.status === 'voided' ? <span className="rounded-full bg-black/10 px-2.5 py-1 text-[11px] font-semibold">Voided</span> : null}</div><div className="mt-2 font-semibold">{row.staff_name_snapshot}</div><div className="mt-1 text-sm">{row.reason}</div><div className="mt-2 text-xs text-[hsl(var(--muted))]">Recorded by {row.created_by_name_snapshot} · {dateTimeLabel(row.created_at)}</div>{row.status === 'voided' ? <div className="mt-2 rounded-xl bg-white/70 p-2 text-xs"><strong>Void reason:</strong> {row.void_reason}<br />Voided by {row.voided_by_name_snapshot} · {dateTimeLabel(row.voided_at)}</div> : null}</div>
                <div className="sm:text-right"><div className={`text-xl font-bold ${row.adjustment_type === 'bonus' ? 'text-emerald-800' : 'text-rose-800'}`}>{row.adjustment_type === 'bonus' ? '+' : '−'} {money(row.amount)}</div>{canWrite && !locked && row.status === 'active' && voidingId !== row.id ? <button type="button" onClick={() => { setVoidingId(row.id); setVoidReason(''); setError(null) }} className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700">Void adjustment</button> : null}</div>
              </div>
              {voidingId === row.id ? <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3"><label className="text-xs font-medium">Void reason<textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={2} maxLength={1000} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" /></label><div className="mt-2 flex gap-2"><button type="button" onClick={() => { setVoidingId(null); setVoidReason('') }} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold">Cancel</button><button type="button" onClick={voidAdjustment} disabled={voidReason.trim().length < 3 || pendingKey === row.id} className="rounded-xl bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{pendingKey === row.id ? 'Voiding…' : 'Confirm void'}</button></div></div> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
