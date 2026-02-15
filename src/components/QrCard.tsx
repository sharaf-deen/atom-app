// src/components/QrCard.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Props = {
  value: string
  title?: string
  /** QR size in CSS pixels */
  size?: number
  /** Download filename (png) */
  filename?: string
}

function errToString(err: unknown) {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as any).message
    if (typeof m === 'string') return m
  }
  return 'Unable to generate QR'
}

export default function QrCard({
  value,
  title = 'Access QR Code',
  size = 180,
  filename = 'atom-qr.png',
}: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Generate a crisp PNG (2x) then display scaled down via CSS
  const renderWidth = useMemo(() => Math.max(64, Math.floor(size)), [size])
  const qrWidth = useMemo(() => Math.max(128, Math.floor(renderWidth * 2)), [renderWidth])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setError(null)
      setDataUrl(null)
      try {
        const { default: QRCode } = await import('qrcode')
        const url = await QRCode.toDataURL(value || '', {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: qrWidth,
        })
        if (!cancelled) setDataUrl(url)
      } catch (e) {
        if (!cancelled) setError(errToString(e))
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [value, qrWidth])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      alert('QR value copied to clipboard.')
    } catch {
      // Fallback
      try {
        const t = document.createElement('textarea')
        t.value = value
        document.body.appendChild(t)
        t.select()
        document.execCommand('copy')
        document.body.removeChild(t)
        alert('QR value copied to clipboard.')
      } catch {
        alert('Unable to copy.')
      }
    }
  }, [value])

  const handleDownloadPng = useCallback(() => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [dataUrl, filename])

  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div className="text-sm text-gray-600">{title}</div>

      <div className="inline-flex items-center justify-center rounded-lg bg-white p-3 border">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={title}
            width={renderWidth}
            height={renderWidth}
            className="rounded"
          />
        ) : (
          <div
            className="animate-pulse rounded bg-gray-100"
            style={{ width: renderWidth, height: renderWidth }}
            aria-label="Generating QR"
          />
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50"
        >
          Copy value
        </button>
        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={!dataUrl}
          className={
            'text-sm px-3 py-1.5 rounded border ' +
            (dataUrl ? 'hover:bg-gray-50' : 'bg-gray-100 text-gray-400 cursor-not-allowed')
          }
        >
          Download PNG
        </button>
      </div>
    </section>
  )
}
