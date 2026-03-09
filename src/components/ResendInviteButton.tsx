'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

type Props = {
  userId: string
  email?: string | null
  className?: string
}

type Status =
  | 'loading'
  | 'active'
  | 'pending'
  | 'missing_auth_user'
  | 'not_found'
  | 'forbidden'
  | 'unknown'

const LS_KEY_PREFIX = 'atom:resend_invite_cooldown:'
const LS_RESET_KEY_PREFIX = 'atom:reset_password_cooldown:'
const TICK_MS = 1000

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

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export default function ResendInviteButton({ userId, email, className }: Props) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const [resetBusy, setResetBusy] = useState(false)
  const [resetConfirming, setResetConfirming] = useState(false)

  const [status, setStatus] = useState<Status>('loading')
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)

  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [resetCooldownUntil, setResetCooldownUntil] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState<number>(() => Date.now())

  const emailNorm = useMemo(() => String(email ?? '').trim(), [email])
  const hasEmail = !!emailNorm

  const inCooldown = useMemo(
    () => (cooldownUntil ? nowTick < cooldownUntil : false),
    [cooldownUntil, nowTick],
  )
  const cooldownLeft = useMemo(
    () => (cooldownUntil ? Math.max(0, cooldownUntil - nowTick) : null),
    [cooldownUntil, nowTick],
  )

  const inResetCooldown = useMemo(
    () => (resetCooldownUntil ? nowTick < resetCooldownUntil : false),
    [resetCooldownUntil, nowTick],
  )
  const resetCooldownLeft = useMemo(
    () => (resetCooldownUntil ? Math.max(0, resetCooldownUntil - nowTick) : null),
    [resetCooldownUntil, nowTick],
  )

  const cooldownKey = useMemo(() => `${LS_KEY_PREFIX}${userId}`, [userId])
  const resetCooldownKey = useMemo(() => `${LS_RESET_KEY_PREFIX}${userId}`, [userId])

  useEffect(() => {
    if ((!cooldownUntil || !inCooldown) && (!resetCooldownUntil || !inResetCooldown)) return

    const id = window.setInterval(() => setNowTick(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [cooldownUntil, inCooldown, resetCooldownUntil, inResetCooldown])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(cooldownKey)
      if (!raw) return
      const v = Number(raw)
      if (!Number.isFinite(v)) return
      if (v > Date.now()) {
        setCooldownUntil(v)
        setNowTick(Date.now())
      } else {
        window.localStorage.removeItem(cooldownKey)
      }
    } catch {
      // ignore
    }
  }, [cooldownKey])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(resetCooldownKey)
      if (!raw) return
      const v = Number(raw)
      if (!Number.isFinite(v)) return
      if (v > Date.now()) {
        setResetCooldownUntil(v)
        setNowTick(Date.now())
      } else {
        window.localStorage.removeItem(resetCooldownKey)
      }
    } catch {
      // ignore
    }
  }, [resetCooldownKey])

  function setCooldownSeconds(sec: number) {
    const until = Date.now() + Math.max(0, sec) * 1000
    setCooldownUntil(until)
    setNowTick(Date.now())
    try {
      window.localStorage.setItem(cooldownKey, String(until))
    } catch {
      // ignore
    }
  }

  function clearCooldown() {
    setCooldownUntil(null)
    try {
      window.localStorage.removeItem(cooldownKey)
    } catch {
      // ignore
    }
  }

  function setResetCooldownSeconds(sec: number) {
    const until = Date.now() + Math.max(0, sec) * 1000
    setResetCooldownUntil(until)
    setNowTick(Date.now())
    try {
      window.localStorage.setItem(resetCooldownKey, String(until))
    } catch {
      // ignore
    }
  }

  function clearResetCooldown() {
    setResetCooldownUntil(null)
    try {
      window.localStorage.removeItem(resetCooldownKey)
    } catch {
      // ignore
    }
  }

  const loadingRef = useRef(false)
  async function refreshStatus() {
    if (loadingRef.current) return
    loadingRef.current = true

    try {
      const r = await fetch(`/api/members/${userId}/invite-status`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-store' },
      })
      const j = await r.json().catch(() => ({} as any))

      if (!r.ok) {
        setStatus(
          (j?.status as Status) ||
            (r.status === 403 ? 'forbidden' : r.status === 404 ? 'not_found' : 'unknown'),
        )
        return
      }

      setStatus((j?.status as Status) || 'unknown')
      setLastSentAt(j?.last_invite_sent_at ?? null)

      const retryAfter = Number(j?.retry_after_seconds ?? 0)
      if (retryAfter > 0) setCooldownSeconds(retryAfter)
    } catch {
      setStatus('unknown')
    } finally {
      loadingRef.current = false
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!alive) return
      await refreshStatus()
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function doResend() {
    if (busy || resetBusy || !hasEmail || inCooldown) return

    if (status === 'missing_auth_user') {
      toast.error('Cannot resend invite', {
        description:
          'This member profile has no matching auth user. Please re-create the member or contact support.',
      })
      setConfirming(false)
      return
    }

    setBusy(true)
    try {
      const r = await fetch(`/api/members/${userId}/resend-invite`, {
        method: 'POST',
        headers: { 'Cache-Control': 'no-store' },
      })
      const retryAfterHeader = Number(r.headers.get('Retry-After') || '0')
      const j = await r.json().catch(() => ({} as any))

      if (r.ok) {
        toast.success('Invite resent', {
          description: emailNorm ? `Sent to ${emailNorm}` : undefined,
        })

        setLastSentAt(new Date().toISOString())
        setStatus('pending')
        setConfirming(false)
        setResetConfirming(false)

        if (retryAfterHeader > 0) setCooldownSeconds(retryAfterHeader)
        else clearCooldown()

        setTimeout(() => {
          refreshStatus().catch(() => {})
        }, 600)

        return
      }

      if (r.status === 429) {
        const retryAfter = retryAfterHeader || Number(j?.retry_after_seconds || 0)
        if (retryAfter > 0) {
          setCooldownSeconds(retryAfter)
          toast.error('Please wait before resending', {
            description: `Try again in ~${msToHuman(retryAfter * 1000)}.`,
          })
        } else {
          toast.error(j?.details || 'Rate limited. Try again later.')
        }
        setConfirming(false)
        return
      }

      if (r.status === 409) {
        const errCode = String(j?.error || '').toUpperCase()
        const details = j?.details || 'Conflict.'
        toast.error('Cannot resend invite', { description: details })

        if (errCode.includes('ALREADY_ACTIVE')) {
          setStatus('active')
        }
        if (errCode.includes('ORPHAN_PROFILE')) {
          setStatus('missing_auth_user')
        }

        setConfirming(false)
        return
      }

      if (r.status === 403) {
        setStatus('forbidden')
        toast.error('Forbidden', { description: 'You do not have permission to resend invites.' })
        setConfirming(false)
        return
      }
      if (r.status === 404) {
        setStatus('not_found')
        toast.error('Not found', { description: 'This member no longer exists.' })
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

  async function doReset() {
    if (busy || resetBusy || inResetCooldown) return

    setResetBusy(true)
    try {
      const r = await fetch(`/api/members/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Cache-Control': 'no-store' },
      })
      const retryAfterHeader = Number(r.headers.get('Retry-After') || '0')
      const j = await r.json().catch(() => ({} as any))

      if (r.ok) {
        const retryAfter = Number(j?.retry_after_seconds || 0)
        if (retryAfter > 0) setResetCooldownSeconds(retryAfter)
        else clearResetCooldown()

        toast.success('Password reset email sent', {
          description: j?.email ? `Sent to ${j.email}` : 'The member can now choose a new password.',
        })
        setResetConfirming(false)
        setConfirming(false)
        setStatus('active')
        return
      }

      if (r.status === 429) {
        const retryAfter = retryAfterHeader || Number(j?.retry_after_seconds || 0)
        if (retryAfter > 0) {
          setResetCooldownSeconds(retryAfter)
          toast.error('Please wait before sending another reset email', {
            description: `Try again in ~${msToHuman(retryAfter * 1000)}.`,
          })
        } else {
          toast.error(j?.details || 'Rate limited. Try again later.')
        }
        setResetConfirming(false)
        return
      }

      if (r.status === 409) {
        const errCode = String(j?.error || '').toUpperCase()
        const details = j?.details || 'Conflict.'

        if (errCode.includes('INVITE_PENDING')) {
          setStatus('pending')
          toast.error('Cannot send reset email', {
            description: 'This account is not active yet. Use Resend invite instead.',
          })
        } else if (errCode.includes('ORPHAN_PROFILE')) {
          setStatus('missing_auth_user')
          toast.error('Cannot send reset email', {
            description: details,
          })
        } else {
          toast.error('Cannot send reset email', {
            description: details,
          })
        }

        setResetConfirming(false)
        return
      }

      if (r.status === 403) {
        setStatus('forbidden')
        toast.error('Forbidden', { description: 'You do not have permission to send reset emails.' })
        setResetConfirming(false)
        return
      }
      if (r.status === 404) {
        setStatus('not_found')
        toast.error('Not found', { description: 'This member no longer exists.' })
        setResetConfirming(false)
        return
      }
      if (r.status === 400) {
        toast.error('Cannot send reset email', {
          description: j?.details || 'This member does not have a usable email address.',
        })
        setResetConfirming(false)
        return
      }

      toast.error(j?.details || j?.error || 'Reset password failed')
      setResetConfirming(false)
    } catch (e: any) {
      toast.error('Network error', { description: e?.message || String(e) })
      setResetConfirming(false)
    } finally {
      setResetBusy(false)
    }
  }

  const badge = (() => {
    if (status === 'loading') return { text: 'Checking…', cls: 'bg-gray-50 border-gray-200 text-gray-700' }
    if (status === 'active') return { text: 'Active', cls: 'bg-emerald-50 border-emerald-200 text-emerald-900' }
    if (status === 'pending') return { text: 'Invite pending', cls: 'bg-amber-50 border-amber-200 text-amber-900' }
    if (status === 'missing_auth_user') return { text: 'Orphan profile', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    if (status === 'forbidden') return { text: 'Forbidden', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    if (status === 'not_found') return { text: 'Not found', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    return { text: 'Invite status unknown', cls: 'bg-gray-50 border-gray-200 text-gray-700' }
  })()

  const badgeTitle = lastSentAt ? `Last invite: ${lastSentAt}` : undefined
  const badgeExtra = lastSentAt ? ` • ${fmtRelative(lastSentAt)}` : ''

  if (status === 'active') {
    if (inResetCooldown) {
      const left = isFiniteNumber(resetCooldownLeft) ? resetCooldownLeft : 0
      return (
        <div className={`flex items-center gap-2 ${className ?? ''}`}>
          <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
            {badge.text}
          </span>
          <button
            disabled
            className="rounded-xl px-4 py-2 text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed"
            title="Rate limited"
          >
            Reset in {msToHuman(left)}
          </button>
        </div>
      )
    }

    if (resetConfirming) {
      return (
        <div className={`flex items-center gap-2 ${className ?? ''}`}>
          <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
            {badge.text}
          </span>

          <button
            onClick={() => setResetConfirming(false)}
            disabled={resetBusy}
            className="rounded-xl px-3 py-2 text-sm font-medium border border-[hsl(var(--border))] bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            onClick={doReset}
            disabled={resetBusy}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${
              resetBusy ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
            }`}
            title="Send a password reset email"
          >
            {resetBusy ? 'Sending…' : 'Confirm reset email'}
          </button>
        </div>
      )
    }

    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
          {badge.text}
        </span>

        <button
          onClick={() => setResetConfirming(true)}
          disabled={resetBusy || busy}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${
            resetBusy || busy ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-black text-white hover:opacity-90'
          }`}
          title="Send password reset email"
        >
          {resetBusy ? 'Sending…' : 'Reset password'}
        </button>
      </div>
    )
  }

  if (!hasEmail) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
          {badge.text}
        </span>
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

  if (inCooldown) {
    const left = isFiniteNumber(cooldownLeft) ? cooldownLeft : 0
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
          {badge.text}
          {badgeExtra}
        </span>
        <button
          disabled
          className="rounded-xl px-4 py-2 text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed"
          title="Rate limited"
        >
          Resend in {msToHuman(left)}
        </button>
      </div>
    )
  }

  if (confirming) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
          {badge.text}
          {badgeExtra}
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

  const disabledMain = busy || resetBusy || status === 'missing_auth_user' || status === 'forbidden' || status === 'not_found'

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
        {badge.text}
        {badgeExtra}
      </span>

      <button
        onClick={() => setConfirming(true)}
        disabled={disabledMain}
        className={`rounded-xl px-4 py-2 text-sm font-medium ${
          disabledMain ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-black text-white hover:opacity-90'
        }`}
        title={
          status === 'missing_auth_user'
            ? 'Orphan profile (no matching auth user).'
            : status === 'forbidden'
              ? 'Forbidden.'
              : status === 'not_found'
                ? 'Member not found.'
                : `Resend invite to ${emailNorm}`
        }
      >
        {busy ? 'Resending…' : 'Resend invite'}
      </button>
    </div>
  )
}
