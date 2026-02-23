// src/components/SettleDueDialog.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { Card, CardContent } from '@/components/ui/Card'
import InlineAlert from '@/components/ui/InlineAlert'

type PaymentMethod = 'cash' | 'instapay' | 'card' | 'bank_transfer'

type StatusKind = '' | 'info' | 'success' | 'error'

type SubLite = {
  id: string
  amount: number | null
  amount_due: number | null
  payment_method?: string | null
}

function humanPayment(m?: string | null) {
  switch (m) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'InstaPay'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return m ? String(m) : '—'
  }
}

export default function SettleDueDialog({
  sub,
  buttonLabel,
  size = 'sm',
  allowEmailOption = false,
}: {
  sub?: SubLite | null
  buttonLabel?: string
  size?: 'sm' | 'md' | 'lg'
  allowEmailOption?: boolean
}) {
  const router = useRouter()

  // Safety: if caller passed nothing, do not crash.
  if (!sub) return null

  // Capture stable primitives so TypeScript knows they're defined inside callbacks
  // (props can change between renders).
  const subId = sub.id
  const initialMethod = (sub.payment_method as PaymentMethod) || 'cash'

  const due = Number(sub.amount_due ?? 0)
  const paidSoFar = Number(sub.amount ?? 0)
  const totalNow = (Number.isFinite(paidSoFar) ? paidSoFar : 0) + (Number.isFinite(due) ? due : 0)

  const show = Number.isFinite(due) && due > 0
  if (!show) return null

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [amountPaid, setAmountPaid] = useState<string>(String(due))
  const [method, setMethod] = useState<PaymentMethod>(initialMethod)
  const [genInvoice, setGenInvoice] = useState(true)
  const [emailInvoice, setEmailInvoice] = useState(false)
  const [status, setStatus] = useState<{ kind: StatusKind; msg: string }>({ kind: '', msg: '' })

  // Reset on open
  useEffect(() => {
    if (!open) return
    setBusy(false)
    setAmountPaid(String(due))
    setMethod(initialMethod)
    setGenInvoice(true)
    setEmailInvoice(false)
    setStatus({ kind: '', msg: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subId])

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

  const paidNum = Number(amountPaid)
  const paidOk = amountPaid !== '' && Number.isFinite(paidNum) && paidNum > 0 && paidNum <= due

  const nextDue = useMemo(() => {
    if (!paidOk) return null
    return Math.max(0, due - paidNum)
  }, [paidOk, due, paidNum])

  async function submit() {
    if (!paidOk) {
      setStatus({ kind: 'error', msg: `Amount paid must be between 1 and ${due}.` })
      toast.error('Please check the amount')
      return
    }

    setBusy(true)
    setStatus({ kind: 'info', msg: 'Saving…' })

    try {
      const payload: any = {
        id: subId,
        amount_paid: paidNum,
        payment_method: method,
      }
      if (genInvoice) payload.invoice = { generate: true, email: allowEmailOption ? !!emailInvoice : false }

      const r = await fetch('/api/subscriptions/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Update failed'
        setStatus({ kind: 'error', msg: String(msg) })
        toast.error('Save failed')
        return
      }

      let msg = `Due updated: ${Number(j?.amount_due ?? nextDue ?? 0)}`
      if (genInvoice) {
        if (j?.invoice_ok) {
          msg += j?.invoice?.invoice_number ? ` · Invoice ${j.invoice.invoice_number} generated.` : ' · Invoice generated.'
          if (j?.email_sent) msg += ' Email sent.'
          else if (j?.email_error) msg += ` Email not sent: ${j.email_error}`
        } else {
          msg += ` · Invoice not generated: ${j?.invoice_error || 'unknown error'}`
        }
      }

      setStatus({ kind: 'success', msg })
      toast.success('Saved')

      setTimeout(() => {
        setOpen(false)
        router.refresh()
      }, 450)
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
      toast.error('Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)} disabled={busy}>
        {buttonLabel ?? 'Settle due'}
      </Button>

      {open ? (
        <>
          <div className="fixed inset-0 z-[100] bg-black/60" onClick={() => !busy && setOpen(false)} aria-hidden="true" />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
            <Card className="w-full max-w-lg rounded-3xl border border-[hsl(var(--border))] shadow-soft bg-white">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">Settle remaining due</h3>
                    <p className="text-xs text-[hsl(var(--muted))] mt-1">
                      Paid so far: <span className="font-medium">{paidSoFar}</span> · Current due:{' '}
                      <span className="font-medium">{due}</span> · Total:{' '}
                      <span className="font-medium">{totalNow}</span>
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => !busy && setOpen(false)}>
                    Close
                  </Button>
                </div>

                {status.kind ? (
                  <div className="mt-4">
                    <InlineAlert variant={status.kind === 'error' ? 'error' : status.kind === 'success' ? 'success' : 'info'}>
                      {status.msg}
                    </InlineAlert>
                  </div>
                ) : null}

                <div className="mt-5 grid gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-sm font-medium mb-1">Amount paid now</div>
                      <Input
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        disabled={busy}
                        inputMode="decimal"
                        placeholder={String(due)}
                      />
                      <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Must be between 1 and {due}.</div>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-1">Payment method</div>
                      <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy}>
                        <option value="cash">Cash</option>
                        <option value="instapay">InstaPay</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Bank transfer</option>
                      </Select>
                      <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Current: {humanPayment(sub.payment_method ?? null)}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 p-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={genInvoice}
                        onChange={(e) => setGenInvoice(e.target.checked)}
                        disabled={busy}
                        className="mt-1 h-4 w-4"
                      />
                      <div>
                        <div className="text-sm font-medium">Generate updated invoice</div>
                        <div className="text-xs text-[hsl(var(--muted))] mt-0.5">Overwrites the previous PDF for this invoice number.</div>
                      </div>
                    </label>

                    {allowEmailOption ? (
                      <div className={`mt-3 pl-7 ${!genInvoice ? 'opacity-50' : ''}`}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={emailInvoice}
                            onChange={(e) => setEmailInvoice(e.target.checked)}
                            disabled={busy || !genInvoice}
                            className="h-4 w-4"
                          />
                          <span>Send by email (7-day signed link)</span>
                        </label>
                      </div>
                    ) : null}
                  </div>

                  {paidOk && nextDue !== null ? (
                    <div className="text-sm text-[hsl(var(--muted))]">
                      After this payment, new due will be: <span className="font-medium text-[hsl(var(--fg))]">{nextDue}</span>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button onClick={submit} disabled={busy || !paidOk}>
                      Confirm
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </>
  )
}
