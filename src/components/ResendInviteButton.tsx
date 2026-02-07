// src/components/ResendInviteButton.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

type Props = {
  userId: string
  email?: string | null
  className?: string
}

type Status = 'loading' | 'active' | 'pending' | 'missing_auth_user' | 'not_found' | 'forbidden' | 'unknown'

function fmtRelative(iso?: string | null) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const diff = Date.now() - t
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
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

  const [status, setStatus] = useState<Status>('loading')
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)

  const emailNorm = useMemo(() => String(email ?? '').trim(), [email])
  const hasEmail = !!emailNorm

  const inCooldown = useMemo(() => (cooldownUntil ? Date.now() < cooldownUntil : false), [cooldownUntil])
  const cooldownLeft = useMemo(() => (cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : null), [cooldownUntil])

  // Load invite status
  useEffect(() => {
    let alive = true

    async function run() {
      try {
        const r = await fetch(`/api/members/${userId}/invite-status`, { method: 'GET' })
        const j = await r.json().catch(() => ({} as any))

        if (!alive) return

        if (!r.ok) {
          setStatus(j?.status || 'unknown')
          return
        }

        setStatus((j?.status as Status) || 'unknown')
        setLastSentAt(j?.last_invite_sent_at ?? null)
      } catch {
        if (!alive) return
        setStatus('unknown')
      }
    }

    run()
    return () => {
      alive = false
    }
  }, [userId])

  async function doResend() {
    if (busy || !hasEmail || inCooldown) return

    // Safety: if profile has no auth user, block resend (prevents mismatch)
    if (status === 'missing_auth_user') {
      toast.error('Cannot resend invite', {
        description: 'This member profile has no matching auth user. Please re-create the member or contact support.',
      })
      setConfirming(false)
      return
    }

    setBusy(true)
    try {
      const r = await fetch(`/api/members/${userId}/resend-invite`, { method: 'POST' })
      const retryAfter = Number(r.headers.get('Retry-After') || '0')
      const j = await r.json().catch(() => ({} as any))

      if (r.ok) {
        toast.success('Invite resent ✅', {
          description: emailNorm ? `Sent to ${emailNorm}` : undefined,
        })
        setLastSentAt(new Date().toISOString())
        setConfirming(false)
        setStatus('pending')
        return
      }

      if (r.status === 429) {
        if (retryAfter > 0) {
          setCooldownUntil(Date.now() + retryAfter * 1000)
          toast.error('Please wait before resending', { description: `Try again in ~${msToHuman(retryAfter * 1000)}.` })
        } else {
          toast.error(j?.details || 'Rate limited. Try again later.')
        }
        setConfirming(false)
        return
      }

      if (r.status === 409) {
        // if already active, hide the button
        const details = j?.details || 'Account already active.'
        toast.error(details)
        if (String(j?.error || '').toUpperCase().includes('ALREADY_ACTIVE')) {
          setStatus('active')
        }
        setConfirming(false)
        return
      }

      toast.error(j?.details || j?.error || 'Resend failed')
      setConfirming(false)
    } catch (e: any) {
      toast.error('Network error', { description: e?.message || String(e) })
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  // Badge
  const badge = (() => {
    if (status === 'loading') return { text: 'Checking…', cls: 'bg-gray-50 border-gray-200 text-gray-700' }
    if (status === 'active') return { text: 'Active', cls: 'bg-emerald-50 border-emerald-200 text-emerald-900' }
    if (status === 'pending') return { text: 'Invite pending', cls: 'bg-amber-50 border-amber-200 text-amber-900' }
    if (status === 'missing_auth_user') return { text: 'Orphan profile', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    return { text: 'Invite status unknown', cls: 'bg-gray-50 border-gray-200 text-gray-700' }
  })()

  // If active => hide button, keep badge only
  if (status === 'active') {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`}>{badge.text}</span>
      </div>
    )
  }

  // If no email => disabled UI with badge
  if (!hasEmail) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`}>{badge.text}</span>
        <button
          disabled
          className="rounded-xl px-4 py-2 text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed"
          title="This member has no email"
        >
          Resend invite
        </button>
      </div>
    )
  }

  // Cooldown UI
  if (inCooldown) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`}>{badge.text}</span>
        <button
          disabled
          className="rounded-xl px-4 py-2 text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed"
          title="Rate limited"
        >
          Resend in {cooldownLeft ? msToHuman(cooldownLeft) : '…'}
        </button>
      </div>
    )
  }

  // Confirm step
  if (confirming) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={lastSentAt ? `Last: ${lastSentAt}` : ''}>
          {badge.text}
          {lastSentAt ? ` • ${fmtRelative(lastSentAt)}` : ''}
        </span>

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
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={lastSentAt ? `Last: ${lastSentAt}` : ''}>
        {badge.text}
        {lastSentAt ? ` • ${fmtRelative(lastSentAt)}` : ''}
      </span>

      <button
        onClick={() => setConfirming(true)}
        disabled={busy || status === 'missing_auth_user'}
        className={`rounded-xl px-4 py-2 text-sm font-medium ${
          busy || status === 'missing_auth_user'
            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
            : 'bg-black text-white hover:opacity-90'
        }`}
        title={
          status === 'missing_auth_user'
            ? 'Orphan profile (no matching auth user).'
            : `Resend invite to ${emailNorm}`
        }
      >
        {busy ? 'Resending…' : 'Resend invite'}
      </button>
    </div>
  )
}
