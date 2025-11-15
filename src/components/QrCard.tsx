// components/QrCard.tsx
'use client'

import { useCallback, useRef } from 'react'
import QRCode from 'react-qr-code'

type Props = {
  value: string
  title?: string
  size?: number // côté en pixels (affichage)
}

export default function QrCard({ value, title = 'Access QR Code', size = 180 }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      alert('QR value copied to clipboard.')
    } catch {
      alert('Unable to copy.')
    }
  }, [value])

  const handleDownloadPng = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return

    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(svg)

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      // Crée un canvas un peu plus grand pour une meilleure définition
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = size * scale
      canvas.height = size * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const pngUrl = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = 'atom-qr.png'
      a.click()
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }, [size])

  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div className="text-sm text-gray-600">{title}</div>

      <div className="inline-flex items-center justify-center rounded-lg bg-white p-3 border">
        {/* @ts-expect-error ref est bien supporté ici */}
        <QRCode ref={svgRef} value={value || ''} size={size} />
      </div>

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
          className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50"
        >
          Download PNG
        </button>
      </div>
    </section>
  )
}
