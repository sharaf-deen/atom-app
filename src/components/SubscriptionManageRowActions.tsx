// src/components/SubscriptionManageRowActions.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
// Note: we intentionally avoid depending on a specific Alert component API here.
// We'll render a lightweight inline message box to prevent TS prop mismatches.

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

export default function SubscriptionManageRowActions({
  sub,
}: {
  sub: {
    id: string
    // member_id is not required by this component, keep it optional to match callers.
    member_id?: string | null
    plan: Plan | string | null
    subscription_type: 'time' | 'sessions'
    status: string | null
    start_date: string | null
    end_date: string | null
    frozen_until?: string | null
    sessions_total: number | null
    sessions_used: number | null
    amount: number | null
  }
}) {
  const router = useRouter()

  const isTime = sub.subscription_type === 'time'

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

  const [freezeDays, setFreezeDays] = useState<string>('7')

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

  function isISODateOnly(s?: string | null) {
    return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
  }

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

  const canEdit = !busy

  async function doUpdate() {
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

      const r = await fetch('/api/subscriptions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, patch }),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Update failed' })
        toast.error('Save failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Updated.' })
      toast.success('Saved')
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

  async function doFreeze() {
    setBusy(true)
    setStatus({ kind: 'info', msg: 'Freezing…' })

    try {
      const days = Number(freezeDays)
      if (!Number.isFinite(days) || days <= 0) {
        setStatus({ kind: 'error', msg: 'Please enter a valid number of days.' })
        toast.error('Freeze failed')
        return
      }

      const r = await fetch('/api/subscriptions/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, days: Math.floor(days) }),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Freeze failed' })
        toast.error('Freeze failed')
        return
      }

      setStatus({ kind: 'success', msg: 'Frozen.' })
      toast.success('Frozen')
      setTimeout(() => {
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

  async function doDelete() {
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
      <Button size="sm" variant="outline" onClick={() => setOpenFreeze(true)} disabled={!canEdit}>
        Freeze
      </Button>
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
                    <Select
                      value={plan}
                      onChange={(e) => setPlan(e.target.value as Plan)}
                      disabled={busy}
                    >
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
                    <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
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

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpenEdit(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={doUpdate} disabled={busy}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Freeze modal */}
      {openFreeze && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Freeze subscription</h3>
              <Button variant="ghost" onClick={() => !busy && setOpenFreeze(false)}>
                Close
              </Button>
            </div>

            {statusBox}

            <div className="mt-4">
              <div className="text-sm text-[hsl(var(--muted))]">
                This will block access immediately and extend the end date by the same number of days.
              </div>

              <div className="mt-4">
                <div className="text-sm font-medium mb-1">Number of days</div>
                <Input value={freezeDays} onChange={(e) => setFreezeDays(e.target.value)} disabled={busy} />
              </div>

              <div className="flex justify-end gap-2 pt-5">
                <Button variant="outline" onClick={() => setOpenFreeze(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={doFreeze} disabled={busy}>
                  Freeze
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
