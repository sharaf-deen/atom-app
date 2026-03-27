'use client'

import { useState } from 'react'

export default function AdminRunNotificationsButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function run(dry = false) {
    if (busy) return
    setBusy(true)
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
        setMsg(j?.details || j?.error || 'Failed')
        return
      }
      const q1 = j?.queued?.expire_7d ?? 0
      const q2 = j?.queued?.sessions_low ?? 0
      const sent = j?.sent ?? 0
      const candidates1 = j?.candidates?.expire_7d ?? 0
      const candidates2 = j?.candidates?.sessions_low ?? 0
      setMsg(
        `${dry ? 'Dry-run' : 'Done'} — candidates: expire_7d=${candidates1}, sessions_low=${candidates2} · queued: expire_7d=${q1}, sessions_low=${q2} · sent=${sent}`
      )
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => run(false)}
        disabled={busy}
        className={`px-3 py-1.5 rounded border ${busy ? 'bg-gray-200 text-gray-500' : 'hover:bg-gray-50'}`}
      >
        {busy ? 'Running…' : 'Run reminders'}
      </button>
      <button
        onClick={() => run(true)}
        disabled={busy}
        className={`px-3 py-1.5 rounded border ${busy ? 'bg-gray-200 text-gray-500' : 'hover:bg-gray-50'}`}
        title="Simulate without sending"
      >
        Dry-run
      </button>
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </div>
  )
}
