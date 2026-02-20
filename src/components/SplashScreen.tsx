// src/components/SplashScreen.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const DURATION_MS = 950
const STORAGE_KEY = 'atom:splash_shown_session'
const SOUND_KEY = 'atom:splash_sound' // '1' to enable (OFF by default)

function tryGetSessionFlag() {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function trySetSessionFlag() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {}
}

function isSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) === '1'
  } catch {
    return false
  }
}

function playClick() {
  // Tiny, subtle click using WebAudio (won't play unless triggered by a user gesture on many browsers)
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()

    // Short high-frequency tick
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.0001

    o.connect(g)
    g.connect(ctx.destination)

    const t0 = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08)

    o.start(t0)
    o.stop(t0 + 0.09)

    setTimeout(() => {
      try {
        ctx.close()
      } catch {}
    }, 150)
  } catch {}
}

export default function SplashScreen() {
  const [visible, setVisible] = useState(true)
  const playedRef = useRef(false)

  const soundEnabled = useMemo(() => isSoundEnabled(), [])

  useEffect(() => {
    const already = tryGetSessionFlag()
    if (already) {
      setVisible(false)
      return
    }

    // Mark as shown once per session
    trySetSessionFlag()

    const t = setTimeout(() => setVisible(false), DURATION_MS)
    return () => clearTimeout(t)
  }, [])

  function onPointerDown() {
    // Optional sound: OFF by default. If enabled, play only on user gesture to satisfy browser policies.
    if (!soundEnabled) return
    if (playedRef.current) return
    playedRef.current = true
    playClick()
  }

  if (!visible) return null

  return (
    <div
      className="atom-splash"
      role="presentation"
      aria-hidden="true"
      onPointerDown={onPointerDown}
    >
      <div className="atom-splash-inner">
        <div className="atom-splash-logo" aria-hidden="true">
          ATOM
        </div>
        <div className="atom-splash-sub" aria-hidden="true">
          Jiu-Jitsu
        </div>
        <div className="atom-splash-scan" aria-hidden="true" />
      </div>

      <style jsx>{`
        .atom-splash {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          background: radial-gradient(60% 50% at 50% 40%, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.98));
          backdrop-filter: blur(6px);
          animation: atomSplashFadeOut ${DURATION_MS}ms ease forwards;
        }

        .atom-splash-inner {
          position: relative;
          width: min(520px, 92vw);
          padding: 32px 24px;
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(0, 0, 0, 0.35);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
          overflow: hidden;
          transform-origin: center;
          animation: atomSplashIn 520ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }

        .atom-splash-logo {
          font-weight: 800;
          letter-spacing: 0.14em;
          text-align: center;
          font-size: clamp(34px, 7vw, 56px);
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 0 18px rgba(255, 255, 255, 0.12);
        }

        .atom-splash-sub {
          margin-top: 8px;
          text-align: center;
          font-size: 13px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.55);
        }

        .atom-splash-scan {
          position: absolute;
          left: -20%;
          top: 0;
          width: 40%;
          height: 100%;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0),
            rgba(255, 255, 255, 0.18),
            rgba(255, 255, 255, 0)
          );
          transform: skewX(-12deg) translateX(-120%);
          animation: atomScan 780ms ease-in-out 120ms forwards;
          pointer-events: none;
          opacity: 0.9;
        }

        @keyframes atomSplashIn {
          0% {
            opacity: 0;
            transform: scale(0.98);
            filter: blur(2px);
          }
          100% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0);
          }
        }

        @keyframes atomScan {
          0% {
            transform: skewX(-12deg) translateX(-120%);
          }
          100% {
            transform: skewX(-12deg) translateX(420%);
          }
        }

        @keyframes atomSplashFadeOut {
          0% {
            opacity: 1;
          }
          78% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            pointer-events: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .atom-splash,
          .atom-splash-inner,
          .atom-splash-scan {
            animation: none !important;
          }
          .atom-splash {
            opacity: 0;
            pointer-events: none;
          }
        }
      `}</style>
    </div>
  )
}
