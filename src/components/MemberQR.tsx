'use client'

import { useEffect, useMemo, useState } from 'react'

type Props = {
  value: string
  size?: number
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

/**
 * QR component using the single QR generator dependency: `qrcode`.
 * (Keeps the file for compatibility with older UI pieces.)
 */
export default function MemberQR({ value, size = 192, filename = 'atomjj-qr.png' }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const qrWidth = useMemo(() => Math.max(128, Math.floor(size * 2)), [size])

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

  const downloadPNG = () => {
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = filename
    // Safari fix
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="inline-flex items-center gap-3">
      <div className="inline-block p-3 border rounded bg-white">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt="Member QR"
            width={size}
            height={size}
            className="rounded"
          />
        ) : (
          <div
            className="animate-pulse rounded bg-gray-100"
            style={{ width: size, height: size }}
            aria-label="Generating QR"
          />
        )}
      </div>

      <button
        type="button"
        onClick={downloadPNG}
        disabled={!dataUrl}
        className={
          'border rounded px-3 py-2 text-sm ' +
          (dataUrl ? 'bg-gray-50 hover:bg-gray-100' : 'bg-gray-100 text-gray-400 cursor-not-allowed')
        }
        aria-label="Download QR as PNG"
        title="Download QR as PNG"
      >
        Download PNG
      </button>

      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  )
}
