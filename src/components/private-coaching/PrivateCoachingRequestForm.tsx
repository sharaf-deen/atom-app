'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import {
  PRIVATE_COACHING_INSTAPAY_NUMBER,
  PRIVATE_COACHING_PACKAGES,
  formatPrivateCoachingMoney,
  privateCoachingPaymentMethodLabel,
  type PrivateCoachingPackageSessions,
  type PrivateCoachingPaymentMethod,
} from '@/lib/privateCoaching'

type CoachOption = {
  user_id: string
  full_name: string
  email: string | null
}

type Props = {
  coaches: CoachOption[]
  hasPendingRequest: boolean
}

export default function PrivateCoachingRequestForm({ coaches, hasPendingRequest }: Props) {
  const router = useRouter()
  const [coachId, setCoachId] = React.useState(coaches[0]?.user_id ?? '')
  const [sessions, setSessions] = React.useState<PrivateCoachingPackageSessions>(1)
  const [paymentMethod, setPaymentMethod] = React.useState<PrivateCoachingPaymentMethod>('cash')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const selectedPackage = PRIVATE_COACHING_PACKAGES.find((item) => item.sessions === sessions) ?? PRIVATE_COACHING_PACKAGES[0]
  const disabled = busy || hasPendingRequest || !coachId || coaches.length === 0

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch('/api/private-coaching/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coach_id: coachId, package_sessions: sessions, payment_method: paymentMethod }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not create private coaching request.' })
        return
      }

      setStatus({ kind: 'success', message: 'Request sent. Your sessions will be available after payment confirmation.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not create private coaching request.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {coaches.length === 0 ? (
        <InlineAlert variant="warning" title="No head coach available">
          No head coach profile was found yet. Please contact ATOM reception.
        </InlineAlert>
      ) : null}

      {hasPendingRequest ? (
        <InlineAlert variant="warning" title="Payment pending">
          You already have a private coaching request waiting for payment confirmation.
        </InlineAlert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Coach"
          value={coachId}
          onChange={(event) => setCoachId(event.target.value)}
          disabled={busy || hasPendingRequest || coaches.length <= 1}
        >
          {coaches.map((coach) => (
            <option key={coach.user_id} value={coach.user_id}>
              {coach.full_name}
            </option>
          ))}
        </Select>

        <Select
          label="Payment method"
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value as PrivateCoachingPaymentMethod)}
          disabled={busy || hasPendingRequest}
        >
          <option value="cash">Cash at reception</option>
          <option value="instapay">Instapay</option>
        </Select>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {PRIVATE_COACHING_PACKAGES.map((item) => {
          const active = item.sessions === sessions
          return (
            <button
              key={item.sessions}
              type="button"
              onClick={() => setSessions(item.sessions)}
              disabled={busy || hasPendingRequest}
              className={[
                'rounded-3xl border p-4 text-left shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]',
                busy || hasPendingRequest ? 'opacity-60' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="text-sm font-semibold">{item.label}</div>
              <div className="mt-2 text-xl font-semibold tracking-tight">{formatPrivateCoachingMoney(item.amountCents)}</div>
              {item.highlight ? <div className={active ? 'mt-2 text-xs text-white/80' : 'mt-2 text-xs text-[hsl(var(--muted))]'}>{item.highlight}</div> : null}
            </button>
          )
        })}
      </div>

      <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm">
        <div className="font-semibold">Payment instructions</div>
        {paymentMethod === 'instapay' ? (
          <p className="mt-1 text-[hsl(var(--muted))]">
            Pay {formatPrivateCoachingMoney(selectedPackage.amountCents)} by Instapay to <span className="font-semibold text-black">{PRIVATE_COACHING_INSTAPAY_NUMBER}</span>. Your sessions unlock after the head coach confirms the payment.
          </p>
        ) : (
          <p className="mt-1 text-[hsl(var(--muted))]">
            Pay {formatPrivateCoachingMoney(selectedPackage.amountCents)} by cash at reception. Your sessions unlock after the head coach confirms the payment.
          </p>
        )}
      </div>

      {status.message ? (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert>
      ) : null}

      <Button type="submit" disabled={disabled} loading={busy} loadingText="Sending…">
        Request private lesson
      </Button>
    </form>
  )
}
