// src/app/scan/result/AutoReturn.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type AutoReturnProps = {
  /** Seconds before redirecting back to the scanner (default: 7) */
  seconds?: number
  /** Destination route (default: /scan) */
  href?: string
  /** Hide the countdown text */
  hideText?: boolean
}

type VerifyRes = { ok: boolean; message?: string }

type WakeLockSentinel = { release: () => Promise<void> }

function isKioskUrl(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search)
    return sp.get('kiosk') === '1'
  } catch {
    return false
  }
}

function isKioskStored(): boolean {
  try {
    return window.localStorage.getItem('atom:kiosk') === '1'
  } catch {
    return false
  }
}

export default function AutoReturn({ seconds = 7, href = '/scan', hideText }: AutoReturnProps) {
  const router = useRouter()
  const [left, setLeft] = useState<number>(seconds)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const kiosk = typeof window !== 'undefined' ? (isKioskUrl() || isKioskStored()) : false
  const hrefFinal = kiosk && href === '/scan' ? '/scan?kiosk=1' : href

  // Keep kiosk CSS active on result pages too
  useEffect(() => {
    if (!kiosk) return
    document.body.classList.add('kiosk-mode')
    try {
      window.localStorage.setItem('atom:kiosk', '1')
    } catch {}

    const requestWake = async () => {
      try {
        // @ts-expect-error wakeLock is not yet in TS lib everywhere
        const wl = await navigator.wakeLock?.request?.('screen')
        if (wl) wakeLockRef.current = wl
      } catch {
        // ignore
      }
    }

    requestWake()

    return () => {
      document.body.classList.remove('kiosk-mode')
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
  }, [kiosk])

  useEffect(() => {
    setLeft(seconds)

    // Countdown
    const interval = window.setInterval(() => {
      setLeft((prev) => Math.max(0, prev - 1))
    }, 1000)

    // Redirect (replace so Back doesn't return to result)
    const timeout = window.setTimeout(() => {
      router.replace(hrefFinal)
    }, Math.max(0, seconds) * 1000)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [seconds, hrefFinal, router])

  async function exitKiosk() {
    const pin = window.prompt('Enter kiosk PIN to exit')
    if (!pin) return

    try {
      const r = await fetch('/api/kiosk/verify-exit-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const j: VerifyRes = await r.json().catch(() => ({ ok: false }))
      if (!r.ok || !j.ok) {
        window.alert(j.message || 'Invalid PIN')
        return
      }

      try {
        window.localStorage.setItem('atom:kiosk', '0')
      } catch {}
      document.body.classList.remove('kiosk-mode')

      // Best-effort exit native fullscreen if used
      try {
        ;(document as any).exitFullscreen?.()
      } catch {}

      router.replace('/scan')
    } catch {
      window.alert('Failed to verify PIN')
    }
  }

  return (
    <div className={kiosk ? 'relative' : ''}>
      {kiosk ? (
        <button
          type="button"
          onClick={exitKiosk}
          className="fixed bottom-4 right-4 z-50 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft"
          title="Exit kiosk"
        >
          Exit kiosk
        </button>
      ) : null}

      {hideText ? null : (
        <p className="text-sm text-[hsl(var(--muted))]">
          Returning to scanner in <span className="font-semibold">{left}</span>s…
        </p>
      )}
    </div>
  )
}
