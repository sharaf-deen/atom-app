'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { formatRequestRef } from '@/lib/requestRef'

export default function AdminRunExpiryButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [tone, setTone] = useState<'neutral' | 'success' | 'error'>('neutral')


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
        setMsg(formatRequestRef(`Error: ${j?.error || 'failed'}${j?.details ? ` – ${j.details}` : ''}`, requestId))
      } else {
        const time = j?.time_expired ?? 0
        const sess = j?.sessions_expired ?? 0
        setTone('success')
        setMsg(formatRequestRef(`Done. Time expired: ${time}, Sessions expired: ${sess}`, requestId))
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
        <InlineAlert
          compact
          ariaLive="polite"
          variant={tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'info'}
        >
          {msg}
        </InlineAlert>
      ) : null}
    </div>
  )
}
