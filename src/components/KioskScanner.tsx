// src/components/KioskScanner.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'

type ScanResponse = {
  ok: boolean
  valid?: boolean
  message?: string
  member_id?: string
  subscription_id?: string | null
  days_remaining?: number | null
  expires_on?: string | null
  expired_days?: number | null
  expired_on?: string | null
  frozen?: boolean
  frozen_until?: string | null
  freeze_days_remaining?: number | null
}

type Detected = { rawValue: string }

function parseMemberText(text: string): string | null {
  const t = (text || '').trim()
  if (!t) return null
  if (t.startsWith('atom:')) return t.slice(5)
  if (t.startsWith('ATOM:')) return t.slice(5)
  if (/^[0-9a-f-]{36}$/i.test(t)) return t
  return null
}

function errToString(err: unknown) {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as any).message
    if (typeof m === 'string') return m
  }
  try {
    return JSON.stringify(err)
  } catch {}
  return 'Camera error'
}

type Status = 'idle' | 'checking' | 'ok' | 'invalid' | 'error'

type KioskScannerProps = {
  /** sm ≈ 280px, md ≈ 360px, lg ≈ 480px (largeur du cadre vidéo) */
  size?: 'sm' | 'md' | 'lg'
  /** '4:3' (par défaut) ou '1:1' (carré) */
  ratio?: '4:3' | '1:1'
  className?: string
}

type FacingMode = 'environment' | 'user'

