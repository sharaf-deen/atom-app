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

function getStableDeviceTag() {
  if (typeof window === 'undefined') return 'web-kiosk'
  try {
    const key = 'atom:kiosk-device-tag'
    const existing = window.localStorage.getItem(key)
    if (existing) return existing

    const seed =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)

    const tag = `web-kiosk-${seed}`
    window.localStorage.setItem(key, tag)
    return tag
  } catch {
    return 'web-kiosk'
  }
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
  if (status === 'ok') return 'Scan complete'
  if (status === 'invalid') return 'Membership not valid'
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
  const deviceTag = useMemo(() => getStableDeviceTag(), [])

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
      }
      if (kioskRequested) {
        window.localStorage.setItem('atom:kiosk', '1')
      }
    } catch {
      if (kioskRequested) setKioskMode(true)
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
    setExitPin('')
    setKioskMode(false)
    router.replace('/scan')
  }

  const [ScannerComponent, setScannerComponent] = useState<ComponentType<any> | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState('Ready')
  const [paused, setPaused] = useState(false)
  const resumeTimerRef = useRef<number | null>(null)

  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)
  const wasOfflineRef = useRef(false)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
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
        const payload = { code: maybeId ? `atom:${maybeId}` : raw }

        if (!online) {
          setStatus('error')
          setMsg('Offline — reconnect to the internet, then tap Retry.')
          return
        }

        const r = await fetch('/api/kiosk/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-tag': deviceTag,
          },
          body: JSON.stringify(payload),
        })
        const j: ScanResponse = await r.json().catch(() => ({ ok: false, message: 'Invalid response' }))

        if (!r.ok || !j.ok) {
          setStatus('error')
          setMsg(j?.message || 'Scan failed')
        } else {
          const sp = new URLSearchParams()
          if (kioskMode) sp.set('kiosk', '1')
          sp.set('valid', j.valid ? '1' : '0')
          if (j.member_id) sp.set('memberId', j.member_id)
          if (j.days_remaining !== undefined && j.days_remaining !== null) sp.set('daysRemaining', String(j.days_remaining))
          if (j.expires_on) sp.set('expiresOn', String(j.expires_on))
          if (j.expired_days !== undefined && j.expired_days !== null) sp.set('expiredDays', String(j.expired_days))
          if (j.expired_on) sp.set('expiredOn', String(j.expired_on))
          if ((j as any).frozen) sp.set('frozen', '1')
          if ((j as any).frozen_until) sp.set('frozenUntil', String((j as any).frozen_until))
          if ((j as any).freeze_days_remaining !== undefined && (j as any).freeze_days_remaining !== null) {
            sp.set('freezeDaysRemaining', String((j as any).freeze_days_remaining))
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
          setMsg('Ready')
        }, 1500)
      }
    },
    [deviceTag, online, paused, router, kioskMode]
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

  const frameClass = useMemo(() => {
    if (ratio === '4:3') return 'aspect-[4/3]'
    return 'aspect-square'
  }, [ratio])

  const maxWidthClass = useMemo(() => {
    if (size === 'lg') return 'max-w-3xl'
    if (size === 'md') return 'max-w-2xl'
    return 'max-w-xl'
  }, [size])

  const scanner = ScannerComponent ? (
    <div className="relative overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-black shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
      <div className={`relative w-full ${frameClass}`}>
        <ScannerComponent
          constraints={{ facingMode }}
          onScan={handleScan}
          onError={(e: unknown) => {
            setStatus('error')
            setMsg(errToString(e))
          }}
          scanDelay={700}
          paused={paused}
          styles={{
            container: { width: '100%', height: '100%' },
            video: { width: '100%', height: '100%', objectFit: 'cover' },
          }}
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_52%,rgba(0,0,0,0.28)_100%)]" />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="relative h-[72%] w-[72%] max-w-[320px] rounded-[28px] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.14)]">
            <span className="absolute -left-[2px] -top-[2px] h-10 w-10 rounded-tl-[28px] border-l-4 border-t-4 border-white" />
            <span className="absolute -right-[2px] -top-[2px] h-10 w-10 rounded-tr-[28px] border-r-4 border-t-4 border-white" />
            <span className="absolute -bottom-[2px] -left-[2px] h-10 w-10 rounded-bl-[28px] border-b-4 border-l-4 border-white" />
            <span className="absolute -bottom-[2px] -right-[2px] h-10 w-10 rounded-br-[28px] border-b-4 border-r-4 border-white" />

            <div className="absolute inset-x-5 top-1/2 h-[2px] -translate-y-1/2 bg-white/85 shadow-[0_0_16px_rgba(255,255,255,0.9)]" />
          </div>
        </div>

        <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/45 px-3 py-2 text-white backdrop-blur-sm">
          <ScanLine className="h-4 w-4" />
          <span className="text-sm font-medium">Align QR inside frame</span>
        </div>

        <div className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/45 px-3 py-2 text-white backdrop-blur-sm">
          <StatusPill status={status} />
          <span className="text-sm opacity-90">{msg}</span>
        </div>
      </div>
    </div>
  ) : (
    <div className={`relative w-full ${frameClass} overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-[linear-gradient(180deg,#fafafa,#f1f1f1)]`}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-black/10 bg-white shadow-sm">
          <Camera className="h-6 w-6" />
        </div>
        <div>
          <p className="text-base font-semibold">Starting camera…</p>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Allow camera access if prompted.</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className={className}>
      <div className={`mx-auto w-full ${maxWidthClass} space-y-4`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionChip icon={<ShieldCheck className="h-4 w-4" />} label={statusTitle(status, paused)} />
          <ActionChip icon={<Smartphone className="h-4 w-4" />} label={kioskMode ? `Kiosk • ${deviceTag}` : `Web scan • ${deviceTag}`} />
          <ActionChip icon={online ? <RefreshCw className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />} label={online ? 'Online' : 'Offline'} />
        </div>

        <Card className="overflow-hidden rounded-[32px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_24px_70px_rgba(0,0,0,0.08)]">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">ATOM Scan</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">Fast kiosk check-in for reception and admins.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setFacingMode((v) => (v === 'environment' ? 'user' : 'environment'))}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Flip camera
                </Button>
                <Button type="button" variant="outline" onClick={retryNow}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
                <Button type="button" variant="outline" onClick={() => setFullScreen((v) => !v)}>
                  {fullScreen ? <Minimize2 className="mr-2 h-4 w-4" /> : <Expand className="mr-2 h-4 w-4" />}
                  {fullScreen ? 'Exit full screen' : 'Full screen'}
                </Button>
              </div>
            </div>

            {scanner}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[hsl(var(--muted))]">
                Tip: keep the QR flat, well lit, and centered inside the frame.
              </p>

              {kioskMode ? (
                <button
                  type="button"
                  onMouseDown={startExitHold}
                  onMouseUp={cancelExitHold}
                  onMouseLeave={cancelExitHold}
                  onTouchStart={startExitHold}
                  onTouchEnd={cancelExitHold}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]"
                >
                  {exitHolding ? 'Keep holding…' : 'Exit kiosk'}
                </button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {fullScreen ? (
        <div className="fixed inset-0 z-[100] bg-black/90 p-3 sm:p-5">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white backdrop-blur-sm">
              <div>
                <p className="text-sm font-semibold">ATOM Scan</p>
                <p className="text-xs text-white/70">Use the rear camera and keep the QR inside the frame.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="!bg-transparent !text-white !border-white/25 hover:!bg-white/10"
                onClick={() => setFullScreen(false)}
              >
                <Minimize2 className="mr-2 h-4 w-4" />
                Close
              </Button>
            </div>
            <div className="min-h-0 flex-1">{scanner}</div>
          </div>
        </div>
      ) : null}

      {exitOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold">Exit kiosk mode</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Enter the staff PIN to leave kiosk mode.</p>

            <input
              className="mt-4 w-full rounded-xl border border-black/10 px-3 py-3 text-center text-lg tracking-[0.35em] outline-none focus:ring-2 focus:ring-black/50"
              inputMode="numeric"
              autoFocus
              value={exitPin}
              onChange={(e) => setExitPin(e.target.value.replace(/\D+/g, '').slice(0, 8))}
              placeholder="••••"
            />

            {exitError ? <p className="mt-2 text-sm text-rose-700">{exitError}</p> : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setExitOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmExitKiosk}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
