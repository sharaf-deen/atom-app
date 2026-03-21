// src/components/KioskScanner.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Camera,
  Expand,
  Minimize2,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'

function buildDeviceTag() {
  if (typeof window === 'undefined') return 'web-kiosk'

  const storageKey = 'atom:kiosk:device-tag'
  const fallback = 'web-kiosk'

  try {
    const existing = window.localStorage.getItem(storageKey)
    if (existing) return existing.slice(0, 64)

    const bits = [
      'web',
      typeof navigator !== 'undefined' ? navigator.platform || 'platform' : 'platform',
      typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 24) : 'ua',
      Math.random().toString(36).slice(2, 8),
    ]
      .join('-')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64)

    const tag = bits || fallback
    window.localStorage.setItem(storageKey, tag)
    return tag
  } catch {
    return fallback
  }
}

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


function buildResultParams(j: ScanResponse, kioskMode: boolean) {
  const sp = new URLSearchParams()
  if (kioskMode) sp.set('kiosk', '1')
  sp.set('valid', j.valid ? '1' : '0')
  if (j.member_id) sp.set('memberId', j.member_id)
  if (j.days_remaining !== undefined && j.days_remaining !== null) sp.set('daysRemaining', String(j.days_remaining))
  if (j.expires_on) sp.set('expiresOn', String(j.expires_on))
  if (j.expired_days !== undefined && j.expired_days !== null) sp.set('expiredDays', String(j.expired_days))
  if (j.expired_on) sp.set('expiredOn', String(j.expired_on))
  if (j.frozen) sp.set('frozen', '1')
  if (j.frozen_until) sp.set('frozenUntil', String(j.frozen_until))
  if (j.freeze_days_remaining !== undefined && j.freeze_days_remaining !== null) {
    sp.set('freezeDaysRemaining', String(j.freeze_days_remaining))
  }
  if (j.message) sp.set('message', String(j.message).slice(0, 180))
  return sp
}

type Status = 'idle' | 'checking' | 'ok' | 'invalid' | 'error'

type KioskScannerProps = {
  size?: 'sm' | 'md' | 'lg'
  ratio?: '4:3' | '1:1'
  className?: string
}

type FacingMode = 'environment' | 'user'

function StatusPill({ status }: { status: Status }) {
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
      return <Badge>Ready</Badge>
  }
}

function statusTitle(status: Status, paused: boolean) {
  if (status === 'checking') return 'Checking member'
  if (status === 'ok') return 'Decision ready'
  if (status === 'invalid') return 'Check desk'
  if (status === 'error') return 'Scanner needs attention'
  if (paused) return 'Scanner paused'
  return 'Ready to scan'
}

function statusToneClass(status: Status) {
  if (status === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'invalid') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'error') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'checking') return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function ActionChip({
  icon,
  label,
}: {
  icon: ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white text-black">
        {icon}
      </span>
      <span className="text-[hsl(var(--muted))]">{label}</span>
    </div>
  )
}

