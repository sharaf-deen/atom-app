'use client'

import { useState } from 'react'

/** Staff action. The server independently checks role, eligibility and resend cooldown. */
export default function RegistrationVerificationActions({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function send() {
    if (busy || completed) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/public-registration/verification/send', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'DELIVERY_UNAVAILABLE')
      setCompleted(true)
      setMessage('Verification email sent. Await the prospect’s confirmation.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'DELIVERY_UNAVAILABLE')
    } finally { setBusy(false) }
  }

  return <div className="mt-2 space-y-2">
    <button type="button" disabled={busy || completed} onClick={send}
      className="min-h-[44px] rounded-lg border border-black px-3 py-2 text-sm font-semibold disabled:opacity-50">
      {busy ? 'Sending…' : completed ? 'Verification requested' : 'Send email verification'}
    </button>
    {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-800">
      Verification email unavailable ({error}). Review the request or delivery status before retrying.
    </p>}
  </div>
}
