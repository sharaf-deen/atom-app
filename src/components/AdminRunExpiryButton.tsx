// src/components/AdminRunExpiryButton.tsx
'use client'

import { useState } from 'react'

export default function AdminRunExpiryButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function run() {
    setBusy(true)
    setMsg('')
    try {
      const r = await fetch('/api/admin/expire', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) {
        setMsg(`Error: ${j?.error || 'failed'}${j?.details ? ` – ${j.details}` : ''}`)
      } else {
        const time = j?.time_expired ?? 0
        const sess = j?.sessions_expired ?? 0
        setMsg(`Done. Time expired: ${time}, Sessions expired: ${sess}`)
      }
    } catch (e: any) {
      setMsg(`Error: ${e?.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className={`px-3 py-2 rounded border ${busy ? 'bg-gray-200 text-gray-500' : 'hover:bg-gray-50'}`}
        onClick={run}
        disabled={busy}
        title="Run the daily expiry job now"
      >
        {busy ? 'Running…' : 'Run expiry now'}
      </button>
      {msg && (
        <span className="text-sm text-gray-600">{msg}</span>
      )}
    </div>
  )
}