export default function KioskScanner({ size = 'sm', ratio = '1:1', className }: KioskScannerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const kioskRequested = searchParams?.get('kiosk') === '1'

  const [kioskMode, setKioskMode] = useState(false)
  const wakeLockRef = useRef<any>(null)

  const [exitOpen, setExitOpen] = useState(false)
  const [exitPin, setExitPin] = useState('')
  const [exitError, setExitError] = useState<string | null>(null)
  const [exitHolding, setExitHolding] = useState(false)
  const exitHoldRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('atom:kiosk') === '1'
      if (kioskRequested || stored) {
        setKioskMode(true)
        setFullScreen(true)
      }
      if (kioskRequested) {
        window.localStorage.setItem('atom:kiosk', '1')
      }
    } catch {
      if (kioskRequested) {
        setKioskMode(true)
        setFullScreen(true)
      }
    }
  }, [kioskRequested])

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
    router.replace('/scan?kiosk=1')
  }

  const [ScannerComponent, setScannerComponent] = useState<ComponentType<any> | null>(null)
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState<string>('Ready')
  const resumeTimerRef = useRef<number | null>(null)
  const lastScanRef = useRef<{ scanKey: string; at: number; params: string } | null>(null)
  const repeatCooldownMs = kioskMode ? 8000 : 5000

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
      manualRescan()
    }
  }, [online])

  const [facingMode, setFacingMode] = useState<FacingMode>('environment')
  const [fullScreen, setFullScreen] = useState(false)
  const deviceTagRef = useRef<string>('web-kiosk')

  useEffect(() => {
    deviceTagRef.current = buildDeviceTag()
  }, [])

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
  }, [fullScreen, kioskMode])

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
        const scanKey = maybeId ? `atom:${maybeId}` : raw.trim()
        const payload = { code: maybeId ? `atom:${maybeId}` : raw }

        if (!online) {
          setStatus('error')
          setMsg('Offline — reconnect to the internet, then tap Retry.')
          return
        }

        const last = lastScanRef.current
        const repeatAgeMs = last && last.scanKey === scanKey ? Date.now() - last.at : null
        if (last && repeatAgeMs !== null && repeatAgeMs < repeatCooldownMs) {
          const sp = new URLSearchParams(last.params)
          sp.set('repeat', '1')
          sp.set('repeatSeconds', String(Math.max(1, Math.round(repeatAgeMs / 1000))))
          if (kioskMode) sp.set('kiosk', '1')
          setStatus('ok')
          setMsg('Same member scanned again — reusing the latest entrance decision and presence context.')
          router.push(`/scan/result?${sp.toString()}`)
          didNavigate = true
          return
        }

        const r = await fetch('/api/kiosk/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-tag': deviceTagRef.current || 'web-kiosk',
          },
          body: JSON.stringify(payload),
        })
        const j: ScanResponse = await r.json().catch(() => ({ ok: false, message: 'Invalid response' }))

        if (!r.ok || !j.ok) {
          setStatus('error')
          setMsg(j?.message || 'Scan failed')
        } else {
          const sp = buildResultParams(j, kioskMode)
          lastScanRef.current = {
            scanKey,
            at: Date.now(),
            params: sp.toString(),
          }

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
        if (didNavigate || !online) return
        if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
        resumeTimerRef.current = window.setTimeout(() => {
          setPaused(false)
          setStatus('idle')
          setMsg(kioskMode ? 'Ready for next member' : 'Ready')
        }, 1500)
      }
    },
    [paused, router, kioskMode, online, repeatCooldownMs]
  )

  function manualRescan() {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
    setPaused(false)
    setStatus('idle')
    setMsg(kioskMode ? 'Ready for next member' : 'Ready')
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
    manualRescan()
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
  }

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

  const statusBoxClass = statusToneClass(status)
  const scannerOverlay =
    paused || status === 'checking' || status === 'error' ? (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 p-4">
        <div className="w-full max-w-xs rounded-3xl border border-white/20 bg-black/70 p-4 text-center text-white backdrop-blur-md">
          <div className="text-sm font-semibold">{statusTitle(status, paused)}</div>
          <p className="mt-1 text-sm text-white/80">{msg}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {status === 'error' ? (
              <Button variant="outline" className="!border-white/30 !bg-transparent !text-white hover:!bg-white/10" onClick={retryNow}>
                Retry
              </Button>
            ) : null}
            <Button variant="outline" className="!border-white/30 !bg-transparent !text-white hover:!bg-white/10" onClick={manualRescan}>
              Rescan
            </Button>
          </div>
        </div>
      </div>
    ) : null

  if (fullScreen) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/90 text-white">
          <div className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-black/50 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-[220px]">
                <div className="flex items-center gap-2">
                  <div className="text-base font-semibold">Scan member QR</div>
                  {kioskMode ? (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-100">
                      Kiosk mode
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={(status === 'error' ? 'text-rose-200' : status === 'ok' ? 'text-emerald-200' : status === 'invalid' ? 'text-amber-200' : 'text-white/80') + ' truncate'}>
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
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="!bg-transparent !text-white !border-white/30 hover:!bg-white/10"
                  onClick={() => {
                    if (!kioskMode) setFullScreen(false)
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

          <div className="mx-auto flex h-full max-w-6xl flex-col px-4 pb-4 pt-20">
            <div className="flex-1">
              <div className="relative h-full w-full overflow-hidden rounded-3xl border border-white/20 bg-black shadow-soft">
                {scannerEl}
                {scannerOverlay}
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">Scan member QR</h3>
                <StatusPill status={status} />
                {!online ? <Badge>Offline</Badge> : null}
                {kioskMode ? <Badge>Kiosk</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Fast front-desk scanning with full-screen mode, kiosk mode, repeat-scan guardrails, presence context and clear entrance decision cues.
              </p>
            </div>

            <div className={`rounded-2xl border px-3 py-2 text-sm font-medium ${statusBoxClass}`}>
              {statusTitle(status, paused)}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ActionChip
              icon={<ScanLine size={16} strokeWidth={2.1} />}
              label={paused ? 'Paused until rescan' : kioskMode ? 'Ready for next member' : 'Ready for next QR'}
            />
            <ActionChip
              icon={<Camera size={16} strokeWidth={2.1} />}
              label={facingMode === 'environment' ? 'Back camera active' : 'Front camera active'}
            />
            <ActionChip
              icon={<Smartphone size={16} strokeWidth={2.1} />}
              label={kioskMode ? 'Kiosk mode + full screen' : 'Standard scanner view'}
            />
            <ActionChip
              icon={online ? <ShieldCheck size={16} strokeWidth={2.1} /> : <WifiOff size={16} strokeWidth={2.1} />}
              label={online ? (kioskMode ? 'Auto-return + decision cues' : 'Decision cues ready') : 'Internet required'}
            />
          </div>

          {!online ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <div className="font-semibold">Offline</div>
              <div className="mt-1 text-xs">
                Internet connection lost. Scanning requires internet access. Reconnect, then tap Retry.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" onClick={retryNow}>
                  Retry
                </Button>
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={toggleFacingMode} title="Switch camera">
              <RotateCcw size={16} className="mr-2" />
              Flip camera
            </Button>
            <Button variant="outline" onClick={() => setFullScreen(true)} title="Open camera in full screen">
              <Expand size={16} className="mr-2" />
              Full screen
            </Button>
            <Button variant="outline" onClick={enterKioskMode} title="Enter kiosk mode (hide nav + keep awake)">
              <Smartphone size={16} className="mr-2" />
              Kiosk mode
            </Button>
            <Button variant="outline" onClick={manualRescan} disabled={!paused && status === 'idle'} title="Resume scanning">
              <RefreshCw size={16} className="mr-2" />
              Rescan
            </Button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex justify-center xl:justify-start">
              <div
                className="relative overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
                style={{ width: containerWidth, aspectRatio: aspect as any }}
              >
                <div style={{ width: '100%', height: '100%', aspectRatio: aspect as any }}>{scannerEl}</div>
                <div className="pointer-events-none absolute inset-0 border-[10px] border-transparent">
                  <div className="absolute inset-4 rounded-[28px] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" />
                </div>
                {scannerOverlay}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-sm font-semibold tracking-tight">Current scanner message</div>
                <p
                  className={
                    'mt-2 text-sm ' +
                    (status === 'ok'
                      ? 'text-emerald-700'
                      : status === 'invalid'
                      ? 'text-amber-800'
                      : status === 'error'
                      ? 'text-rose-700'
                      : 'text-[hsl(var(--muted))]')
                  }
                >
                  {msg}
                </p>
              </div>

              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-sm font-semibold tracking-tight">Desk decision tips</div>
                <ul className="mt-2 space-y-2 text-sm text-[hsl(var(--muted))]">
                  <li>Keep only one QR code in the frame.</li>
                  <li>Use the back camera for faster detection.</li>
                  <li>Use the result page cue first: Let in, Check desk or Open profile.</li>
                  <li>Tap Rescan after any blocked or invalid attempt.</li>
                  <li>Use kiosk mode for the academy entrance.</li>
                  <li>Kiosk mode returns automatically to the next scan after the result page.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="text-sm text-[hsl(var(--muted))]">
            The scanner validates the member and opens a result page with a stronger entrance decision cue for the desk.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}