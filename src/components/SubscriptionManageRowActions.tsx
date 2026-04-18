// src/components/SubscriptionManageRowActions.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import SettleDueDialog from '@/components/SettleDueDialog'
import SaveButton from '@/components/forms/SaveButton'
import { freezePlanSummaryLabel, getFreezeTokenAllowance, toInclusiveFreezeEnd, type SubscriptionFreezeHistoryRow } from '@/lib/subscriptionFreeze'
import { cairoTodayDateOnly } from '@/lib/cairoTime'
// Note: we intentionally avoid depending on a specific Alert component API here.
// We'll render a lightweight inline message box to prevent TS prop mismatches.

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'
type SubscriptionType = 'time' | 'sessions'

type IsoDateOnly = string

function isISODateOnly(s?: string | null): s is IsoDateOnly {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function todayDateOnlyCairo() {
  return cairoTodayDateOnly()
}

function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function daysBetweenUTC(fromDateOnly: string, toDateOnly: string) {
  const from = new Date(`${fromDateOnly}T00:00:00Z`).getTime()
  const to = new Date(`${toDateOnly}T00:00:00Z`).getTime()
  return Math.floor((to - from) / 86400000)
}

export default function SubscriptionManageRowActions({
  sub,
  canManageFreeze = false,
  freezeSummary,
  freezeHistory,
}: {
  sub: {
    id: string
    // member_id is not required by this component, keep it optional to match callers.
    member_id?: string | null
    plan: Plan | string | null
    subscription_type?: 'time' | 'sessions' | null
    status: string | null
    start_date: string | null
    end_date: string | null
    frozen_from?: string | null
    frozen_until?: string | null
    sessions_total: number | null
    sessions_used: number | null
    amount: number | null
    amount_due?: number | null
    payment_method?: string | null
  }
  canManageFreeze?: boolean
  freezeSummary?: {
    allowed: number
    used: number
    remaining: number
    hasOpenFreeze?: boolean
    activeState?: 'active' | 'scheduled' | null
  } | null
  freezeHistory?: SubscriptionFreezeHistoryRow[] | null
}) {
  const router = useRouter()

  // Derive type if DB field is missing (legacy rows)
  const stype: SubscriptionType =
    sub.subscription_type === 'time' || sub.subscription_type === 'sessions'
      ? sub.subscription_type
      : sub.plan === 'sessions' || sub.sessions_total != null
        ? 'sessions'
        : 'time'
  const isTime = stype === 'time'
  const currentPlanForFreeze = String(sub.plan ?? '')
  const freezeTokensAllowed = getFreezeTokenAllowance(currentPlanForFreeze, stype)
  const canFreezePlan = isTime && freezeTokensAllowed > 0
  const manageableFreezeHistory = useMemo(() => {
    const rows = Array.isArray(freezeHistory) ? [...freezeHistory] : []
    return rows.sort((a, b) => {
      const aFrom = a.freeze_from ?? ''
      const bFrom = b.freeze_from ?? ''
      if (aFrom !== bFrom) return bFrom.localeCompare(aFrom)
      const aCreated = a.created_at ?? ''
      const bCreated = b.created_at ?? ''
      return bCreated.localeCompare(aCreated)
    })
  }, [freezeHistory])
  const hasManagedFreezeHistory = manageableFreezeHistory.length > 0
  const canManageFreezeAction = canManageFreeze && (canFreezePlan || hasManagedFreezeHistory)

  const [openEdit, setOpenEdit] = useState(false)
  const [openFreeze, setOpenFreeze] = useState(false)
  const [busy, setBusy] = useState(false)

  const [amount, setAmount] = useState<string>(String(sub.amount ?? 0))
  const [startDate, setStartDate] = useState<string>(sub.start_date ?? '')
  const [plan, setPlan] = useState<Plan>(() => {
    const p = String(sub.plan ?? '') as Plan
    const allowed: Plan[] = ['1m', '3m', '6m', '12m', 'sessions']
    return allowed.includes(p) ? p : isTime ? '1m' : 'sessions'
  })

  const [sessionsTotal, setSessionsTotal] = useState<string>(String(sub.sessions_total ?? 10))

  // Optional invoice re-issue on edit (controlled by admin)
  const [reissueInvoice, setReissueInvoice] = useState(false)
  const [emailInvoice, setEmailInvoice] = useState(true)

  const initialFreezeFrom = useMemo(() => {
    return todayDateOnlyCairo()
  }, [])

  const initialFreezeTo = useMemo(() => {
    const t = todayDateOnlyCairo()
    return addDays(t, 6)
  }, [])

  const [freezeFrom, setFreezeFrom] = useState<string>(initialFreezeFrom)
  const [freezeTo, setFreezeTo] = useState<string>(initialFreezeTo)
  const [editingFreezeId, setEditingFreezeId] = useState<string | null>(null)

  const [status, setStatus] = useState<{ kind: '' | 'info' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  const statusBox = status.kind ? (
    <div
      className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${
        status.kind === 'error'
          ? 'bg-rose-50 border-rose-300 text-rose-900'
          : status.kind === 'success'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
            : 'bg-sky-50 border-sky-300 text-sky-900'
      }`}
      role="status"
    >
      {status.msg}
    </div>
  ) : null

  // addMonths "safe": clamp to last day of target month if needed (handles 31st)
  function addMonthsSafe(dateOnly: string, months: number) {
    const [y, m, d] = dateOnly.split('-').map(Number)
    const base = new Date(Date.UTC(y, m - 1, d))
    const targetMonth = base.getUTCMonth() + months
    const tmp = new Date(Date.UTC(y, m - 1, 1))
    tmp.setUTCMonth(targetMonth + 1, 0) // last day of target month
    const lastDay = tmp.getUTCDate()
    const clampedDay = Math.min(d, lastDay)
    const out = new Date(Date.UTC(y, m - 1, clampedDay))
    out.setUTCMonth(targetMonth)
    return out.toISOString().slice(0, 10)
  }

  function planToMonths(p: Plan) {
    return p === '1m' ? 1 : p === '3m' ? 3 : p === '6m' ? 6 : p === '12m' ? 12 : 0
  }

  const previewEnd = useMemo(() => {
    if (!isTime) return sub.end_date ?? null
    if (!isISODateOnly(startDate)) return null
    const months = planToMonths(plan)
    if (months <= 0) return null
    return addMonthsSafe(startDate, months)
  }, [isTime, startDate, plan, sub.end_date])

  const today = todayDateOnlyCairo()
  const hasOpenFreeze = canFreezePlan && (freezeSummary?.hasOpenFreeze ?? (isISODateOnly(sub.frozen_until) && sub.frozen_until > today))
  const canCreateFreeze = canManageFreeze && canFreezePlan && !hasOpenFreeze && (freezeSummary ? freezeSummary.remaining > 0 : true) && sub.status === 'active' && (!isTime || (isISODateOnly(sub.end_date) && sub.end_date >= today))
  const activeFreezeStateLabel = freezeSummary?.activeState === 'scheduled' ? 'Scheduled freeze' : 'Active freeze'
  const canCreateFreezeHint = !canFreezePlan
    ? 'Freeze is only available for 3, 6, or 12 month subscriptions.'
    : sub.status !== 'active'
      ? 'Freeze can only be created on active subscriptions.'
      : hasOpenFreeze
        ? `${activeFreezeStateLabel} already exists.`
        : freezeSummary && freezeSummary.remaining <= 0
          ? 'No freeze tokens remaining.'
          : !isISODateOnly(sub.end_date) || sub.end_date < today
            ? 'Subscription is no longer active today.'
            : 'Create a new freeze for this subscription.'

  const freezeDurationDays = useMemo(() => {
    if (!isISODateOnly(freezeFrom) || !isISODateOnly(freezeTo)) return null
    if (freezeFrom > freezeTo) return null
    // inclusive range -> exclusive end
    const untilExclusive = addDays(freezeTo, 1)
    return Math.max(0, daysBetweenUTC(freezeFrom, untilExclusive))
  }, [freezeFrom, freezeTo])

  const canEdit = !busy

  async function doUpdate() {
    if (busy) return

    setBusy(true)
    setStatus({ kind: 'info', msg: 'Saving…' })

    try {
      const amountNum = Number(amount)
      if (!Number.isFinite(amountNum) || amountNum < 0) {
        setStatus({ kind: 'error', msg: 'Amount must be a valid number.' })
        toast.error('Save failed')
        return
      }

      const patch: any = { amount: amountNum }

      if (isTime) {
        if (!isISODateOnly(startDate)) {
          setStatus({ kind: 'error', msg: 'Start date must be YYYY-MM-DD.' })
          toast.error('Save failed')
          return
        }
        patch.start_date = startDate
        patch.plan = plan
        // end_date is computed server-side from plan + start_date
      } else {
        const st = Number(sessionsTotal)
        if (!Number.isFinite(st) || st < 1) {
          setStatus({ kind: 'error', msg: 'Sessions total must be a valid number.' })
          toast.error('Save failed')
          return
        }
        patch.sessions_total = Math.floor(st)
      }

      const invoice = reissueInvoice ? { generate: true, email: !!emailInvoice } : null

      const r = await fetch('/api/subscriptions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, patch, ...(invoice ? { invoice } : {}) }),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Update failed' })
        toast.error('Save failed')
        return
      }

      // Controlled: re-issue invoice only if requested
      let msg = 'Updated.'
      if (reissueInvoice) {
        if (j?.invoice_ok) {
          msg += ` Invoice ${j?.invoice?.invoice_number ? `(${j.invoice.invoice_number}) ` : ''}generated.`
          if (j?.email_sent) msg += ' Email sent.'
          else if (j?.email_error) msg += ` Email not sent: ${j.email_error}`
        } else {
          msg += ` Invoice not generated: ${j?.invoice_error || 'unknown error'}`
        }
      }

      setStatus({ kind: 'success', msg })
      toast.success('Updated')
      setTimeout(() => {
        setOpenEdit(false)
        router.refresh()
      }, 400)
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Save failed')
    } finally {
      setBusy(false)
    }
  }

  function resetFreezeEditor() {
    setEditingFreezeId(null)
    setFreezeFrom(initialFreezeFrom)
    setFreezeTo(initialFreezeTo)
  }

  function startFreezeEdit(row: SubscriptionFreezeHistoryRow) {
    if (busy) return
    const nextFrom = isISODateOnly(row.freeze_from) ? row.freeze_from : initialFreezeFrom
    const nextTo = toInclusiveFreezeEnd(row.freeze_until) ?? nextFrom
    setEditingFreezeId(row.id)
    setFreezeFrom(nextFrom)
    setFreezeTo(nextTo)
    setStatus({ kind: '', msg: '' })
  }

  async function doFreezeSave() {
    if (busy) return

    setBusy(true)
    setStatus({ kind: 'info', msg: editingFreezeId ? 'Saving freeze changes…' : 'Saving freeze…' })

    try {
      if (!editingFreezeId && !canCreateFreeze) {
        setStatus({ kind: 'error', msg: 'Freeze cannot be created for this subscription right now.' })
        toast.error('Freeze failed')
        return
      }

      if (!isISODateOnly(freezeFrom) || !isISODateOnly(freezeTo)) {
        setStatus({ kind: 'error', msg: 'Please choose valid dates.' })
        toast.error('Freeze failed')
        return
      }

      if (freezeFrom > freezeTo) {
        setStatus({ kind: 'error', msg: 'Freeze end date must be after start date.' })
        toast.error('Freeze failed')
        return
      }

      if (typeof freezeDurationDays === 'number' && freezeDurationDays > 30) {
        setStatus({ kind: 'error', msg: 'Each freeze is limited to 30 days maximum.' })
        toast.error('Freeze failed')
        return
      }

      const r = await fetch('/api/subscriptions/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sub.id,
          action: editingFreezeId ? 'update' : 'create',
          ...(editingFreezeId ? { freeze_id: editingFreezeId } : {}),
          from: freezeFrom,
          to: freezeTo,
        }),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Freeze failed' })
        toast.error('Freeze failed')
        return
      }

      setStatus({ kind: 'success', msg: editingFreezeId ? 'Freeze updated.' : 'Freeze created.' })
      toast.success(editingFreezeId ? 'Freeze updated' : 'Freeze created')
      setTimeout(() => {
        resetFreezeEditor()
        setOpenFreeze(false)
        router.refresh()
      }, 450)
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Freeze failed')
    } finally {
      setBusy(false)
    }
  }

  async function doFreezeDelete(freezeId: string) {
    if (busy) return
    if (!confirm('Delete this freeze? The freeze token will be restored.')) return

    setBusy(true)
    setStatus({ kind: 'info', msg: 'Deleting freeze…' })

    try {
      const r = await fetch('/api/subscriptions/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, action: 'delete', freeze_id: freezeId }),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Freeze delete failed' })
        toast.error('Freeze delete failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Freeze deleted.' })
      toast.success('Freeze deleted')
      setTimeout(() => {
        resetFreezeEditor()
        setOpenFreeze(false)
        router.refresh()
      }, 450)
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Freeze delete failed')
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (busy) return
    if (!confirm('Delete this subscription?')) return

    setBusy(true)
    setStatus({ kind: 'info', msg: 'Deleting…' })

    try {
      const r = await fetch('/api/subscriptions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id }),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Delete failed' })
        toast.error('Delete failed')
        return
      }

      toast.success('Deleted')
      router.refresh()
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const planOptions = [
    { label: '1 month', value: '1m' },
    { label: '3 months', value: '3m' },
    { label: '6 months', value: '6m' },
    { label: '12 months', value: '12m' },
  ]

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => setOpenEdit(true)} disabled={!canEdit}>
        Edit
      </Button>

      {Number(sub.amount_due ?? 0) > 0 ? (
        <SettleDueDialog
          sub={{
            id: sub.id,
            amount: sub.amount ?? 0,
            amount_due: sub.amount_due ?? 0,
            payment_method: sub.payment_method ?? null,
          }}
          buttonLabel="Payment"
          size="sm"
          allowEmailOption
        />
      ) : null}

      {canManageFreezeAction ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setStatus({ kind: '', msg: '' })
            resetFreezeEditor()
            setOpenFreeze(true)
          }}
          disabled={!canEdit}
        >
          Freeze tokens
        </Button>
      ) : null}

      <Button
        size="sm"
        variant="outline"
        onClick={doDelete}
        disabled={!canEdit}
        className="border-rose-300 text-rose-700 hover:bg-rose-50"
      >
        Delete
      </Button>

      {/* Edit modal */}
      {openEdit && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit subscription</h3>
              <Button variant="ghost" onClick={() => !busy && setOpenEdit(false)}>
                Close
              </Button>
            </div>

            {statusBox}

            <div className="mt-4 grid gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {isTime ? (
                  <div>
                    <div className="text-sm font-medium mb-1">Plan</div>
                    <Select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} disabled={busy}>
                      {planOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}

                <div>
                  <div className="text-sm font-medium mb-1">Amount</div>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                </div>
              </div>

              {isTime ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-medium mb-1">Start date</div>
                    <Input
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      disabled={busy}
                      placeholder="YYYY-MM-DD"
                    />
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">YYYY-MM-DD</div>
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-1">End date</div>
                    <Input value={previewEnd ?? ''} disabled />
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Auto-calculated from plan</div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-medium mb-1">Sessions total</div>
                    <Input value={sessionsTotal} onChange={(e) => setSessionsTotal(e.target.value)} disabled={busy} />
                  </div>
                </div>
              )}

              {/* Invoice re-issue (controlled) */}
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={reissueInvoice}
                    onChange={(e) => setReissueInvoice(e.target.checked)}
                    disabled={busy}
                    className="mt-1 h-4 w-4"
                    aria-label="Re-issue invoice"
                  />
                  <div>
                    <div className="text-sm font-medium">Re-issue invoice</div>
                    <div className="text-xs text-[hsl(var(--muted))] mt-0.5">
                      Generates a new PDF invoice after saving the changes.
                    </div>
                  </div>
                </label>

                <div className="mt-3 pl-7">
                  <label className={`flex items-center gap-2 text-sm ${!reissueInvoice ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={emailInvoice}
                      onChange={(e) => setEmailInvoice(e.target.checked)}
                      disabled={busy || !reissueInvoice}
                      className="h-4 w-4"
                      aria-label="Send invoice by email"
                    />
                    <span>Send by email (signed download link valid 7 days)</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpenEdit(false)} disabled={busy}>
                  Cancel
                </Button>
                <SaveButton onClick={doUpdate} type="button" loading={busy} disabled={busy} idleLabel="Save" pendingLabel="Saving..." />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Freeze modal (time subscriptions only) */}
      {openFreeze && canManageFreezeAction && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editingFreezeId ? 'Edit freeze' : 'Manage freeze'}</h3>
              <Button
                variant="ghost"
                onClick={() => {
                  if (busy) return
                  resetFreezeEditor()
                  setOpenFreeze(false)
                }}
              >
                Close
              </Button>
            </div>

            {statusBox}

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[hsl(var(--fg))]">Freeze tokens</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">{freezePlanSummaryLabel(currentPlanForFreeze, stype)}</div>
                  </div>
                  {freezeSummary?.hasOpenFreeze ? (
                    <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                      {activeFreezeStateLabel}
                    </div>
                  ) : null}
                </div>

                {freezeSummary ? (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Total</div>
                      <div className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">{freezeSummary.allowed}</div>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Used</div>
                      <div className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">{freezeSummary.used}</div>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted))]">Remaining</div>
                      <div className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">{freezeSummary.remaining}</div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 text-xs text-[hsl(var(--muted))]">
                  Creating a freeze consumes 1 token. Editing keeps the same token. Deleting a freeze restores its token and recalculates the subscription end date.
                </div>
              </div>

              {manageableFreezeHistory.length > 0 ? (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Freeze history</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{manageableFreezeHistory.length} record(s)</div>
                  </div>
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {manageableFreezeHistory.map((row) => {
                      const rowEnd = toInclusiveFreezeEnd(row.freeze_until)
                      const rowState = row.freeze_until && row.freeze_until > today ? (row.freeze_from && row.freeze_from > today ? 'scheduled' : 'active') : 'ended'
                      const rowStateLabel = rowState === 'scheduled' ? 'Scheduled' : rowState === 'active' ? 'Active' : 'Ended'
                      const rowStateClass = rowState === 'scheduled'
                        ? 'border-sky-200 bg-sky-50 text-sky-800'
                        : rowState === 'active'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg))]/70 text-[hsl(var(--muted))]'
                      return (
                        <div key={row.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 px-3 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-[hsl(var(--fg))]">
                                {row.freeze_from || '—'} → {rowEnd || '—'}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className={`rounded-full border px-2 py-0.5 font-medium ${rowStateClass}`}>{rowStateLabel}</span>
                                <span className="rounded-full border border-[hsl(var(--border))] bg-white px-2 py-0.5 text-[hsl(var(--muted))]">
                                  {typeof row.days === 'number' ? `${row.days} day(s)` : '—'}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => startFreezeEdit(row)} disabled={busy}>
                                Edit
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => doFreezeDelete(row.id)} disabled={busy} className="border-rose-300 text-rose-700 hover:bg-rose-50">
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[hsl(var(--fg))]">{editingFreezeId ? 'Edit selected freeze' : 'Create new freeze'}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {editingFreezeId ? 'Update the selected freeze dates. The subscription end date will be recalculated.' : canCreateFreezeHint}
                    </div>
                  </div>
                  {editingFreezeId ? (
                    <Button type="button" variant="outline" onClick={resetFreezeEditor} disabled={busy}>
                      Cancel edit
                    </Button>
                  ) : null}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm font-medium">Freeze start</div>
                    <Input type="date" value={freezeFrom} onChange={(e) => setFreezeFrom(e.target.value)} disabled={busy} />
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium">Freeze end</div>
                    <Input type="date" value={freezeTo} onChange={(e) => setFreezeTo(e.target.value)} disabled={busy} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {typeof freezeDurationDays === 'number' ? (
                    <>
                      <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/60 px-2.5 py-1 text-xs text-[hsl(var(--muted))]">
                        Duration: {freezeDurationDays} day(s){freezeDurationDays > 30 ? ' · Max 30 days' : ''}
                      </span>
                      {freezeDurationDays > 0 ? (
                        <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/60 px-2.5 py-1 text-xs text-[hsl(var(--muted))]">
                          End date impact: +{freezeDurationDays} day(s)
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-xs text-rose-700">Please choose a valid range.</div>
                  )}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-2">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { resetFreezeEditor(); setOpenFreeze(false) }} disabled={busy}>
                    Cancel
                  </Button>
                  <SaveButton
                    onClick={doFreezeSave}
                    type="button"
                    loading={busy}
                    disabled={busy || freezeDurationDays === null || (!editingFreezeId && !canCreateFreeze)}
                    idleLabel={editingFreezeId ? 'Update freeze' : 'Create freeze'}
                    pendingLabel="Saving..."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}