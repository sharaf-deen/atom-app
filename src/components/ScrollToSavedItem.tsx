'use client'

import { useEffect } from 'react'

type Props = {
  targetId?: string | null
  delayMs?: number
}

export default function ScrollToSavedItem({ targetId, delayMs = 500 }: Props) {
  useEffect(() => {
    const id = (targetId || '').trim()
    if (!id) return

    let attempts = 0
    let cancelled = false
    let timer: number | null = null

    const run = () => {
      if (cancelled) return
      attempts += 1
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      if (attempts < 12) {
        timer = window.setTimeout(run, 180)
      }
    }

    timer = window.setTimeout(run, delayMs)

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [targetId, delayMs])

  return null
}
