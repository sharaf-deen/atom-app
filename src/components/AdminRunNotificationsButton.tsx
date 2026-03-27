'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'

export default function AdminRunNotificationsButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [tone, setTone] = useState<'neutral' | 'success' | 'error'>('neutral')

  const msgClass = useMemo(() => {
    if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    if (tone === 'error') return 'border-rose-200 bg-rose-50 text-rose-800'
    return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
  }, [tone])

  async function run(dry = false) {
    if (busy) return
    setBusy(true)
    setTone('neutral')
    setMsg('')

    try {
      const r = await fetch(`/api/admin/notify/run${dry ? '?dry=1' : ''}`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'cache-control': 'no-store' },
      })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j?.ok) {
        setTone('error')
        setMsg(j?.details || j?.error || 'Failed')
        return
      }
      const q1 = j?.queued?.expire_7d ?? 0
      const q2 = j?.queued?.sessions_low ?? 0
      const sent = j?.sent ?? 0
      const candidates1 = j?.candidates?.expire_7d ?? 0
      const candidates2 = j?.candidates?.sessions_low ?? 0
      setTone('success')
      setMsg(
        `${dry ? 'Dry-run complete' : 'Run complete'} — candidates: expire_7d=${candidates1}, sessions_low=${candidates2} · queued: expire_7d=${q1}, sessions_low=${q2} · sent=${sent}`
      )
    } catch (e: any) {
      setTone('error')
      setMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={() => run(false)} disabled={busy} loading={busy} loadingText="Running…">
        Run reminders
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => run(true)}
        disabled={busy}
        title="Simulate without sending"
      >
        Dry-run
      </Button>
      {msg ? (
        <span role="status" aria-live="polite" className={`rounded-2xl border px-3 py-2 text-xs ${msgClass}`}>
          {msg}
        </span>
      ) : null}
    </div>
  )
}
