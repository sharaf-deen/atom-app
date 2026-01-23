'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

type Props = {
  href?: string
  /** Polling interval in ms (fallback if no events are dispatched). Default: 5000 */
  pollMs?: number
  className?: string
}

function fmtCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

export default function NotificationsBell({ href = '/notifications', pollMs = 5000, className = '' }: Props) {
  const [count, setCount] = useState<number>(0)
  const mounted = useRef(false)

  async function fetchCount() {
    try {
      const r = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) return
      const n = Number(j?.count || 0)
      if (Number.isFinite(n)) setCount(n)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    mounted.current = true
    fetchCount()

    function onVisibility() {
      if (document.visibilityState === 'visible') fetchCount()
    }

    function onNotifChanged() {
      // Any part of the app can dispatch this event after marking messages read
      fetchCount()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('atom:notifications:changed', onNotifChanged as any)
    window.addEventListener('notifications:updated', onNotifChanged as any)

    const t = pollMs > 0 ? window.setInterval(fetchCount, pollMs) : 0

    return () => {
      mounted.current = false
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('atom:notifications:changed', onNotifChanged as any)
      window.removeEventListener('notifications:updated', onNotifChanged as any)
      if (t) window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs])

  const show = count > 0
  const label = show ? `Notifications (${count} unread)` : 'Notifications'

  return (
    <Link
      href={href}
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
