// src/components/AdminRunNotificationsButton.tsx
'use client'

import { useState } from 'react'

export default function AdminRunNotificationsButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function run(dry = false) {
    setBusy(true)
    setMsg('')
    try {
      const r = await fetch(`/api/admin/notify/run${dry ? '?dry=1' : ''}`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed')
        return
      }
      const q1 = j.queued?.expire_7d ?? 0
      const q2 = j.queued?.sessions_low ?? 0
      const sent = j.sent ?? 0
      setMsg(`${dry ? 'Dry-run' : 'Done'} — queued: expire_7d=${q1}, sessions_low=${q2} · sent=${sent}`)
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
