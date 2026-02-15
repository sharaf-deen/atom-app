'use client'

import { useEffect, useRef, useState } from 'react'

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

    let scanner: any = null
    let cancelled = false

    const elementId = 'qr-reader'

    const init = async () => {
      // Lazy-load the scanner library (big bundle) only when this page is opened.
      const mod = await import('html5-qrcode')
      if (cancelled) return

      const { Html5QrcodeScanner } = mod as any

      scanner = new Html5QrcodeScanner(
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
        // normal read errors -> ignore to avoid noise
      }

      scanner.render(onScanSuccess, onScanFailure)
    }

    init().catch(() => {
      setStatus({ kind: 'bad', text: 'Camera init failed.' })
    })

    return () => {
      cancelled = true
      if (scanner?.clear) scanner.clear().catch(() => {})
    }
  }, [])

  const boxClass =
    status.kind === 'ok'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : status.kind === 'bad'
      ? 'bg-rose-50 border-rose-300 text-rose-900'
      : status.kind === 'info'
      ? 'bg-amber-50 border-amber-300 text-amber-900'
      : 'bg-white border-neutral-200 text-neutral-900'

  return (
    <div className="mx-auto w-full max-w-md p-6">
      <h1 className="text-xl font-semibold mb-3">Scan</h1>

      <div className={`rounded-2xl border p-3 mb-4 ${boxClass}`}>
        <div className="text-sm">{status.text}</div>
        {busy ? <div className="text-xs opacity-70 mt-1">Processing…</div> : null}
      </div>

      <div
        ref={containerRef}
        className="rounded-2xl overflow-hidden border bg-black/5"
      >
        <div id="qr-reader" />
      </div>

      <p className="text-xs text-neutral-500 mt-4">
        Tip: hold the code steady, good lighting helps.
      </p>
    </div>
  )
}
