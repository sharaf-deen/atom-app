'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

type Props = {
  href?: string
  label?: string
  desc?: string
  /** Initial count (server-rendered). */
  initialCount?: number
  /** Polling interval in ms while the app is visible. Default: 5000 */
  pollMs?: number
  /** Polling interval in ms while the app is hidden/in background. Default: 30000 */
  pollHiddenMs?: number
}

function fmtCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

export default function HomeNotificationsTile({
  href = '/notifications',
  label = 'Notifications',
  desc,
  initialCount = 0,
  pollMs = 5000,
  pollHiddenMs = 30000,
}: Props) {
  const [count, setCount] = useState<number>(Number(initialCount) || 0)
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
    // First refresh + start eco timer
    fetchCount()
    setTimer(currentPollMs())

    function onVisibility() {
      // Eco mode: slow down in background; refresh immediately when visible
      if (document.visibilityState === 'visible') fetchCount()
      setTimer(currentPollMs())
    }

    function onFocus() {
      fetchCount()
      setTimer(currentPollMs())
    }

    function onNotifChanged() {
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

  const unread = count > 0

  return (
    <Link
      href={href}
      className={
        'group block rounded-2xl border border-[hsl(var(--border))] bg-white p-5 shadow-soft transition ease-soft hover:shadow-md hover:shadow-black/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
        (unread ? 'border-red-200 bg-red-50 hover:shadow-red-100' : '')
      }
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className={'text-lg font-semibold tracking-tight ' + (unread ? 'text-red-700' : '')}>{label}</h3>
          {unread ? (
            <span
              className="inline-flex min-w-[24px] h-6 items-center justify-center rounded-full bg-red-600 px-2 text-xs font-bold text-white"
              aria-label={`${count} unread notifications`}
              title={`${count} unread notifications`}
            >
              {fmtCount(count)}
            </span>
          ) : null}
        </div>
        <span
          aria-hidden
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[hsl(var(--border))] transition group-hover:translate-x-0.5"
        >
          <Bell size={18} strokeWidth={2.2} className={unread ? 'text-red-700' : 'text-black'} />
        </span>
      </div>
    </Link>
  )
}
