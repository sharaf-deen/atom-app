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

  const canSubmit =
    !busy &&
    amountOk &&
    (isTimePlan ? /^\d{4}-\d{2}-\d{2}$/.test(startDate) : sessions >= 1 && sessions <= 10)

  async function submit() {
    if (!canSubmit) {
      setStatus({ kind: 'error', msg: 'Please check fields (plan, date/sessions, amount).' })
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
      else body.sessions_total = sessions

      const r = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const j = await r.json().catch(() => ({}))

      if (!r.ok || !j?.ok) {
        const message = j?.details || j?.error || 'Failed to create subscription'
        setStatus({ kind: 'error', msg: message })
        toast.error('Save failed')
        return
      }

      const msg =
        plan === 'sessions'
          ? `Subscription created: ${humanPlan(plan)} (${sessions} sessions).`
          : `Subscription created: ${humanPlan(plan)} starting ${startDate}.`

      setStatus({ kind: 'success', msg })
      toast.success('Subscription created')

      onCreated?.(j)

      // Ferme vite + refresh
      setTimeout(() => {
        setOpen(false)
        router.refresh()
      }, 700)
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
          {/* Overlay */}
          <div
            className="fixed inset-0 z-[100] bg-black/60"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />

          {/* Modal */}
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

                {/* Status (plus visible + cohérent) */}
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
                        Payment date will be set to today automatically.
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
                        Validity: 45 days from start date.
                      </p>
                    </>
                  )}

                  <Input
                    label="Amount"
                    type="number"
                    min={0}
                    step="0.01"
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

          {/* a11y */}
          <div role="dialog" aria-modal="true" aria-label="Create subscription" className="sr-only" />
        </>
      )}
    </>
  )
}
