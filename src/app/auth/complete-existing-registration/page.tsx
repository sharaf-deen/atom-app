'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import PasswordInput from '@/components/ui/PasswordInput'

type CompleteResult = { ok?: boolean; code?: string; next?: string }

/** This is only for account owners who already set a password before the
 * ATOM registration finalization flow was deployed. No password change. */
export default function CompleteExistingRegistrationPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getUser()
        if (!alive) return
        if (error || !data.user) {
          router.replace('/login?next=/auth/complete-existing-registration')
          return
        }
        if (!data.user.app_metadata?.atom_registration_request_id) {
          setError('This account is not part of an ATOM public registration. Contact reception.')
        }
      } catch {
        if (alive) setError('Unable to confirm your account. Please try again.')
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, [router, supabase])

  async function complete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !confirmed || !password) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/public-registration/activation/complete-existing', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirm: true }),
      })
      const result = await response.json().catch(() => ({})) as CompleteResult
      if (!response.ok || !result.ok) {
        if (result.code === 'PASSWORD_VERIFICATION_FAILED')
          throw new Error('Incorrect current password. Please try again.')
        if (result.code === 'NOT_AUTHENTICATED')
          throw new Error('Your session expired. Please sign in again.')
        throw new Error('Account setup requires ATOM reception review (' + (result.code || 'UNKNOWN') + ').')
      }
      setPassword('')
      setSuccess(true)
      const next = result.next === '/family' ? '/family' : '/profile'
      router.replace('/auth/registration-consent?next=' + encodeURIComponent(next))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete account setup.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="flex min-h-[70vh] items-center justify-center px-4 py-8">
    <div className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Complete your ATOM account</h1>
      <p className="text-sm text-gray-700">
        If you previously set your password but your registration is still pending,
        confirm your current password to finish account activation. Your password will not be changed.
      </p>
      {checking ? <p role="status" className="text-sm">Checking your account…</p> :
        success ? <p role="status" className="text-sm text-green-800">Account confirmed. Continuing to legal setup…</p> :
        <form onSubmit={complete} className="space-y-4">
          <PasswordInput label="Current password" value={password}
            onChange={e => setPassword((e.target as HTMLInputElement).value)}
            autoComplete="current-password" required minLength={8} disabled={busy} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)} disabled={busy} />
            <span>I am the account holder and authorize completing my existing ATOM registration.</span>
          </label>
          <button type="submit" disabled={busy || !confirmed || password.length < 8}
            className="w-full rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Confirming…' : 'Complete account activation'}
          </button>
        </form>}
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <p className="text-xs text-gray-500">
        This does not accept legal documents, activate a membership or create a new family.
      </p>
    </div>
  </main>
}
