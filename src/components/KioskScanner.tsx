// src/components/KioskScanner.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Camera,
  Expand,
  LogOut,
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
import { formatRequestRef } from '@/lib/requestRef'

function buildDeviceTag(terminalLocked = false) {
  if (terminalLocked) return 'scan-terminal-front'
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

const TERMINAL_FULLSCREEN_STORAGE_KEY = 'atom:scan-terminal:fullscreen'

function readTerminalFullscreenPreference() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(TERMINAL_FULLSCREEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeTerminalFullscreenPreference(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TERMINAL_FULLSCREEN_STORAGE_KEY, enabled ? '1' : '0')
  } catch {}
}

type ScanResponse = {
  ok: boolean
  request_id?: string
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
  staff_checkin?: boolean
  staff_role?: string
  staff_checked_in_at?: string
  staff_already_checked_in?: boolean
}

type Detected = { rawValue: string }

type Status = 'idle' | 'checking' | 'ok' | 'invalid' | 'error'
type FacingMode = 'environment' | 'user'

type KioskScannerProps = {
  size?: 'sm' | 'md' | 'lg'
  ratio?: '4:3' | '1:1'
  className?: string
  terminalLocked?: boolean
}

type WakeLockSentinelLike = {
  released?: boolean
  release?: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

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
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  try {
    return JSON.stringify(err)
  } catch {}
  return 'Camera error'
}

function classifyCameraError(err: unknown) {
  const raw = errToString(err)
  const normalized = raw.toLowerCase()

  if (normalized.includes('notallowederror') || normalized.includes('permission denied')) {
    return 'Camera permission denied — allow camera access, then tap Retry.'
  }
  if (normalized.includes('notfounderror') || normalized.includes('requested device not found')) {
    return 'No camera found on this device.'
  }
  if (normalized.includes('notreadableerror') || normalized.includes('could not start video source')) {
    return 'Camera busy or unavailable — close other camera apps, then tap Retry.'
  }
  if (normalized.includes('overconstrainederror')) {
    return 'Selected camera is not available — try Flip camera or Retry.'
  }
  if (normalized.includes('securityerror')) {
    return 'Camera blocked by browser security settings.'
  }
  if (normalized.includes('aborterror')) {
    return 'Camera start was interrupted — tap Retry.'
  }
  if (normalized.includes('load camera scanner')) {
    return 'Failed to load camera scanner'
  }
  return raw || 'Camera error'
}


function buildResultParams(j: ScanResponse, kioskMode: boolean, fullScreenEnabled = false) {
  const sp = new URLSearchParams()
  if (kioskMode) sp.set('kiosk', '1')
  if (fullScreenEnabled) sp.set('fullscreen', '1')
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
  if (j.staff_checkin) sp.set('staffCheckin', '1')
  if (j.staff_role) sp.set('staffRole', String(j.staff_role).slice(0, 40))
  if (j.staff_checked_in_at) sp.set('staffCheckedInAt', String(j.staff_checked_in_at).slice(0, 80))
  if (j.staff_already_checked_in) sp.set('staffAlreadyCheckedIn', '1')
  if (j.message) sp.set('message', String(j.message).slice(0, 180))
  return sp
}

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

function ActionChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-white text-black">
        {icon}
      </span>
      <span className="text-[hsl(var(--muted))]">{label}</span>
    </div>
  )
}

