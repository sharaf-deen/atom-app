'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

const CAIRO_TZ = 'Africa/Cairo'

function toCairoDateOnly(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return ''
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)
}

type Props = {
  paymentId: string
  memberLabel?: string | null
  currentPaidAt?: string | null
  className?: string
  disabled?: boolean
  disabledReason?: string | null
}

export default function EditPaymentDateButton({
  paymentId,
  memberLabel,
  currentPaidAt,
  className,
  disabled = false,
  disabledReason,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [paymentDate, setPaymentDate] = useState(() => toCairoDateOnly(currentPaidAt))

  const safeLabel = useMemo(() => {
    const s = String(memberLabel ?? '').trim()
    return s || 'this payment'
  }, [memberLabel])

  async function onSave() {
    if (busy || disabled) return
    if (!paymentDate) {
      toast.error('Missing payment date')
      return
    }

    setBusy(true)
    try {
      const r = await fetch(`/api/admin/payments/${paymentId}/payment-date`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ payment_date: paymentDate }),
      })

      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j?.ok) {
        toast.error('Payment date update failed', {
          description: j?.details || j?.error || 'Unable to update payment date.',
        })
        return
      }

      toast.success('Payment date updated', {
        description: safeLabel,
      })

      setOpen(false)
      router.refresh()
    } catch (e: any) {
      toast.error('Network error', {
        description: e?.message || String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen(true)
        }}
        disabled={disabled}
        title={disabledReason || undefined}
        className={
          (className ?? '') +
          ` rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-semibold ${disabled ? 'cursor-not-allowed bg-[hsl(var(--bg))] text-[hsl(var(--muted))] opacity-70' : 'bg-white hover:bg-black/[0.03]'}`
        }
      >
        {disabled ? 'Locked' : 'Edit date'}
      </button>
    )
  }

  return (
    <div className={(className ?? '') + ' min-w-[280px] rounded-2xl border border-[hsl(var(--border))] bg-white p-3'}>
      <div className="text-sm font-semibold text-black">Correct payment date</div>
      <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted))]">
        Use the real payment date for historical entries. The technical recorded-at timestamp stays unchanged.
      </p>

      <div className="mt-3 space-y-2">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
          Payment date (Egypt)
        </label>
        <input
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            if (busy) return
            setOpen(false)
            setPaymentDate(toCairoDateOnly(currentPaidAt))
          }}
          disabled={busy}
          className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03] disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!paymentDate || busy || disabled}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save date'}
        </button>
      </div>
    </div>
  )
}
