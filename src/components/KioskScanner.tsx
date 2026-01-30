// src/components/KioskScanner.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Scanner } from '@yudiel/react-qr-scanner'
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
  try { return JSON.stringify(err) } catch {}
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

export default function KioskScanner({ size = 'sm', ratio = '1:1', className }: KioskScannerProps) {
  const router = useRouter()
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState<string>('Ready')
  const resumeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
    }
  }, [])

  const statusBadge = useMemo(() => {
    switch (status) {
      case 'checking': return <Badge>Checking…</Badge>
      case 'ok': return <Badge>Valid</Badge>
      case 'invalid': return <Badge>Invalid</Badge>
      case 'error': return <Badge>Error</Badge>
      default: return <Badge>Idle</Badge>
    }
  }, [status])

  const handleScan = useCallback(async (codes: Detected[]) => {
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
        sp.set('valid', j.valid ? '1' : '0')
        if (j.days_remaining !== undefined && j.days_remaining !== null) sp.set('daysRemaining', String(j.days_remaining))
        if (j.expires_on) sp.set('expiresOn', String(j.expires_on))
        if (j.expired_days !== undefined && j.expired_days !== null) sp.set('expiredDays', String(j.expired_days))
        if (j.expired_on) sp.set('expiredOn', String(j.expired_on))
        if ((j as any).frozen) sp.set('frozen', '1')
        if ((j as any).frozen_until) sp.set('frozenUntil', String((j as any).frozen_until))
        if ((j as any).freeze_days_remaining !== undefined && (j as any).freeze_days_remaining !== null) sp.set('freezeDaysRemaining', String((j as any).freeze_days_remaining))

        router.push(`/scan/result?${sp.toString()}`)
        didNavigate = true
        return
      }
    } catch (e) {
      setStatus('error')
      setMsg(errToString(e))
    } finally {
      // If we navigated to the result page, don't resume scanning here.
      if (didNavigate) return
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = window.setTimeout(() => {
        setPaused(false)
        setStatus('idle')
        setMsg('Ready')
      }, 1500)
    }
  }, [paused, router])

  function manualRescan() {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
    setPaused(false)
    setStatus('idle')
    setMsg('Ready')
  }

  // Taille & ratio du conteneur vidéo
  const containerWidth = size === 'lg' ? 480 : size === 'md' ? 360 : 280
  const aspect = ratio === '1:1' ? '1 / 1' : '4 / 3'

  return (
    <Card className={className}>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Scan member QR</h3>
            <p className="text-sm text-[hsl(var(--muted))] mt-1">
              Hold the QR code in front of the camera. We’ll record attendance if valid.
            </p>
          </div>
          <div className="shrink-0">{statusBadge}</div>
        </div>

        {/* Zone Scanner : réduite & centrée */}
        <div className="mt-3 flex justify-center">
          <div
            className="rounded-2xl overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            style={{ width: containerWidth, aspectRatio: aspect as any }}
          >
            <Scanner
              constraints={{ facingMode: 'environment' }}
              onScan={handleScan}
              onError={(err) => {
                setStatus('error')
                setMsg(errToString(err))
              }}
              components={{ finder: false }}
              paused={paused}
              styles={{
                container: { width: '100%', height: '100%', aspectRatio: aspect as any },
                video: { width: '100%', height: '100%', objectFit: 'cover' },
              }}
            />
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