export default function KioskScanner({ size = 'sm', ratio = '1:1', className, terminalLocked = false }: KioskScannerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const kioskRequested = searchParams?.get('kiosk') === '1'
  const fullScreenRequested = searchParams?.get('fullscreen') === '1'

  const [kioskMode, setKioskMode] = useState(terminalLocked)
  const [ScannerComponent, setScannerComponent] = useState<ComponentType<any> | null>(null)
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState<string>('Ready')
  const [online, setOnline] = useState(true)
  const [facingMode, setFacingMode] = useState<FacingMode>(terminalLocked ? 'user' : 'environment')
  const [fullScreen, setFullScreen] = useState(false)
  const [deviceLabel, setDeviceLabel] = useState(terminalLocked ? 'scan-terminal-front' : 'web-kiosk')
  const [cameraRecoveryHint, setCameraRecoveryHint] = useState<string | null>(null)
  const [scannerReloadKey, setScannerReloadKey] = useState(0)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockMode, setUnlockMode] = useState<'logout' | 'fullscreen' | 'home'>('logout')
  const [unlockPin, setUnlockPin] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [unlockBusy, setUnlockBusy] = useState(false)

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const unlockHoldTimerRef = useRef<number | null>(null)
  const wakeLockListenerRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(true)
  const resumeTimerRef = useRef<number | null>(null)
  const requestAbortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)
  const deviceTagRef = useRef<string>('web-kiosk')
  const lastScanRef = useRef<{ scanKey: string; at: number; params: string } | null>(null)
  const wasOfflineRef = useRef(false)
  const repeatCooldownMs = kioskMode ? 8000 : 5000

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = null
    }
  }, [])


  const clearUnlockHoldTimer = useCallback(() => {
    if (unlockHoldTimerRef.current) {
      window.clearTimeout(unlockHoldTimerRef.current)
      unlockHoldTimerRef.current = null
    }
  }, [])

  const abortActiveRequest = useCallback(() => {
    requestSeqRef.current += 1
    if (requestAbortRef.current) {
      requestAbortRef.current.abort()
      requestAbortRef.current = null
    }
  }, [])

  const releaseWakeLock = useCallback(async () => {
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
  }, [])

  const requestWakeLock = useCallback(async () => {
    if (wakeLockRef.current) return
    if (!kioskMode) return
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
  }, [kioskMode])

  const requestBrowserFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return
    const target = document.documentElement as any
    if (document.fullscreenElement || !target?.requestFullscreen) return
    try {
      await target.requestFullscreen()
    } catch {
      // ignore
    }
  }, [])

  const exitBrowserFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return
    const doc = document as any
    if (!doc.fullscreenElement || !doc.exitFullscreen) return
    try {
      await doc.exitFullscreen()
    } catch {
      // ignore
    }
  }, [])

  const manualRescan = useCallback(() => {
    abortActiveRequest()
    clearResumeTimer()
    setPaused(false)
    setStatus('idle')
    setCameraRecoveryHint(null)
    setMsg(kioskMode ? 'Ready for next member' : 'Ready')
  }, [abortActiveRequest, clearResumeTimer, kioskMode])

  const reloadCameraStack = useCallback(() => {
    abortActiveRequest()
    clearResumeTimer()
    setPaused(false)
    setStatus('idle')
    setScannerComponent(null)
    setCameraRecoveryHint('Camera stack restarted. If the browser still blocks access, allow camera permission and retry.')
    setMsg(terminalLocked ? 'Restarting front camera…' : 'Restarting camera…')
    setScannerReloadKey((value) => value + 1)
  }, [abortActiveRequest, clearResumeTimer, terminalLocked])

  const openUnlockDialog = useCallback((mode: 'logout' | 'fullscreen' | 'home') => {
    if (unlockBusy) return
    setUnlockMode(mode)
    setUnlockPin('')
    setUnlockError(null)
    setUnlockOpen(true)
  }, [unlockBusy])

  const beginUnlockHold = useCallback(() => {
    if (!terminalLocked || unlockBusy || unlockOpen) return
    clearUnlockHoldTimer()
    unlockHoldTimerRef.current = window.setTimeout(() => {
      openUnlockDialog('logout')
      unlockHoldTimerRef.current = null
    }, 4000)
  }, [clearUnlockHoldTimer, openUnlockDialog, terminalLocked, unlockBusy, unlockOpen])

  const endUnlockHold = useCallback(() => {
    clearUnlockHoldTimer()
  }, [clearUnlockHoldTimer])

  const submitUnlock = useCallback(async () => {
    if (!terminalLocked || unlockBusy) return
    const pin = unlockPin.trim()
    if (!pin) {
      setUnlockError(
        unlockMode === 'fullscreen'
          ? 'Enter the admin PIN to exit full screen.'
          : unlockMode === 'home'
            ? 'Enter the admin PIN to exit the terminal scanner and return to Home.'
            : 'Enter the admin PIN to exit terminal mode.'
      )
      return
    }
    setUnlockBusy(true)
    setUnlockError(null)
    try {
      const endpoint = unlockMode === 'fullscreen' ? '/api/scan-terminal/verify-pin' : '/api/scan-terminal/unlock'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const payload = await response.json().catch(() => ({ ok: false, error: 'unlock_failed' }))
      if (!response.ok || !payload?.ok) {
        setUnlockError(typeof payload?.error === 'string' ? payload.error : 'Terminal PIN verification failed.')
        return
      }

      if (unlockMode === 'fullscreen') {
        writeTerminalFullscreenPreference(false)
        setUnlockOpen(false)
        setUnlockPin('')
        setUnlockError(null)
        setFullScreen(false)
        await exitBrowserFullscreen()
        router.replace('/scan')
        return
      }

      setUnlockOpen(false)
      setUnlockPin('')
      setUnlockError(null)

      if (unlockMode === 'home') {
        router.push('/')
        return
      }

      router.push('/logout')
    } catch {
      setUnlockError(
        unlockMode === 'fullscreen'
          ? 'Full screen exit failed. Check the network connection and try again.'
          : unlockMode === 'home'
            ? 'Terminal exit failed. Check the network connection and try again.'
            : 'Terminal unlock failed. Check the network connection and try again.'
      )
    } finally {
      setUnlockBusy(false)
    }
  }, [exitBrowserFullscreen, router, terminalLocked, unlockBusy, unlockMode, unlockPin])


  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortActiveRequest()
      clearResumeTimer()
      clearUnlockHoldTimer()
      releaseWakeLock().catch(() => {})
    }
  }, [abortActiveRequest, clearResumeTimer, clearUnlockHoldTimer, releaseWakeLock])

  useEffect(() => {
    if (terminalLocked) {
      setKioskMode(true)
      setFacingMode('user')
      return
    }

    try {
      const stored = window.localStorage.getItem('atom:kiosk') === '1'
      if (kioskRequested || stored) {
        setKioskMode(true)
      }
      if (kioskRequested) {
        window.localStorage.setItem('atom:kiosk', '1')
        router.replace('/scan')
      }
    } catch {
      if (kioskRequested) {
        setKioskMode(true)
        router.replace('/scan')
      }
    }
  }, [kioskRequested, router, terminalLocked])

  useEffect(() => {
    if (!terminalLocked) return
    const shouldOpenFullScreen = fullScreenRequested || readTerminalFullscreenPreference()
    if (!shouldOpenFullScreen) return
    setFullScreen(true)
    requestBrowserFullscreen().catch(() => {})
  }, [fullScreenRequested, requestBrowserFullscreen, terminalLocked])

  useEffect(() => {
    if (!terminalLocked) return
    writeTerminalFullscreenPreference(fullScreen)
  }, [fullScreen, terminalLocked])

  useEffect(() => {
    if (!kioskMode) {
      document.body.classList.remove('kiosk-mode')
      releaseWakeLock().catch(() => {})
      return
    }

    document.body.classList.add('kiosk-mode')
    requestWakeLock().catch(() => {})

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock().catch(() => {})
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.body.classList.remove('kiosk-mode')
      document.removeEventListener('visibilitychange', onVisibilityChange)
      releaseWakeLock().catch(() => {})
    }
  }, [kioskMode, releaseWakeLock, requestWakeLock])

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
      abortActiveRequest()
      clearResumeTimer()
      setPaused(true)
      setStatus('error')
      setMsg('Offline — reconnect to the internet, then tap Retry.')
      return
    }

    if (wasOfflineRef.current) {
      wasOfflineRef.current = false
      manualRescan()
    }
  }, [abortActiveRequest, clearResumeTimer, manualRescan, online])

  useEffect(() => {
    const tag = buildDeviceTag(terminalLocked)
    deviceTagRef.current = tag
    setDeviceLabel(tag)
  }, [terminalLocked])

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
        if (!cancelled && mountedRef.current) {
          setScannerComponent(() => Comp)
          setCameraRecoveryHint(null)
          setMsg((current) => (current === 'Failed to load camera scanner' ? 'Ready' : current))
        }
      } catch (e) {
        if (cancelled || !mountedRef.current) return
        setStatus('error')
        setCameraRecoveryHint('Try Retry first. If the browser still refuses the camera, use Restart camera or refresh the page.')
        setMsg(classifyCameraError(e))
        console.error(e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [scannerReloadKey])

  function enterKioskMode() {
    if (terminalLocked) return
    try {
      window.localStorage.setItem('atom:kiosk', '1')
    } catch {}
    setKioskMode(true)
    router.replace('/scan')
  }

  function exitKioskMode() {
    if (terminalLocked) return
    abortActiveRequest()
    try {
      window.localStorage.setItem('atom:kiosk', '0')
    } catch {}
    setKioskMode(false)
    setFullScreen(false)
    router.replace('/scan')
  }

  function enterTerminalFullScreen() {
    if (!terminalLocked) return
    setFullScreen(true)
    writeTerminalFullscreenPreference(true)
    requestBrowserFullscreen().catch(() => {})
  }

  const handleScan = useCallback(
    async (codes: Detected[]) => {
      if (!codes || codes.length === 0 || paused) return
      const raw = codes[0]?.rawValue ?? ''
      if (!raw) return

      let didNavigate = false
      let reqId = requestSeqRef.current
      let controller: AbortController | null = null
      const maybeId = parseMemberText(raw)
      const scanKey = maybeId ? `atom:${maybeId}` : raw.trim()
      const payload = { code: maybeId ? `atom:${maybeId}` : raw }

      setPaused(true)
      setStatus('checking')
      setMsg('Checking…')

      try {
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
          if (terminalLocked && fullScreen) sp.set('fullscreen', '1')
          setStatus('ok')
          setMsg('Same member scanned again — latest decision reused.')
          router.push(`/scan/result?${sp.toString()}`)
          didNavigate = true
          return
        }

        abortActiveRequest()
        controller = new AbortController()
        const activeController = controller
        requestAbortRef.current = activeController
        reqId = requestSeqRef.current + 1
        requestSeqRef.current = reqId
        const timeout = window.setTimeout(() => activeController.abort(), 12000)

        let r: Response
        try {
          r = await fetch('/api/kiosk/scan', {
            method: 'POST',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json',
              'x-device-tag': deviceTagRef.current || 'web-kiosk',
            },
            body: JSON.stringify(payload),
            signal: activeController.signal,
          })
        } finally {
          window.clearTimeout(timeout)
        }

        if (requestSeqRef.current !== reqId || activeController.signal.aborted) {
          return
        }

        const j: ScanResponse = await r.json().catch(() => ({ ok: false, message: 'Invalid response' }))
        const requestId = String(j?.request_id || r.headers.get('x-request-id') || '').trim() || null

        if (!r.ok || !j.ok) {
          setStatus(j.valid === false ? 'invalid' : 'error')
          setMsg(formatRequestRef(j?.message || 'Scan failed', requestId, 'paren'))
          return
        }

        const sp = buildResultParams(j, kioskMode, terminalLocked && fullScreen)
        lastScanRef.current = {
          scanKey,
          at: Date.now(),
          params: sp.toString(),
        }

        setStatus(j.valid ? 'ok' : 'invalid')
        setMsg(j?.message || (j.valid ? 'Access granted' : 'Access denied'))
        router.push(`/scan/result?${sp.toString()}`)
        didNavigate = true
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError'
        if (aborted) {
          if (requestSeqRef.current !== reqId || !mountedRef.current) return
          if (!online || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            setStatus('error')
            setMsg('Offline — reconnect to the internet, then tap Retry.')
          } else {
            setStatus('error')
            setMsg('Scanner request timed out — tap Retry.')
          }
          return
        }

        setStatus('error')
        setMsg(
          !online || (typeof navigator !== 'undefined' && !navigator.onLine)
            ? 'Offline — reconnect to the internet, then tap Retry.'
            : classifyCameraError(e)
        )
      } finally {
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null
        }
        if (didNavigate || !online) return
        clearResumeTimer()
        resumeTimerRef.current = window.setTimeout(() => {
          setPaused(false)
          setStatus('idle')
          setMsg(kioskMode ? 'Ready for next member' : 'Ready')
        }, 1500)
      }
    },
    [abortActiveRequest, clearResumeTimer, fullScreen, kioskMode, online, paused, repeatCooldownMs, router, terminalLocked]
  )

  function retryNow() {
    const nowOnline = typeof navigator !== 'undefined' ? navigator.onLine : online
    if (!nowOnline) {
      abortActiveRequest()
      clearResumeTimer()
      setPaused(true)
      setStatus('error')
      setMsg('Offline — reconnect to the internet, then tap Retry.')
      return
    }
    manualRescan()
  }

  function toggleFacingMode() {
    if (terminalLocked) return
    manualRescan()
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
  }

  const containerWidth = size === 'lg' ? 480 : size === 'md' ? 360 : 280
  const aspect = ratio === '1:1' ? '1 / 1' : '4 / 3'
  const scannerKey = `${scannerReloadKey}-${facingMode}-${fullScreen ? 'fs' : 'normal'}`

  const scannerEl = ScannerComponent ? (
    <ScannerComponent
      key={scannerKey}
      constraints={{ facingMode }}
      onScan={handleScan}
      onError={(err: unknown) => {
        setStatus('error')
        setCameraRecoveryHint('Camera access needs attention. Retry first, then restart the camera if needed.')
        setMsg(classifyCameraError(err))
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
  const unlockDialog = unlockOpen ? (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-[hsl(var(--border))] bg-white p-5 shadow-soft">
        <div className="text-sm font-semibold tracking-tight text-black">{unlockMode === 'fullscreen' ? 'Exit full screen' : unlockMode === 'home' ? 'Exit to Home' : 'Admin exit unlock'}</div>
        <p className="mt-2 text-sm text-[hsl(var(--muted))]">{unlockMode === 'fullscreen' ? 'Enter the terminal PIN to leave full screen and keep the scanner page open.' : unlockMode === 'home' ? 'Enter the terminal PIN to leave the scanner and return to Home on this device.' : 'Enter the terminal PIN to unlock the logout route for this device.'}</p>
        <label className="mt-4 block text-sm">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">Exit PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={unlockPin}
            onChange={(event) => setUnlockPin(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitUnlock()
              }
            }}
            className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-base outline-none transition focus:border-black"
            placeholder="Admin PIN"
          />
        </label>
        {unlockError ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{unlockError}</div> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setUnlockOpen(false)
              setUnlockError(null)
              setUnlockPin('')
            }}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitUnlock()} disabled={unlockBusy}>
            {unlockBusy ? 'Checking PIN…' : unlockMode === 'fullscreen' ? 'Exit full screen' : unlockMode === 'home' ? 'Exit to Home' : 'Unlock exit'}
          </Button>
        </div>
      </div>
    </div>
  ) : null

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
        {unlockDialog}
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
                {!kioskMode ? <span className="text-white/50">• Press ESC to exit</span> : null}
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
              {terminalLocked ? (
                <Button
                  variant="outline"
                  className="!bg-transparent !text-white !border-white/30 hover:!bg-white/10"
                  onClick={() => openUnlockDialog('fullscreen')}
                  title="Exit full screen"
                >
                  Exit full screen
                </Button>
              ) : kioskMode ? (
                <Button
                  variant="outline"
                  className="!bg-transparent !text-white !border-white/30 hover:!bg-white/10"
                  onClick={exitKioskMode}
                  title="Exit kiosk mode"
                >
                  Exit kiosk mode
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="!bg-transparent !text-white !border-white/30 hover:!bg-white/10"
                  onClick={() => setFullScreen(false)}
                  title="Exit full screen"
                >
                  Exit full screen
                </Button>
              )}
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
      </>
    )
  }

  return (
    <>
      {unlockDialog}
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
                {terminalLocked ? 'Front camera is locked for this door terminal. Result screen returns automatically after 5 seconds and can stay in full screen.' : 'Flip camera, open full screen manually, or keep kiosk mode active inside this page.'}
              </p>
            </div>

            <div
              className={`rounded-2xl border px-3 py-2 text-sm font-medium ${statusBoxClass} ${terminalLocked ? 'select-none' : ''}`}
              onMouseDown={terminalLocked ? beginUnlockHold : undefined}
              onMouseUp={terminalLocked ? endUnlockHold : undefined}
              onMouseLeave={terminalLocked ? endUnlockHold : undefined}
              onTouchStart={terminalLocked ? beginUnlockHold : undefined}
              onTouchEnd={terminalLocked ? endUnlockHold : undefined}
              onTouchCancel={terminalLocked ? endUnlockHold : undefined}
              title={terminalLocked ? 'Hold 4 seconds for admin exit' : undefined}
            >
              {statusTitle(status, paused)}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
              label={kioskMode ? (fullScreen ? 'Kiosk mode active · full screen' : 'Kiosk mode active in page') : 'Standard scanner view'}
            />
            <ActionChip
              icon={online ? <ShieldCheck size={16} strokeWidth={2.1} /> : <WifiOff size={16} strokeWidth={2.1} />}
              label={online ? (kioskMode ? 'Auto-return active' : 'Decision cues ready') : 'Internet required'}
            />
            <ActionChip
              icon={<Smartphone size={16} strokeWidth={2.1} />}
              label={`Device: ${deviceLabel}`}
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


          {status === 'error' ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">Scanner recovery</div>
              <div className="mt-1 text-xs">
                {cameraRecoveryHint || 'Tap Retry first. If the camera still does not recover, restart the camera stack or refresh the page.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" onClick={retryNow}>
                  Retry
                </Button>
                <Button variant="outline" onClick={reloadCameraStack}>
                  Restart camera
                </Button>
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!terminalLocked ? (
              <Button variant="outline" onClick={toggleFacingMode} title="Switch camera">
                <RotateCcw size={16} className="mr-2" />
                Flip camera
              </Button>
            ) : null}
            {terminalLocked ? (
              <>
                {!fullScreen ? (
                  <Button variant="outline" onClick={enterTerminalFullScreen} title="Open terminal in full screen">
                    <Expand size={16} className="mr-2" />
                    Enter full screen
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => openUnlockDialog('home')} title="Exit scanner and return to Home">
                  <LogOut size={16} className="mr-2" />
                  Exit
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setFullScreen(true)} title="Open camera in full screen">
                {fullScreen ? <Minimize2 size={16} className="mr-2" /> : <Expand size={16} className="mr-2" />}
                Full screen
              </Button>
            )}
            {!terminalLocked ? (
              kioskMode ? (
                <Button variant="outline" onClick={exitKioskMode} title="Leave kiosk mode">
                  <Smartphone size={16} className="mr-2" />
                  Exit kiosk mode
                </Button>
              ) : (
                <Button variant="outline" onClick={enterKioskMode} title="Keep kiosk mode available on this page">
                  <Smartphone size={16} className="mr-2" />
                  Enable kiosk mode
                </Button>
              )
            ) : null}
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
                <div className="text-sm font-semibold tracking-tight">Terminal health</div>
                <div className="mt-2 space-y-2 text-sm text-[hsl(var(--muted))]">
                  <div><span className="font-medium text-black">Device label:</span> {deviceLabel}</div>
                  <div><span className="font-medium text-black">Camera mode:</span> {terminalLocked ? 'Front camera locked' : facingMode === 'environment' ? 'Back camera active' : 'Front camera active'}</div>
                  <div><span className="font-medium text-black">Recovery:</span> Retry first, then restart the camera if needed.</div>
                  <div><span className="font-medium text-black">Admin exit:</span> Hold the status badge 4 seconds, then enter the PIN.</div>
                </div>
              </div>

              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-sm font-semibold tracking-tight">Desk tips</div>
                <ul className="mt-2 space-y-2 text-sm text-[hsl(var(--muted))]">
                  <li>Keep one QR code in the frame.</li>
                  <li>{terminalLocked ? 'Front camera stays locked for this terminal account.' : 'Use the back camera when possible.'}</li>
                  <li>{terminalLocked ? 'Result screen returns automatically after 5 seconds and reopens in full screen if enabled.' : 'Kiosk mode stays inside this page.'}</li>
                  <li>{terminalLocked ? 'Exiting full screen or logout stays locked until the admin PIN is validated.' : 'Use Full screen only when needed.'}</li>
                  <li>Tap Rescan after a blocked or invalid attempt.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        </CardContent>
      </Card>
    </>
  )
}
