// src/app/scan/result/AutoReturn.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatRequestRef } from '@/lib/requestRef'

type AutoReturnProps = {
  seconds?: number
  href?: string
  hideText?: boolean
  terminalLocked?: boolean
  terminalFullScreen?: boolean
}

type VerifyRes = { ok: boolean; message?: string; request_id?: string; error?: string }

type WakeLockSentinel = {
  release?: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

const TERMINAL_FULLSCREEN_STORAGE_KEY = 'atom:scan-terminal:fullscreen'

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

function writeTerminalFullscreenPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(TERMINAL_FULLSCREEN_STORAGE_KEY, enabled ? '1' : '0')
  } catch {}
}

export default function AutoReturn({
  seconds = 7,
  href = '/scan',
  hideText,
  terminalLocked = false,
  terminalFullScreen = false,
}: AutoReturnProps) {
  const router = useRouter()
  const [left, setLeft] = useState<number>(seconds)
  const [online, setOnline] = useState(true)
  const [exitOpen, setExitOpen] = useState(false)
  const [exitPin, setExitPin] = useState('')
  const [exitError, setExitError] = useState<string | null>(null)
  const [exitHolding, setExitHolding] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const wakeLockListenerRef = useRef<(() => void) | null>(null)
  const exitHoldRef = useRef<number | null>(null)
  const verifyAbortRef = useRef<AbortController | null>(null)

  const kiosk = !terminalLocked && (typeof window !== 'undefined' ? isKioskUrl() || isKioskStored() : false)
  const fullScreenMode = terminalLocked && terminalFullScreen
  const hrefFinal = kiosk && href === '/scan' ? '/scan?kiosk=1' : href

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

  useEffect(() => {
    if (!kiosk && !fullScreenMode) return

    document.body.classList.add('kiosk-mode')
    if (kiosk) {
      try {
        window.localStorage.setItem('atom:kiosk', '1')
      } catch {}
    }
    if (fullScreenMode) {
      writeTerminalFullscreenPreference(true)
    }

    const releaseWakeLock = async () => {
      const listener = wakeLockListenerRef.current
      const current = wakeLockRef.current
      if (listener && current?.removeEventListener) {
        try {
          current.removeEventListener('release', listener)
        } catch {}
      }
      wakeLockListenerRef.current = null
      wakeLockRef.current = null
      if (current?.release) {
        try {
          await current.release()
        } catch {}
      }
    }

    const requestWake = async () => {
      if (wakeLockRef.current) return
      try {
        const wl = await (navigator as any).wakeLock?.request?.('screen')
        if (!wl) return
        const onRelease = () => {
          wakeLockRef.current = null
        }
        wakeLockListenerRef.current = onRelease
        if (wl.addEventListener) {
          try {
            wl.addEventListener('release', onRelease)
          } catch {}
        }
        wakeLockRef.current = wl
      } catch {
        // ignore
      }
    }

    const requestBrowserFullscreen = async () => {
      if (!fullScreenMode) return
      const target = document.documentElement as any
      if (document.fullscreenElement || !target?.requestFullscreen) return
      try {
        await target.requestFullscreen()
      } catch {
        // ignore
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWake().catch(() => {})
        requestBrowserFullscreen().catch(() => {})
      }
    }

    requestWake().catch(() => {})
    requestBrowserFullscreen().catch(() => {})
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.body.classList.remove('kiosk-mode')
      document.removeEventListener('visibilitychange', onVisibilityChange)
      releaseWakeLock().catch(() => {})
    }
  }, [fullScreenMode, kiosk])

  useEffect(() => {
    if (exitOpen) return
    setLeft(seconds)

    const interval = window.setInterval(() => {
      setLeft((prev) => Math.max(0, prev - 1))
    }, 1000)

    const timeout = window.setTimeout(() => {
      router.replace(hrefFinal)
    }, Math.max(0, seconds) * 1000)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [seconds, hrefFinal, router, exitOpen])

  useEffect(() => {
    return () => {
      if (exitHoldRef.current) window.clearTimeout(exitHoldRef.current)
      verifyAbortRef.current?.abort()
    }
  }, [])

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
    }, 2000)
  }

  function openTerminalExit() {
    setExitHolding(false)
    setExitError(null)
    setExitPin('')
    setExitOpen(true)
  }

  function closeExitModal() {
    cancelExitHold()
    verifyAbortRef.current?.abort()
    setExitOpen(false)
    setExitError(null)
    setExitPin('')
  }

  async function confirmProtectedExit() {
    setExitError(null)

    if (!online || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      setExitError(fullScreenMode ? 'Offline — reconnect to verify PIN' : 'Offline — reconnect to verify PIN')
      return
    }

    verifyAbortRef.current?.abort()
    const controller = new AbortController()
    verifyAbortRef.current = controller

    try {
      const endpoint = fullScreenMode ? '/api/scan-terminal/verify-pin' : '/api/kiosk/verify-exit-pin'
      const r = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: exitPin || '' }),
        signal: controller.signal,
      })
      const j: VerifyRes = await r.json().catch(() => ({ ok: false }))
      const requestId = String(j.request_id || r.headers.get('x-request-id') || '').trim() || null
      if (!r.ok || !j.ok) {
        const message = typeof j.error === 'string' ? j.error : j.message || 'Invalid PIN'
        setExitError(formatRequestRef(message, requestId, 'paren'))
        return
      }

      if (fullScreenMode) {
        writeTerminalFullscreenPreference(false)
        document.body.classList.remove('kiosk-mode')
        try {
          ;(document as any).exitFullscreen?.()
        } catch {}
        closeExitModal()
        router.replace('/scan')
        return
      }

      try {
        window.localStorage.setItem('atom:kiosk', '0')
      } catch {}
      document.body.classList.remove('kiosk-mode')

      try {
        ;(document as any).exitFullscreen?.()
      } catch {}

      closeExitModal()
      router.replace('/scan')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setExitError(
        !online || (typeof navigator !== 'undefined' && !navigator.onLine)
          ? 'Offline — reconnect to verify PIN'
          : fullScreenMode
            ? 'Failed to verify terminal PIN'
            : 'Failed to verify PIN'
      )
    } finally {
      if (verifyAbortRef.current === controller) verifyAbortRef.current = null
    }
  }

  return (
    <div className={kiosk || fullScreenMode ? 'relative' : ''}>
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
      ) : fullScreenMode ? (
        <button
          type="button"
          onClick={openTerminalExit}
          className="fixed right-4 top-4 z-50 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-soft"
          title="Exit full screen"
        >
          Exit full screen
        </button>
      ) : null}

      {exitOpen ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-white p-4 text-gray-900 shadow-soft">
            <div className="text-base font-semibold">{fullScreenMode ? 'Exit terminal full screen' : 'Exit kiosk'}</div>
            <p className="mt-1 text-sm text-gray-600">
              {fullScreenMode ? 'Enter the terminal PIN to leave full screen and keep the scanner on this tablet.' : 'Hold confirmed. Enter PIN to exit kiosk mode.'}
            </p>
            {!online ? <p className="mt-2 text-sm text-rose-700">Offline — reconnect to verify PIN.</p> : null}

            <input
              className="mt-3 w-full rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm outline-none"
              type="password"
              inputMode="numeric"
              placeholder="PIN"
              value={exitPin}
              onChange={(e) => setExitPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmProtectedExit()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeExitModal()
                }
              }}
              autoFocus
            />

            {exitError ? <p className="mt-2 text-sm text-rose-700">{exitError}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeExitModal}
                className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmProtectedExit}
                className="rounded-xl bg-black px-3 py-2 text-sm font-medium text-white"
              >
                {fullScreenMode ? 'Exit full screen' : 'Exit kiosk'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!hideText ? <div className="mt-3 text-center text-xs text-[hsl(var(--muted))]">Returning to scanner in {left}s…</div> : null}
    </div>
  )
}
