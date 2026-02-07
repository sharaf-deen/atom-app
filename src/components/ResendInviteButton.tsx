// src/components/ResendInviteButton.tsx
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

const LS_KEY_PREFIX = 'atom:resend_invite_cooldown:' // + userId
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

  const [status, setStatus] = useState<Status>('loading')
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)

  // cooldownUntil is epoch ms
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
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

  const cooldownKey = useMemo(() => `${LS_KEY_PREFIX}${userId}`, [userId])

  // tick for countdown (only when needed)
  useEffect(() => {
    if (!cooldownUntil) return
    if (!inCooldown) return

    const id = window.setInterval(() => setNowTick(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [cooldownUntil, inCooldown])

  // restore cooldown from localStorage
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

  // Load invite status (and last sent)
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
        // Server may send a status field; fallback to unknown
        setStatus((j?.status as Status) || (r.status === 403 ? 'forbidden' : r.status === 404 ? 'not_found' : 'unknown'))
        return
      }

      setStatus((j?.status as Status) || 'unknown')
      setLastSentAt(j?.last_invite_sent_at ?? null)

      // Optionnel: si backend renvoie un cooldown/retry-after, on peut l’honorer
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
    if (busy || !hasEmail || inCooldown) return

    // Safety: profile has no auth user -> block resend (prevents mismatch)
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
        toast.success('Invite resent ✅', {
          description: emailNorm ? `Sent to ${emailNorm}` : undefined,
        })

        setLastSentAt(new Date().toISOString())
        setStatus('pending')
        setConfirming(false)

        // if server tells retry-after, lock the button
        if (retryAfterHeader > 0) setCooldownSeconds(retryAfterHeader)
        else clearCooldown()

        // refresh status shortly after (helps if backend updates status)
        setTimeout(() => {
          refreshStatus().catch(() => {})
        }, 600)

        return
      }

      // 429 rate limit
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

      // 409 conflict (already active / orphan etc.)
      if (r.status === 409) {
        const errCode = String(j?.error || '').toUpperCase()
        const details = j?.details || 'Conflict.'
        toast.error(details)

        if (errCode.includes('ALREADY_ACTIVE')) {
          setStatus('active')
        }
        if (errCode.includes('ORPHAN_PROFILE')) {
          setStatus('missing_auth_user')
        }

        setConfirming(false)
        return
      }

      // 403/404
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

  const badge = (() => {
    if (status === 'loading') return { text: 'Checking…', cls: 'bg-gray-50 border-gray-200 text-gray-700' }
    if (status === 'active') return { text: 'Active', cls: 'bg-emerald-50 border-emerald-200 text-emerald-900' }
    if (status === 'pending') return { text: 'Invite pending', cls: 'bg-amber-50 border-amber-200 text-amber-900' }
    if (status === 'missing_auth_user') return { text: 'Orphan profile', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    if (status === 'forbidden') return { text: 'Forbidden', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    if (status === 'not_found') return { text: 'Not found', cls: 'bg-rose-50 border-rose-200 text-rose-900' }
    return { text: 'Invite status unknown', cls: 'bg-gray-50 border-gray-200 text-gray-700' }
  })()

  const badgeTitle = lastSentAt ? `Last: ${lastSentAt}` : undefined
  const badgeExtra = lastSentAt ? ` • ${fmtRelative(lastSentAt)}` : ''

  // Active => badge only (hide button)
  if (status === 'active') {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className={`text-[11px] px-2 py-1 rounded-2xl border ${badge.cls}`} title={badgeTitle}>
          {badge.text}
        </span>
      </div>
    )
  }

  // No email => disabled UI with badge
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

  // Cooldown UI (live countdown)
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

  // Confirm step
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

  const disabledMain = busy || status === 'missing_auth_user' || status === 'forbidden' || status === 'not_found'

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
