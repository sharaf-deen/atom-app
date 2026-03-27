'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'

function formatWithRef(message: string, requestId?: string | null) {
  return requestId ? `${message} · Ref ${requestId}` : message
}

export default function AdminRunExpiryButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [tone, setTone] = useState<'neutral' | 'success' | 'error'>('neutral')

  const msgClass = useMemo(() => {
    if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    if (tone === 'error') return 'border-rose-200 bg-rose-50 text-rose-800'
    return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
  }, [tone])

  async function run() {
    if (busy) return
    setBusy(true)
    setTone('neutral')
    setMsg('')
    try {
      const r = await fetch('/api/admin/expire', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'cache-control': 'no-store' },
      })
      const j = await r.json().catch(() => ({} as any))
      const requestId = String(j?.request_id || r.headers.get('x-request-id') || '').trim() || null
      if (!r.ok || j?.ok === false) {
        setTone('error')
        setMsg(formatWithRef(`Error: ${j?.error || 'failed'}${j?.details ? ` – ${j.details}` : ''}`, requestId))
      } else {
        const time = j?.time_expired ?? 0
        const sess = j?.sessions_expired ?? 0
        setTone('success')
        setMsg(formatWithRef(`Done. Time expired: ${time}, Sessions expired: ${sess}`, requestId))
      }
    } catch (e: any) {
      setTone('error')
      setMsg(`Error: ${e?.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        onClick={run}
        disabled={busy}
        loading={busy}
        loadingText="Running…"
        title="Run the daily expiry job now"
      >
        Run expiry now
      </Button>
      {msg ? (
        <span role="status" aria-live="polite" className={`rounded-2xl border px-3 py-2 text-xs ${msgClass}`}>
          {msg}
        </span>
      ) : null}
    </div>
  )
}
