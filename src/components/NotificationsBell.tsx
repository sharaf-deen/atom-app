'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

type Props = {
  href?: string
  /** Polling interval in ms while the app is visible. Default: 5000 */
  pollMs?: number
  /** Polling interval in ms while the app is hidden/in background. Default: 30000 */
  pollHiddenMs?: number
  className?: string
}

function fmtCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

export default function NotificationsBell({
  href = '/notifications',
  pollMs = 5000,
  pollHiddenMs = 30000,
  className = '',
}: Props) {
  const [count, setCount] = useState<number>(0)
  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)

  async function fetchCount() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const r = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) return
      const n = Number(j?.count || 0)
      if (Number.isFinite(n)) setCount(n)
    } catch {
      // ignore
    } finally {
      inFlightRef.current = false
    }
  }

  function currentPollMs() {
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    return visible ? pollMs : pollHiddenMs
  }

  function setTimer(ms: number) {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    if (ms > 0) timerRef.current = window.setInterval(fetchCount, ms)
  }

  useEffect(() => {
    fetchCount()
    setTimer(currentPollMs())

    function onVisibility() {
      // Switch to eco interval when hidden; refresh immediately when visible
      if (document.visibilityState === 'visible') fetchCount()
      setTimer(currentPollMs())
    }

    function onFocus() {
      // If user comes back to the tab, refresh immediately
      fetchCount()
      setTimer(currentPollMs())
    }

    function onNotifChanged() {
      // Any part of the app can dispatch this event after marking messages read
      fetchCount()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('atom:notifications:changed', onNotifChanged as any)
    window.addEventListener('notifications:updated', onNotifChanged as any)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('atom:notifications:changed', onNotifChanged as any)
      window.removeEventListener('notifications:updated', onNotifChanged as any)
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, pollHiddenMs])

  const show = count > 0
  const label = show ? `Notifications (${count} unread)` : 'Notifications'

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      title={label}
      className={
        'relative inline-flex items-center justify-center rounded-xl border px-2.5 py-2 shadow-soft transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ' +
        (show ? 'border-red-500' : 'border-black/10 dark:border-white/10') +
        ' ' +
        className
      }
    >
      <Bell size={18} strokeWidth={2.2} className={show ? 'text-red-600' : 'text-black dark:text-white'} />

      {show ? (
        <span
          className="absolute -right-2 -top-2 min-w-[18px] px-1.5 h-[18px] rounded-full bg-red-600 text-white text-[11px] leading-[18px] text-center font-semibold shadow"
          aria-hidden
        >
          {fmtCount(count)}
        </span>
      ) : null}
    </Link>
  )
}
