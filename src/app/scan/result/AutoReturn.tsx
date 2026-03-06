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


// Network status (offline fallback)
const [online, setOnline] = useState(true)

useEffect(() => {
  const update = () => setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)
  update()
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  return () => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  }
}, [])

  const [exitOpen, setExitOpen] = useState(false)
  const [exitPin, setExitPin] = useState('')
  const [exitError, setExitError] = useState<string | null>(null)
  const [exitHolding, setExitHolding] = useState(false)
  const exitHoldRef = useRef<number | null>(null)

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
        // @ts-ignore wakeLock may be missing in some TS libs
        const wl = await (navigator as any).wakeLock?.request?.('screen')
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
    if (exitOpen) return
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
  }, [seconds, hrefFinal, router, exitOpen])


  function cancelExitHold() {
    if (exitHoldRef.current) window.clearTimeout(exitHoldRef.current)
    exitHoldRef.current = null
    setExitHolding(false)
  }

  function startExitHold() {
    cancelExitHold()
    setExitHolding(true)
    exitHoldRef.current = window.setTimeout(() => {
      exitHoldRef.current = null
      setExitHolding(false)
      setExitError(null)
      setExitPin('')
      setExitOpen(true)
    }, 2000) as any
  }

  function closeExitModal() {
    cancelExitHold()
    setExitOpen(false)
    setExitError(null)
    setExitPin('')
  }

  async function confirmExitKiosk() {
    setExitError(null)

    if (!online || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      setExitError('Offline — reconnect to verify PIN')
      return
    }

    try {
      const r = await fetch('/api/kiosk/verify-exit-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: exitPin || '' }),
      })
      const j: VerifyRes = await r.json().catch(() => ({ ok: false }))
      if (!r.ok || !j.ok) {
        setExitError(j.message || 'Invalid PIN')
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

      closeExitModal()
      router.replace('/scan')
    } catch {
      setExitError(!online || (typeof navigator !== 'undefined' && !navigator.onLine) ? 'Offline — reconnect to verify PIN' : 'Failed to verify PIN')
    }
  }


  return (
    <div className={kiosk ? 'relative' : ''}>
      {kiosk ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
          }}
          onPointerDown={startExitHold}
          onPointerUp={cancelExitHold}
          onPointerLeave={cancelExitHold}
          onPointerCancel={cancelExitHold}
          className="fixed bottom-4 right-4 z-50 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium shadow-soft"
          title="Hold 2s to exit kiosk"
        >
          {exitHolding ? 'Holding…' : 'Hold to exit'}
        </button>
      ) : null}

      
      {exitOpen ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-white p-4 text-gray-900 shadow-soft">
            <div className="text-base font-semibold">Exit kiosk</div>
            <p className="mt-1 text-sm text-gray-600">Hold confirmed. Enter PIN to exit kiosk mode.</p>
            {!online ? <p className="mt-2 text-sm text-rose-700">Offline — reconnect to verify PIN.</p> : null}

            <input
              className="mt-3 w-full rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm outline-none"
              type="password"
              inputMode="numeric"
              placeholder="PIN"
              value={exitPin}
              onChange={(e) => setExitPin(e.target.value)}
              autoFocus
            />

            {exitError ? <p className="mt-2 text-sm text-rose-700">{exitError}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium"
                onClick={closeExitModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
                onClick={confirmExitKiosk}
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      ) : null}

{hideText ? null : (
        <p className="text-sm text-[hsl(var(--muted))]">
          Returning to scanner in <span className="font-semibold">{left}</span>s…
        </p>
      )}
    </div>
  )
}
