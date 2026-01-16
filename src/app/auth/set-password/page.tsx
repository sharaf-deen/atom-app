'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function safeNext(input: string | null): string {
  if (!input) return '/'
  const v = input.trim()
  if (v.startsWith('/') && !v.startsWith('//')) return v
  return '/'
}

export default function SetPasswordPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const next = useMemo(() => safeNext(sp.get('next')), [sp])

  const supabase = createSupabaseBrowserClient()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Vérifie qu'on a une session
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      if (!session) {
        setError('Your session has expired. Please use the invite link again, or log in.')
      }
      setReady(true)
    })()
    return () => { mounted = false }
  }, [supabase])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) {
        setError(updErr.message)
        return
      }

      // ✅ Sync cookies serveur (important pour RLS/roles côté server)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'SIGNED_IN', session }),
        })
      }

      setSuccess('✅ Password updated. Redirecting…')
      setTimeout(() => {
        window.location.replace(next || '/')
      }, 800)
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="rounded-2xl border bg-white px-6 py-4 shadow-soft text-sm text-gray-700">
          Loading…
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-soft space-y-4">
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="text-sm text-gray-500">
          Choose a password for your Atom Jiu-Jitsu account.
        </p>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => router.replace('/login')}
                className="text-sm underline"
              >
                Go to login
              </button>
            </div>
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
            {success}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">New password</label>
          <input
            type={show ? 'text' : 'password'}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            minLength={8}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Confirm password</label>
          <input
            type={show ? 'text' : 'password'}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            minLength={8}
            required
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show password
        </label>

        <button
          type="submit"
          disabled={busy || !!error}
          className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
            busy ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
          }`}
        >
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </main>
  )
}
