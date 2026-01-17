// src/components/SubscribeDialog.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { Card, CardContent } from '@/components/ui/Card'
import InlineAlert from '@/components/ui/InlineAlert'

export type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function todayLocalDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` // YYYY-MM-DD (local)
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function addDays(dateOnly: string, days: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
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

function humanPlan(p: Plan) {
  switch (p) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return 'Per sessions'
  }
}

type StatusKind = '' | 'info' | 'success' | 'error'

export default function SubscribeDialog({
  member,
  defaultPlan,
  defaultStartDate,
  defaultSessions,
  buttonLabel = 'Subscribe',
  onCreated,
}: {
  member: { user_id: string; email: string | null; first_name: string | null; last_name: string | null }
  defaultPlan?: Plan
  defaultStartDate?: string // YYYY-MM-DD
  defaultSessions?: number // 1..10
  buttonLabel?: string
  onCreated?: (payload: any) => void
}) {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<Plan>(defaultPlan ?? '1m')
  const [sessions, setSessions] = useState<number>(Math.min(Math.max(defaultSessions ?? 10, 1), 10))
  const [amount, setAmount] = useState<string>('0')
  const [startDate, setStartDate] = useState<string>(defaultStartDate ?? todayLocalDateStr())
  const [busy, setBusy] = useState(false)

  const [status, setStatus] = useState<{ kind: StatusKind; msg: string }>({ kind: '', msg: '' })

  // Reset à l'ouverture
  useEffect(() => {
    if (!open) return
    setPlan(defaultPlan ?? '1m')
    setSessions(Math.min(Math.max(defaultSessions ?? 10, 1), 10))
    setStartDate(defaultStartDate ?? todayLocalDateStr())
    setAmount('0')
    setBusy(false)
    setStatus({ kind: '', msg: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Lock scroll + ESC
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, busy])

  const fullName = useMemo(() => {
    const n = [member.first_name ?? '', member.last_name ?? ''].join(' ').trim()
    return n || member.email || member.user_id
  }, [member])

  const isTimePlan = plan !== 'sessions'

  useEffect(() => {
    if (isTimePlan && !startDate) setStartDate(todayLocalDateStr())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  const amountNum = Number(amount)
  const amountOk = amount !== '' && Number.isFinite(amountNum) && amountNum >= 0

  const dateOk = isISODateOnly(startDate)
  const sessionsOk = Number.isFinite(sessions) && sessions >= 1 && sessions <= 10

  const previewEnd = useMemo(() => {
    if (plan === 'sessions') {
      const sd = dateOk ? startDate : todayLocalDateStr()
      return addDays(sd, 45)
    }
    if (!dateOk) return null
    const months = plan === '1m' ? 1 : plan === '3m' ? 3 : plan === '6m' ? 6 : 12
    return addMonthsSafe(startDate, months)
  }, [plan, startDate, dateOk])

  const canSubmit =
    !busy &&
    amountOk &&
    (isTimePlan ? dateOk : sessionsOk)

  function explainServerError(j: any) {
    const base = j?.details || j?.error || 'Failed to create subscription'
    const hint = j?.hint ? ` (${String(j.hint)})` : ''
    return String(base) + hint
  }

  async function submit() {
    if (!canSubmit) {
      setStatus({ kind: 'error', msg: 'Please check fields (plan, start date / sessions, amount).' })
      toast.error('Please check fields')
      return
    }

    setBusy(true)
    setStatus({ kind: 'info', msg: 'Saving…' })

    try {
      const body: any = {
        memberId: member.user_id,
        plan,
        amount: amountNum,
      }
      if (isTimePlan) body.start_date = startDate
      else {
        body.sessions_total = Math.floor(sessions)
        // optionnel : on envoie aussi start_date pour sessions (utile pour preview identique côté serveur)
        body.start_date = dateOk ? startDate : todayLocalDateStr()
      }

      const r = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const j = await r.json().catch(() => ({}))

      if (!r.ok || !j?.ok) {
        const message = explainServerError(j)
        setStatus({ kind: 'error', msg: message })
        toast.error('Save failed')
        return
      }

      const end = j?.end_date || previewEnd
      const msg =
        plan === 'sessions'
          ? `Subscription created: ${humanPlan(plan)} (${sessions} sessions) · Ends ${end || '—'}.`
          : `Subscription created: ${humanPlan(plan)} · ${startDate} → ${end || '—'}.`

      setStatus({ kind: 'success', msg })
      toast.success('Subscription created')

      onCreated?.(j)

      setTimeout(() => {
        setOpen(false)
        router.refresh()
      }, 650)
    } catch (e: any) {
      const message = String(e?.message || e)
      setStatus({ kind: 'error', msg: message })
      toast.error('Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[100] bg-black/60"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />

          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
            <Card className="w-[92vw] max-w-md">
              <CardContent>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">New subscription</h3>
                  <div className="ml-auto">
                    <Button variant="ghost" size="sm" onClick={() => !busy && setOpen(false)}>
                      Close
                    </Button>
                  </div>
                </div>

                <div className="mt-2 text-sm text-[hsl(var(--muted))]">
                  Member: <b className="text-[hsl(var(--fg))]">{fullName}</b>
                </div>

                {status.msg ? (
                  <div className="mt-3">
                    <InlineAlert
                      variant={
                        status.kind === 'error'
                          ? 'error'
                          : status.kind === 'success'
                          ? 'success'
                          : 'info'
                      }
                    >
                      {status.msg}
                    </InlineAlert>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3">
                  <Select
                    label="Plan"
                    value={plan}
                    onChange={(e) => setPlan(e.target.value as Plan)}
                    disabled={busy || status.kind === 'success'}
                    aria-label="Plan"
                  >
                    <option value="1m">1 month</option>
                    <option value="3m">3 months</option>
                    <option value="6m">6 months</option>
                    <option value="12m">12 months</option>
                    <option value="sessions">Per sessions (45 days)</option>
                  </Select>

                  {plan !== 'sessions' && (
                    <>
                      <Input
                        label="Start date (required)"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        disabled={busy || status.kind === 'success'}
                      />
                      <p className="text-xs text-[hsl(var(--muted))] -mt-2">
                        End date preview: <span className="font-medium">{previewEnd ?? '—'}</span>
                      </p>
                    </>
                  )}

                  {plan === 'sessions' && (
                    <>
                      <Input
                        label="Number of sessions (max 10)"
                        type="number"
                        min={1}
                        max={10}
                        step={1}
                        value={sessions}
                        onChange={(e) =>
                          setSessions(Math.max(1, Math.min(10, Number(e.target.value || 1))))
                        }
                        disabled={busy || status.kind === 'success'}
                      />
                      <p className="text-xs text-[hsl(var(--muted))] -mt-2">
                        Validity preview (45 days): <span className="font-medium">{previewEnd ?? '—'}</span>
                      </p>
                    </>
                  )}

                  <Input
                    label="Amount (EGP)"
                    type="number"
                    min={0}
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy || status.kind === 'success'}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button onClick={submit} disabled={!canSubmit || status.kind === 'success'}>
                    {busy ? 'Saving…' : 'Create subscription'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div role="dialog" aria-modal="true" aria-label="Create subscription" className="sr-only" />
        </>
      )}
    </>
  )
}
