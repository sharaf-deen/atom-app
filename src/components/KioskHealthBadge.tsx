'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type HealthOk = {
  ok: true
  role: string
  email: string | null
  user_id: string
  expires_at: number | null
  ts: string
}

type HealthErr = {
  ok: false
  reason: string
  role?: string | null
}

type Health = HealthOk | HealthErr

function Dot({ status }: { status: 'ok' | 'warn' | 'bad' }) {
  const cls = status === 'ok' ? 'bg-emerald-500' : status === 'warn' ? 'bg-amber-500' : 'bg-rose-500'
  return <span className={'inline-block h-2.5 w-2.5 rounded-full ' + cls} aria-hidden />
}

function fmtCountdown(seconds: number) {
  if (!Number.isFinite(seconds)) return ''
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m <= 0) return `${r}s`
  return `${m}m ${r}s`
}

export default function KioskHealthBadge({
  className = '',
  pollMs = 15000,
  showReload = true,
}: {
  className?: string
  pollMs?: number
  showReload?: boolean
}) {
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastOkAt, setLastOkAt] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const loadingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const expiresIn = useMemo(() => {
    if (!health || !health.ok || !health.expires_at) return null
    const left = health.expires_at * 1000 - Date.now()
    return Math.floor(left / 1000)
  }, [health])

  async function refresh() {
    if (!mountedRef.current || loadingRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    loadingRef.current = true
    setLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const r = await fetch('/api/kiosk/health', {
        cache: 'no-store',
        signal: controller.signal,
      })
      const j = (await r.json().catch(() => null)) as Health | null
      if (!mountedRef.current || controller.signal.aborted) return
      if (!j) {
        setHealth({ ok: false, reason: 'bad_response' })
        return
      }
      setHealth(j)
      if (j.ok) setLastOkAt(new Date().toISOString())
    } catch (err) {
      if (!mountedRef.current || (err instanceof DOMException && err.name === 'AbortError')) return
      setHealth({ ok: false, reason: 'network_error' })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    refresh()
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      refresh()
    }, pollMs)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs])

  const sessionStatus: 'ok' | 'warn' | 'bad' = !online ? 'bad' : health?.ok ? 'ok' : 'warn'
  const label = !online
    ? 'Offline'
    : health?.ok
      ? `Session OK (${health.role})`
      : health
        ? health.reason === 'unauthenticated'
          ? 'Session expired'
          : 'Session check failed'
        : 'Checking…'

  const sub = !online
    ? 'No internet'
    : health?.ok
      ? expiresIn !== null && expiresIn <= 0
        ? 'Expired'
        : expiresIn !== null && expiresIn <= 300
          ? `Expires in ${fmtCountdown(expiresIn)}`
          : health.email ?? ''
      : lastOkAt
        ? 'Tap refresh'
        : ''

  return (
    <div
      className={
        'flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft ' +
        className
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <Dot status={sessionStatus} />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{label}</div>
          {sub ? <div className="truncate text-[11px] text-black/60">{sub}</div> : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            refresh()
          }}
          disabled={loading}
          className="rounded-xl border border-black/10 px-2.5 py-1 text-xs font-semibold hover:bg-black/[0.03] disabled:opacity-60"
          title="Re-check connectivity & session"
        >
          {loading ? '…' : 'Refresh'}
        </button>

        {showReload ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl border border-black/10 px-2.5 py-1 text-xs font-semibold hover:bg-black/[0.03]"
            title="Reload the kiosk page"
          >
            Reload
          </button>
        ) : null}
      </div>
    </div>
  )
}
