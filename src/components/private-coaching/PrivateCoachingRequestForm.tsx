'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import {
  PRIVATE_COACHING_INSTAPAY_NUMBER,
  PRIVATE_COACHING_PACKAGES,
  calculatePrivateCoachingDiscountPricing,
  formatPrivateCoachingMoney,
  normalizePrivateCoachingPromoCode,
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

type AppliedPromo = {
  code: string
  title: string | null
  discountPercent: number
}

function discountPreview(amountCents: number, promo: AppliedPromo | null) {
  if (!promo) return calculatePrivateCoachingDiscountPricing(amountCents, null)
  return calculatePrivateCoachingDiscountPricing(amountCents, {
    code: promo.code,
    title: promo.title,
    discountPercent: promo.discountPercent,
  })
}

export default function PrivateCoachingRequestForm({ coaches, hasPendingRequest }: Props) {
  const router = useRouter()
  const [coachId, setCoachId] = React.useState(coaches[0]?.user_id ?? '')
  const [sessions, setSessions] = React.useState<PrivateCoachingPackageSessions>(1)
  const [paymentMethod, setPaymentMethod] = React.useState<PrivateCoachingPaymentMethod>('cash')
  const [promoOpen, setPromoOpen] = React.useState(false)
  const [promoCode, setPromoCode] = React.useState('')
  const [appliedPromo, setAppliedPromo] = React.useState<AppliedPromo | null>(null)
  const [promoChecking, setPromoChecking] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const selectedPackage = PRIVATE_COACHING_PACKAGES.find((item) => item.sessions === sessions) ?? PRIVATE_COACHING_PACKAGES[0]
  const selectedCoach = coaches.find((coach) => coach.user_id === coachId)
  const normalizedPromoCode = normalizePrivateCoachingPromoCode(promoCode)
  const promoMatchesApplied = Boolean(appliedPromo?.code && appliedPromo.code === normalizedPromoCode)
  const activePromo = promoMatchesApplied ? appliedPromo : null
  const pricing = discountPreview(selectedPackage.amountCents, activePromo)
  const hasUnappliedPromoCode = normalizedPromoCode.length > 0 && !promoMatchesApplied
  const disabled = busy || promoChecking || hasPendingRequest || !coachId || coaches.length === 0

  const requestSummaryItems: ConfirmActionSummaryItem[] = [
    { label: 'Coach', value: selectedCoach?.full_name || '—' },
    { label: 'Package', value: selectedPackage.label },
    { label: 'Sessions / tokens', value: `${selectedPackage.sessions} token(s) after payment confirmation` },
    { label: 'Original amount', value: formatPrivateCoachingMoney(pricing.originalAmountCents) },
    {
      label: 'Promo code',
      value: pricing.discountCode
        ? [pricing.discountLabel, pricing.discountCode, `${pricing.discountPercent}% off`].filter(Boolean).join(' · ')
        : 'No promo code',
    },
    { label: 'Discount', value: pricing.discountAmountCents > 0 ? formatPrivateCoachingMoney(pricing.discountAmountCents) : '—' },
    { label: 'Final amount', value: formatPrivateCoachingMoney(pricing.finalAmountCents) },
    { label: 'Payment method', value: privateCoachingPaymentMethodLabel(paymentMethod) },
    {
      label: 'Payment instructions',
      value: paymentMethod === 'instapay' ? `Instapay ${PRIVATE_COACHING_INSTAPAY_NUMBER}` : 'Cash at reception',
    },
    { label: 'Request status', value: 'Payment pending' },
    { label: 'Token impact', value: 'No token created until payment is confirmed' },
  ]

  async function validatePromoCode(targetSessions = sessions) {
    const code = normalizePrivateCoachingPromoCode(promoCode)
    if (!code) {
      setAppliedPromo(null)
      return null
    }

    setPromoChecking(true)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch('/api/private-coaching/promo-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, package_sessions: targetSessions }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok || !json?.valid) {
        setAppliedPromo(null)
        setStatus({ kind: 'error', message: json?.details || json?.error || 'This private coaching code is not valid.' })
        return null
      }

      const promo: AppliedPromo = {
        code: String(json.code ?? code),
        title: json.title ? String(json.title) : null,
        discountPercent: Number(json.discount_percent ?? 0),
      }
      setAppliedPromo(promo)
      setStatus({ kind: 'success', message: `Private code applied: ${promo.discountPercent}% off.` })
      return promo
    } catch (error: any) {
      setAppliedPromo(null)
      setStatus({ kind: 'error', message: error?.message || 'Could not validate this private coaching code.' })
      return null
    } finally {
      setPromoChecking(false)
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (disabled) return
    setStatus({ kind: '', message: '' })

    if (normalizedPromoCode && !promoMatchesApplied) {
      const promo = await validatePromoCode(sessions)
      if (!promo) return
    }

    setConfirmOpen(true)
  }

  async function confirmRequest() {
    if (disabled) return

    setBusy(true)
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch('/api/private-coaching/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_id: coachId,
          package_sessions: sessions,
          payment_method: paymentMethod,
          promo_code: promoMatchesApplied ? normalizedPromoCode : null,
        }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not create private coaching request.' })
        return
      }

      setConfirmOpen(false)
      setStatus({ kind: 'success', message: 'Request sent. Your sessions will be available after payment confirmation.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not create private coaching request.' })
    } finally {
      setBusy(false)
    }
  }

  function selectPackage(nextSessions: PrivateCoachingPackageSessions) {
    setSessions(nextSessions)
    if (appliedPromo) {
      setAppliedPromo(null)
      setStatus({ kind: 'error', message: 'Package changed. Please apply your private code again before confirming.' })
    }
  }

  return (
    <>
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
            const itemPricing = discountPreview(item.amountCents, activePromo)
            return (
              <button
                key={item.sessions}
                type="button"
                onClick={() => selectPackage(item.sessions)}
                disabled={busy || hasPendingRequest}
                className={[
                  'rounded-3xl border p-4 text-left shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]',
                  busy || hasPendingRequest ? 'opacity-60' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="text-sm font-semibold">{item.label}</div>
                <div className="mt-2 text-xl font-semibold tracking-tight">
                  {itemPricing.discountAmountCents > 0 ? formatPrivateCoachingMoney(itemPricing.finalAmountCents) : formatPrivateCoachingMoney(item.amountCents)}
                </div>
                {itemPricing.discountAmountCents > 0 ? (
                  <div className={active ? 'mt-1 text-xs text-white/80 line-through' : 'mt-1 text-xs text-[hsl(var(--muted))] line-through'}>
                    {formatPrivateCoachingMoney(itemPricing.originalAmountCents)}
                  </div>
                ) : null}
                {item.highlight ? <div className={active ? 'mt-2 text-xs text-white/80' : 'mt-2 text-xs text-[hsl(var(--muted))]'}>{item.highlight}</div> : null}
              </button>
            )
          })}
        </div>

        {!promoOpen ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-4 text-sm shadow-soft">
            <button
              type="button"
              onClick={() => setPromoOpen(true)}
              disabled={busy || hasPendingRequest}
              className="font-semibold underline-offset-4 hover:underline disabled:opacity-50"
            >
              I have a private code
            </button>
          </div>
        ) : (
          <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <label className="grid gap-1">
              <span className="text-sm font-semibold">Private code</span>
              <input
                value={promoCode}
                onChange={(event) => {
                  setPromoCode(event.target.value)
                  setAppliedPromo(null)
                }}
                disabled={busy || hasPendingRequest}
                placeholder="Enter your private code"
                className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
              />
            </label>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[hsl(var(--muted))]">
                Optional. Enter the private code you received from the head coach.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => validatePromoCode(sessions)}
                disabled={busy || hasPendingRequest || !normalizedPromoCode || promoChecking}
                loading={promoChecking}
                loadingText="Checking…"
              >
                Apply code
              </Button>
            </div>

            {hasUnappliedPromoCode ? (
              <p className="mt-2 text-sm font-semibold text-amber-700">Apply the private code before confirming the request.</p>
            ) : pricing.discountAmountCents > 0 ? (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Code applied: {pricing.discountLabel ? `${pricing.discountLabel} · ` : ''}{pricing.discountPercent}% off · You save {formatPrivateCoachingMoney(pricing.discountAmountCents)}.
              </div>
            ) : null}
          </div>
        )}

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm">
          <div className="font-semibold">Payment instructions</div>
          {pricing.discountAmountCents > 0 ? (
            <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
              <div className="font-semibold">Discount applied</div>
              <div className="mt-1">Original: {formatPrivateCoachingMoney(pricing.originalAmountCents)}</div>
              <div>Discount: -{formatPrivateCoachingMoney(pricing.discountAmountCents)}</div>
              <div className="font-semibold">Final amount: {formatPrivateCoachingMoney(pricing.finalAmountCents)}</div>
            </div>
          ) : null}
          {paymentMethod === 'instapay' ? (
            <p className="mt-3 text-[hsl(var(--muted))]">
              Pay {formatPrivateCoachingMoney(pricing.finalAmountCents)} by Instapay to <span className="font-semibold text-black">{PRIVATE_COACHING_INSTAPAY_NUMBER}</span>. Your sessions unlock after the head coach confirms the payment.
            </p>
          ) : (
            <p className="mt-3 text-[hsl(var(--muted))]">
              Pay {formatPrivateCoachingMoney(pricing.finalAmountCents)} by cash at reception. Your sessions unlock after the head coach confirms the payment.
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

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm private coaching request"
        description="Please review the package, private code and payment method before sending this request."
        confirmLabel="Confirm request"
        pendingLabel="Sending…"
        pending={busy}
        summaryItems={requestSummaryItems}
        warning="This will create a payment pending private coaching request. Tokens are created only after payment confirmation."
        onCancel={() => {
          if (!busy) setConfirmOpen(false)
        }}
        onConfirm={confirmRequest}
      />
    </>
  )
}
