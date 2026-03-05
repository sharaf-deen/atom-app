// src/app/scan/result/ResultSound.tsx
'use client'

import { useEffect } from 'react'

type Kind = 'ok' | 'invalid' | 'frozen'

function beep(freq: number, ms: number) {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.value = 0.05
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    window.setTimeout(() => {
      try {
        o.stop()
        ctx.close()
      } catch {}
    }, ms)
  } catch {
    // ignore
  }
}

export default function ResultSound({ kind }: { kind: Kind }) {
  useEffect(() => {
    // Vibration (best-effort)
    try {
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'ok' ? [30] : [120, 40, 120])
      }
    } catch {}

    // Audio cue (best-effort; may be blocked on some browsers without user gesture)
    if (kind === 'ok') {
      beep(880, 120)
      window.setTimeout(() => beep(1320, 120), 160)
    } else {
      beep(220, 240)
    }
  }, [kind])

  return null
}
