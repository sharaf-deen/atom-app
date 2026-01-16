'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'

type Status = { kind: 'neutral' | 'ok' | 'bad' | 'info'; text: string }

export default function ScanClient() {
  const [status, setStatus] = useState<Status>({
    kind: 'neutral',
    text: 'Point the camera at a member QR…',
  })
  const [busy, setBusy] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const lastCodeRef = useRef<string>('')
  const lastTimeRef = useRef<number>(0)

  useEffect(() => {
    if (!containerRef.current) return

    const elementId = 'qr-reader'

    const scanner = new Html5QrcodeScanner(
      elementId,
      { fps: 10, qrbox: 250 },
      /* verbose */ false
    )

    const onScanSuccess = async (decodedText: string) => {
      // anti-double scan: 2s
      const now = Date.now()
      if (decodedText === lastCodeRef.current && now - lastTimeRef.current < 2000) return
      lastCodeRef.current = decodedText
      lastTimeRef.current = now

      setBusy(true)
      setStatus({ kind: 'info', text: 'Checking validity…' })

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: decodedText }),
        })

        const json = await res.json().catch(() => ({} as any))

        if (res.ok && json?.ok) {
          setStatus({ kind: 'ok', text: json?.message || 'Access granted.' })
        } else {
          const msg =
            json?.message ||
            json?.error ||
            (res.status === 401 ? 'Not authenticated.' : 'Access restricted.')
          setStatus({ kind: 'bad', text: msg })
        }
      } catch {
        setStatus({ kind: 'bad', text: 'Error verifying QR.' })
      } finally {
        setBusy(false)
      }
    }

    const onScanFailure = (_err: unknown) => {
      // erreurs normales de lecture, on ignore pour éviter le spam
    }

    scanner.render(onScanSuccess, onScanFailure)

    return () => {
      scanner.clear().catch(() => {})
    }
  }, [])

  const boxClass =
    status.kind === 'ok'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : status.kind === 'bad'
      ? 'bg-rose-50 border-rose-300 text-rose-900'
      : status.kind === 'info'
      ? 'bg-amber-50 border-amber-300 text-amber-900'
      : 'bg-[hsl(var(--card))] border-[hsl(var(--border))] text-[hsl(var(--text))]'

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Entrance Scanner</h1>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
        <div id="qr-reader" ref={containerRef} />
      </div>

      <div className={`rounded-2xl border p-3 shadow-soft ${boxClass}`}>
        <div className="text-sm">
          {busy ? <span className="mr-2 text-[hsl(var(--muted))]">Working…</span> : null}
          {status.kind === 'ok' ? '✅ ' : status.kind === 'bad' ? '❌ ' : ''}
          {status.text}
        </div>
      </div>

      <p className="text-xs text-[hsl(var(--muted))]">If prompted, allow camera access.</p>
    </main>
  )
}
