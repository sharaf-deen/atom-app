'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function RegistrationVerificationForm() {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'ready' | 'success' | 'error'>('ready')

  useEffect(() => {
    const fragment = window.location.hash.slice(1)
    const value = new URLSearchParams(fragment).get('token') || ''
    setToken(value)
    // Remove the secret from browser URL/history as soon as it is captured.
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function verify() {
    if (!/^[a-f0-9]{64}$/.test(token) || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/public-registration/verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('UNVERIFIED')
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      setToken('')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-5 py-14">
      <h1 className="text-2xl font-semibold">Verify your email</h1>
      {status === 'success' ? (
        <p className="mt-5">Email verified. Your registration is awaiting the next step from ATOM.</p>
      ) : status === 'error' ? (
        <p className="mt-5 text-sm text-red-700">This verification link is invalid or has expired. Please contact ATOM Reception for a new one.</p>
      ) : (
        <>
          <p className="mt-4 text-sm">Confirm your email address for the registration request. This does not activate a membership.</p>
          <button type="button" onClick={() => void verify()}
            disabled={busy || !/^[a-f0-9]{64}$/.test(token)}
            className="mt-5 rounded-xl bg-black px-5 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? 'Verifying…' : 'Confirm email'}
          </button>
          {!token ? <p className="mt-3 text-sm text-amber-800">Missing verification token. Open the original email link.</p> : null}
        </>
      )}
      <div className="mt-8"><Link href="/">Back to ATOM App</Link></div>
    </main>
  )
}
