// src/components/ResendInviteButton.tsx
'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type Props = {
  userId: string
  email?: string | null
  className?: string
}

function msToHuman(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s <= 60) return `${s}s`
  const m = Math.ceil(s / 60)
  return `${m}m`
}

export default function ResendInviteButton({ userId, email, className }: Props) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)

  const emailNorm = useMemo(() => String(email ?? '').trim(), [email])
  const hasEmail = !!emailNorm

  const inCooldown = useMemo(() => {
    if (!cooldownUntil) return false
    return Date.now() < cooldownUntil
  }, [cooldownUntil])

  const cooldownLeft = useMemo(() => {
    if (!cooldownUntil) return null
    const ms = cooldownUntil - Date.now()
    return ms > 0 ? ms : null
  }, [cooldownUntil])

  async function doResend() {
    if (busy || !hasEmail || inCooldown) return

    setBusy(true)
    try {
      const r = await fetch(`/api/members/${userId}/resend-invite`, { method: 'POST' })
      const retryAfter = Number(r.headers.get('Retry-After') || '0')

      const j = await r.json().catch(() => ({} as any))

      if (r.ok) {
        toast.success('Invite resent ✅', {
          description: emailNorm ? `Sent to ${emailNorm}` : undefined,
        })
        setConfirming(false)
        return
      }

      // 429 Rate limit
      if (r.status === 429) {
        if (retryAfter > 0) {
          setCooldownUntil(Date.now() + retryAfter * 1000)
          toast.error('Please wait before resending', {
            description: `Try again in ~${msToHuman(retryAfter * 1000)}.`,
          })
        } else {
          toast.error(j?.details || 'Rate limited. Try again later.')
        }
        setConfirming(false)
        return
      }

      // 409 Already active / orphan / conflict
      if (r.status === 409) {
        toast.error(j?.details || 'This account is already active. Use password reset instead.')
        setConfirming(false)
        return
      }

      // Other errors
      toast.error(j?.details || j?.error || 'Resend failed')
      setConfirming(false)
    } catch (e: any) {
      toast.error('Network error', { description: e?.message || String(e) })
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  if (!hasEmail) {
    return (
      <button
        disabled
        className={`rounded-xl px-4 py-2 text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed ${className ?? ''}`}
        title="This member has no email"
      >
        Resend invite
      </button>
    )
  }

  // Cooldown UI
  if (inCooldown) {
    return (
      <button
        disabled
        className={`rounded-xl px-4 py-2 text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed ${className ?? ''}`}
        title="Rate limited"
      >
        Resend in {cooldownLeft ? msToHuman(cooldownLeft) : '…'}
      </button>
    )
  }

  // Confirm step
  if (confirming) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-xl px-3 py-2 text-sm font-medium border border-[hsl(var(--border))] bg-white hover:bg-gray-50 disabled:opacity-60"
        >
          Cancel
        </button>

        <button
          onClick={doResend}
          disabled={busy}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${
            busy ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
          }`}
          title={`Send invite to ${emailNorm}`}
        >
          {busy ? 'Sending…' : 'Confirm send'}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={busy}
      className={`rounded-xl px-4 py-2 text-sm font-medium ${
        busy ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
      } ${className ?? ''}`}
      title={`Resend invite to ${emailNorm}`}
    >
      {busy ? 'Resending…' : 'Resend invite'}
    </button>
  )
}
