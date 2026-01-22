// src/app/scan/result/AutoReturn.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type AutoReturnProps = {
  /** Seconds before redirecting back to the scanner (default: 3) */
  seconds?: number
  /** Destination route (default: /scan) */
  href?: string
  /** Hide the countdown text */
  hideText?: boolean
}

export default function AutoReturn({ seconds = 3, href = '/scan', hideText }: AutoReturnProps) {
  const router = useRouter()
  const [left, setLeft] = useState<number>(seconds)

  useEffect(() => {
    setLeft(seconds)

    // Countdown
    const interval = window.setInterval(() => {
      setLeft((prev) => Math.max(0, prev - 1))
    }, 1000)

    // Redirect (replace so Back doesn't return to result)
    const timeout = window.setTimeout(() => {
      router.replace(href)
    }, Math.max(0, seconds) * 1000)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [seconds, href, router])

  if (hideText) return null

  return (
    <p className="text-sm text-[hsl(var(--muted))]">
      Returning to scanner in <span className="font-semibold">{left}</span>s…
    </p>
  )
}