export default function KioskScanner({ size = 'sm', ratio = '1:1', className }: KioskScannerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const kioskRequested = searchParams?.get('kiosk') === '1'

  const [kioskMode, setKioskMode] = useState(false)
  const wakeLockRef = useRef<any>(null)

  // Exit kiosk modal (hold-to-exit)
  const [exitOpen, setExitOpen] = useState(false)
  const [exitPin, setExitPin] = useState('')
  const [exitError, setExitError] = useState<string | null>(null)
  const [exitHolding, setExitHolding] = useState(false)
  const exitHoldRef = useRef<number | null>(null)

  // Bootstrap kiosk mode from URL or localStorage
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('atom:kiosk') === '1'
      if (kioskRequested || stored) {
        setKioskMode(true)
      }
      if (kioskRequested) {
        window.localStorage.setItem('atom:kiosk', '1')
      }
    } catch {
      if (kioskRequested) setKioskMode(true)
    }
  }, [kioskRequested])

  // Apply kiosk UI (hide nav) + keep screen awake
  useEffect(() => {
    if (!kioskMode) {
      document.body.classList.remove('kiosk-mode')
      if (wakeLockRef.current?.release) {
        wakeLockRef.current.release().catch(() => {})
      }
      wakeLockRef.current = null
      return
    }

    document.body.classList.add('kiosk-mode')

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
      if (wakeLockRef.current?.release) {
        wakeLockRef.current.release().catch(() => {})
      }
      wakeLockRef.current = null
    }
  }, [kioskMode])

  async function verifyExitPin(pin: string): Promise<{ ok: boolean; message?: string }> {
    const r = await fetch('/api/kiosk/verify-exit-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })
    const j = await r.json().catch(() => ({ ok: false }))
    return { ok: !!j?.ok && r.ok, message: j?.message }
  }


  function cancelExitHold() {
    if (exitHoldRef.current) window.clearTimeout(exitHoldRef.current)
    exitHoldRef.current = null
    setExitHolding(false)
  }

  function startExitHold() {
    if (!kioskMode) return
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

  async function confirmExitKiosk() {
    setExitError(null)
    const res = await verifyExitPin(exitPin || '')
    if (!res.ok) {
      setExitError(res.message || 'Invalid PIN')
      return
    }

    try {
      window.localStorage.setItem('atom:kiosk', '0')
    } catch {}

    cancelExitHold()
    setExitOpen(false)
    setKioskMode(false)
    setFullScreen(false)
    router.replace('/scan')
  }

  function closeExitModal() {
    cancelExitHold()
    setExitOpen(false)
    setExitError(null)
    setExitPin('')
  }


  function enterKioskMode() {
    try {
      window.localStorage.setItem('atom:kiosk', '1')
    } catch {}
    setKioskMode(true)
    setFullScreen(true)
    // Keep URL sticky for refresh
    router.replace('/scan?kiosk=1')
  }


  // Lazy-load the heavy camera scanner only when this component is mounted.
  // This keeps the main JS bundles lighter and avoids eager prefetch downloads.
  const [ScannerComponent, setScannerComponent] = useState<ComponentType<any> | null>(null)

  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState<string>('Ready')
  const resumeTimerRef = useRef<number | null>(null)


// Network status (offline fallback)
const [online, setOnline] = useState(true)
const wasOfflineRef = useRef(false)

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
  if (!online) {
    wasOfflineRef.current = true
    setPaused(true)
    setStatus('error')
    setMsg('Offline — reconnect to the internet, then tap Retry.')
    return
  }

  if (wasOfflineRef.current) {
    wasOfflineRef.current = false
    // Auto-resume scanning when back online
    manualRescan()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [online])

  // Camera controls
  const [facingMode, setFacingMode] = useState<FacingMode>('environment')
  const [fullScreen, setFullScreen] = useState(false)

  // Prevent background scroll + allow ESC to close fullscreen overlay
  useEffect(() => {
    if (!fullScreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !kioskMode) setFullScreen(false)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [fullScreen])

  // Load scanner module after first render
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const mod: any = await import('@yudiel/react-qr-scanner')
        const Comp = mod?.Scanner
        if (!Comp) throw new Error('Scanner export not found in @yudiel/react-qr-scanner')
        if (!cancelled) setScannerComponent(() => Comp)
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setMsg('Failed to load camera scanner')
        // Keep the real error in console for debugging.
        console.error(e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
      if (exitHoldRef.current) window.clearTimeout(exitHoldRef.current)
    }
  }, [])

  const statusBadge = useMemo(() => {
    switch (status) {
      case 'checking':
        return <Badge>Checking…</Badge>
      case 'ok':
        return <Badge>Valid</Badge>
      case 'invalid':
        return <Badge>Invalid</Badge>
      case 'error':
        return <Badge>Error</Badge>
      default:
        return <Badge>Idle</Badge>
    }
  }, [status])

  const handleScan = useCallback(
    async (codes: Detected[]) => {
      if (!codes || codes.length === 0 || paused) return
      const raw = codes[0]?.rawValue ?? ''
      if (!raw) return

      let didNavigate = false

      setPaused(true)
      setStatus('checking')
      setMsg('Checking…')

      try {
        const maybeId = parseMemberText(raw)
        const payload = { code: maybeId ? `atom:${maybeId}` : raw }

        if (!online) {
          setStatus('error')
          setMsg('Offline — reconnect to the internet, then tap Retry.')
          return
        }

        const r = await fetch('/api/kiosk/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const j: ScanResponse = await r.json().catch(() => ({ ok: false, message: 'Invalid response' }))

        if (!r.ok || !j.ok) {
          setStatus('error')
          setMsg(j?.message || 'Scan failed')
        } else {
          // ✅ Navigate to result page (active vs expired)
          const sp = new URLSearchParams()
          if (kioskMode) sp.set('kiosk', '1')
          sp.set('valid', j.valid ? '1' : '0')
          if (j.days_remaining !== undefined && j.days_remaining !== null) sp.set('daysRemaining', String(j.days_remaining))
          if (j.expires_on) sp.set('expiresOn', String(j.expires_on))
          if (j.expired_days !== undefined && j.expired_days !== null) sp.set('expiredDays', String(j.expired_days))
          if (j.expired_on) sp.set('expiredOn', String(j.expired_on))
          if ((j as any).frozen) sp.set('frozen', '1')
          if ((j as any).frozen_until) sp.set('frozenUntil', String((j as any).frozen_until))
          if ((j as any).freeze_days_remaining !== undefined && (j as any).freeze_days_remaining !== null)
            sp.set('freezeDaysRemaining', String((j as any).freeze_days_remaining))

          router.push(`/scan/result?${sp.toString()}`)
          didNavigate = true
          return
        }
      } catch (e) {
        setStatus('error')
        setMsg(
          !online || (typeof navigator !== 'undefined' && !navigator.onLine)
            ? 'Offline — reconnect to the internet, then tap Retry.'
            : errToString(e)
        )
      } finally {
        // If we navigated to the result page, don't resume scanning here.
        if (didNavigate || !online) return
        if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
      if (exitHoldRef.current) window.clearTimeout(exitHoldRef.current)
        resumeTimerRef.current = window.setTimeout(() => {
          setPaused(false)
          setStatus('idle')
          setMsg('Ready')
        }, 1500)
      }
    },
    [paused, router, kioskMode, online]
  )

  function manualRescan() {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
    setPaused(false)
    setStatus('idle')
    setMsg('Ready')
  }


function retryNow() {
  const nowOnline = typeof navigator !== 'undefined' ? navigator.onLine : online
  if (!nowOnline) {
    setPaused(true)
    setStatus('error')
    setMsg('Offline — reconnect to the internet, then tap Retry.')
    return
  }
  manualRescan()
}

  function toggleFacingMode() {
    // Force a fresh start when switching camera
    manualRescan()
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
  }

  // Taille & ratio du conteneur vidéo (normal mode)
  const containerWidth = size === 'lg' ? 480 : size === 'md' ? 360 : 280
  const aspect = ratio === '1:1' ? '1 / 1' : '4 / 3'

  const scannerKey = `${facingMode}-${fullScreen ? 'fs' : 'normal'}`

  const scannerEl = ScannerComponent ? (
    <ScannerComponent
      key={scannerKey}
      constraints={{ facingMode }}
      onScan={handleScan}
      onError={(err: unknown) => {
        setStatus('error')
        setMsg(errToString(err))
      }}
      components={{ finder: false }}
      paused={paused}
      styles={{
        container: { width: '100%', height: '100%' },
        video: { width: '100%', height: '100%', objectFit: 'cover' },
      }}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center">
      <div className="text-sm text-[hsl(var(--muted))]">Loading camera…</div>
    </div>
  )

  // Fullscreen overlay (works everywhere, without relying on the Fullscreen API)
  if (fullScreen) {
    return (
      <>
      <div className="fixed inset-0 z-50 bg-black/90 text-white">
        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-black/50 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-[220px]">
              <div className="text-base font-semibold">Scan member QR</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={
                    (status === 'error'
                      ? 'text-rose-200'
                      : status === 'ok'
                      ? 'text-emerald-200'
                      : status === 'invalid'
                      ? 'text-amber-200'
                      : 'text-white/80') + ' truncate'
                  }
                >
                  {msg}
                </span>
                {!online ? (
                  <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-rose-100">Offline</span>
                ) : null}
                {!kioskMode ? (
                  <span className="text-white/50">• Press ESC to exit</span>
                ) : (
                  <span className="text-white/50">• Hold Exit 2s</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!online ? (
                <Button
                  variant="outline"
                  className="!bg-transparent !text-white !border-white/30 hover:!bg-white/10"
                  onClick={retryNow}
                  title="Retry (requires internet)"
                >
                  Retry
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="!bg-transparent !text-white !border-white/30 hover:!bg-white/10"
                onClick={(e: any) => {
                  if (kioskMode) {
                    e?.preventDefault?.()
                    return
                  }
                  setFullScreen(false)
                }}
                onPointerDown={kioskMode ? startExitHold : undefined}
                onPointerUp={kioskMode ? cancelExitHold : undefined}
                onPointerLeave={kioskMode ? cancelExitHold : undefined}
                onPointerCancel={kioskMode ? cancelExitHold : undefined}
                title={kioskMode ? 'Hold 2s to exit kiosk' : 'Exit full screen'}
              >
                {kioskMode ? (exitHolding ? 'Holding…' : 'Hold to exit') : 'Exit full screen'}
              </Button>
            </div>
          </div>
        </div>

        <div className="mx-auto flex h-full max-w-5xl flex-col px-4 pb-4 pt-20">
          <div className="flex-1">
            <div className="h-full w-full overflow-hidden rounded-2xl border border-white/20 bg-black shadow-soft">
              {scannerEl}
            </div>
          </div>


        </div>
      </div>

      {exitOpen ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-white p-4 text-gray-900 shadow-soft">
            <div className="text-base font-semibold">Exit kiosk</div>
            <p className="mt-1 text-sm text-gray-600">Hold confirmed. Enter PIN to exit kiosk mode.</p>

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

      </>
    )
  }

  return (
    <Card className={className}>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Scan member QR</h3>
            <p className="text-sm text-[hsl(var(--muted))] mt-1">
              Hold the QR code in front of the camera. We’ll record attendance if valid.
            </p>
          </div>
          <div className="shrink-0">{statusBadge}</div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={toggleFacingMode} title="Switch camera">
            Flip camera
          </Button>
          <Button
            variant="outline"
            onClick={() => setFullScreen(true)}
            title="Open camera in full screen"
          >
            Full screen
          </Button>
          <Button
            variant="outline"
            onClick={enterKioskMode}
            title="Enter kiosk mode (hide nav + keep awake)"
          >
            Kiosk mode
          </Button>

          


{!online ? (
  <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
    <div className="font-semibold">Offline</div>
    <div className="mt-1 text-xs">
      Internet connection lost. Scanning requires internet access. Reconnect, then tap Retry.
    </div>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button variant="outline" onClick={retryNow} title="Retry">
        Retry
      </Button>
      <Button variant="outline" onClick={() => window.location.reload()} title="Reload the page">
        Reload
      </Button>
    </div>
  </div>
) : null}
        </div>

        {/* Zone Scanner : réduite & centrée */}
        <div className="mt-3 flex justify-center">
          <div
            className="rounded-2xl overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            style={{ width: containerWidth, aspectRatio: aspect as any }}
          >
            <div style={{ width: '100%', height: '100%', aspectRatio: aspect as any }}>{scannerEl}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={manualRescan}
            disabled={!paused && status === 'idle'}
            title="Resume scanning"
          >
            Rescan
          </Button>
          <span
            className={
              'text-sm ' +
              (status === 'ok'
                ? 'text-green-700'
                : status === 'invalid'
                ? 'text-yellow-700'
                : status === 'error'
                ? 'text-red-700'
                : 'text-[hsl(var(--muted))]')
            }
          >
            {msg}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
